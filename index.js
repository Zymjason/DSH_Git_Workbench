/**
 * Git 工作台 (Git Workbench) — Host half.
 *
 * Binds multiple Git platform accounts (Gitea / GitHub / GitLab / Gitee) and
 * exposes them to two callers through one shared operation layer:
 *   - the Web UI, through an authenticated JSON RPC route on the shared /api
 *     channel (`ctx.connection.fetch`), and
 *   - the model, through the `git` agent tool.
 *
 * Platform differences live in platforms.js adapters; everything here works
 * on normalized shapes. Git work (clone / push / pull) runs through the Host
 * subprocess service with per-command HTTP Basic auth headers, so tokens never
 * land in .git/config or on disk. Accounts and session bindings persist in
 * `data/gitea-studio/state.json` (mode 0600, schema v2 with v1 migration).
 *
 * Internal identifiers (package id, RPC path, state directory) keep the
 * original gitea-studio name for upgrade stability; the product name is
 * Git 工作台 / Git Workbench.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createClient, normalizeBaseUrl, platformMeta, PLATFORMS } from './platforms.js'

const RPC_PATH = '/api/gitea-studio/rpc'
const STATE_VERSION = 2
const MAX_BODY_BYTES = 256 * 1024
const MAX_OUTPUT_TAIL = 4000
const GIT_TIMEOUT_MS = 180000
const GRAPH_BRANCH_CAP = 12
const GRAPH_COMMIT_CAP = 60

/** Report the deployment data directory for this plugin. */
function dataDirectory() {
  if (process.env.DSH_PROFILE_DIR) return join(process.env.DSH_PROFILE_DIR, 'data', 'gitea-studio')
  return join(homedir(), '.dsh', 'gitea-studio')
}

/** Turn an unknown thrown value into readable text. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Keep the tail of a long text, bounded by characters. */
function tail(text, limit) {
  const value = typeof text === 'string' ? text : ''
  return value.length <= limit ? value : `…${value.slice(value.length - limit)}`
}

/** Normalize the API root URL a user typed for one platform. */
function normalizeAccountUrl(platform, raw) {
  let value = normalizeBaseUrl(raw)
  if (value === '') return ''
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  if (platform === 'gitea') value = value.replace(/\/api\/v1$/i, '')
  if (platform === 'gitee') value = value.replace(/\/api\/v5$/i, '')
  if (platform === 'gitlab') value = value.replace(/\/api\/v4$/i, '')
  if (platform === 'github') {
    if (/^https:\/\/github\.com$/i.test(value)) value = 'https://api.github.com'
    else if (!/\/api\/v3$/i.test(value) && !/^https:\/\/api\.github\.com$/i.test(value)) value += '/api/v3'
  }
  return value
}

/** Validate an owner/repo pair; GitLab owners may be subgroup paths. */
function repoRef(owner, repo) {
  const o = String(owner ?? '').trim()
  const r = String(repo ?? '').trim()
  const ownerOk = /^[\w./-]+$/.test(o) && !o.startsWith('/') && !o.endsWith('/') && !o.includes('..') && !o.includes('//')
  if (!ownerOk || !/^[\w.-]+$/.test(r)) throw new Error('仓库标识无效：需要 owner 与 repo（仅字母、数字、_ . -，GitLab 支持子组路径）')
  return { owner: o, repo: r }
}

/** Validate a git branch name (loose, conservative). */
function branchName(raw) {
  const value = String(raw ?? '').trim()
  if (value === '' || /[\s~^:?*[\]\\]/.test(value) || value.startsWith('-') || value.includes('..') || value.endsWith('.lock')) {
    throw new Error(`分支名无效：${value || '(空)'}`)
  }
  return value
}

/** Read one collected subprocess stream as text. */
function readCollected(handle, stream) {
  try {
    const reader = handle.collected?.[stream]
    if (!reader) return ''
    const read = reader.readFrom(0)
    return typeof read?.text === 'string' ? read.text : ''
  } catch {
    return ''
  }
}

/** One JSON response on the shared fetch channel. */
function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** One studio instance owns state, accounts, routes, git, and the tool. */
class GitWorkbench {
  constructor(ctx, config) {
    this.ctx = ctx
    this.log = ctx.logger ?? console
    this.rawConfig = config && typeof config === 'object' ? config : {}
    this.directory = dataDirectory()
    this.stateFile = join(this.directory, 'state.json')
    this.abort = new AbortController()
    this.disposed = false
    this.state = {
      version: STATE_VERSION,
      activeAccountId: '',
      accounts: [],
      cloneRoot: '',
      bindings: {},
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  async init() {
    await mkdir(this.directory, { recursive: true })
    let raw = null
    try {
      raw = JSON.parse(await readFile(this.stateFile, 'utf8'))
    } catch {
      /* first start or unreadable state: seed from the row config */
    }
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.accounts)) {
        this.state.accounts = raw.accounts
          .filter((account) => account && typeof account === 'object' && account.id)
          .map((account) => ({
            id: String(account.id),
            platform: PLATFORMS[account.platform] ? account.platform : 'gitea',
            baseUrl: normalizeAccountUrl(PLATFORMS[account.platform] ? account.platform : 'gitea', account.baseUrl),
            username: String(account.username ?? ''),
            token: String(account.token ?? ''),
          }))
        this.state.activeAccountId = String(raw.activeAccountId ?? '')
      } else if (raw.baseUrl || raw.token) {
        /* v1 → v2: the single Gitea account becomes the first account row. */
        const migrated = {
          id: 'acc-migrated',
          platform: 'gitea',
          baseUrl: normalizeAccountUrl('gitea', raw.baseUrl),
          username: String(raw.username ?? ''),
          token: String(raw.token ?? ''),
        }
        this.state.accounts = migrated.baseUrl || migrated.token ? [migrated] : []
        this.state.activeAccountId = migrated.id
      }
      this.state.cloneRoot = String(raw.cloneRoot ?? '')
      this.state.bindings = raw.bindings && typeof raw.bindings === 'object' ? raw.bindings : {}
      for (const binding of Object.values(this.state.bindings)) {
        if (binding && typeof binding === 'object' && !binding.accountId && this.state.accounts.length > 0) {
          binding.accountId = this.state.activeAccountId || this.state.accounts[0].id
          binding.platform = this.accountById(binding.accountId)?.platform ?? 'gitea'
        }
      }
    }
    if (this.state.accounts.length === 0 && typeof this.rawConfig.baseUrl === 'string' && this.rawConfig.baseUrl.trim() !== '') {
      this.state.accounts.push({
        id: 'acc-seed',
        platform: 'gitea',
        baseUrl: normalizeAccountUrl('gitea', this.rawConfig.baseUrl),
        username: typeof this.rawConfig.username === 'string' ? this.rawConfig.username.trim() : '',
        token: typeof this.rawConfig.token === 'string' ? this.rawConfig.token.trim() : '',
      })
      this.state.activeAccountId = 'acc-seed'
    }
    if (this.state.cloneRoot === '' && typeof this.rawConfig.cloneRoot === 'string') {
      this.state.cloneRoot = this.rawConfig.cloneRoot.trim()
    }
    if (!this.accountById(this.state.activeAccountId) && this.state.accounts.length > 0) {
      this.state.activeAccountId = this.state.accounts[0].id
    }
    this.registerRoutes()
    this.registerTool()
    this.registerPromptSection()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    try {
      this.abort.abort()
    } catch {
      /* ignore a double abort */
    }
    void this.persist()
  }

  async persist() {
    try {
      await mkdir(this.directory, { recursive: true })
      const tmp = `${this.stateFile}.tmp`
      await writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
      await rename(tmp, this.stateFile)
    } catch (error) {
      this.log.warn?.(`git-workbench: 保存状态失败: ${messageOf(error)}`)
    }
  }

  /* ---------------------------------------------------------------- state */

  accountById(id) {
    return this.state.accounts.find((account) => account.id === id)
  }

  activeAccount() {
    return this.accountById(this.state.activeAccountId) ?? this.state.accounts[0]
  }

  /** Account for one call: explicit id > session binding > active account. */
  resolveAccount(args, exec) {
    const binding = exec?.agent ? this.bindingFor(exec.agent.id) : undefined
    const id = String(args?.accountId ?? '') || binding?.accountId || this.state.activeAccountId
    return this.accountById(id) ?? this.activeAccount()
  }

  clientFor(args, exec) {
    const account = this.resolveAccount(args, exec)
    if (!account) throw new Error('尚未配置 Git 账号：请在「设置 → Git 工作台」添加平台账号')
    return createClient(account)
  }

  effectiveCloneRoot() {
    const configured = this.state.cloneRoot.trim()
    if (configured !== '') return isAbsolute(configured) ? configured : resolve(this.directory, configured)
    return join(this.directory, 'clones')
  }

  publicAccount(account) {
    return {
      id: account.id,
      platform: account.platform,
      platformLabel: platformMeta(account.platform).label,
      baseUrl: account.baseUrl,
      username: account.username,
      hasToken: account.token !== '',
    }
  }

  publicState() {
    const active = this.activeAccount()
    return {
      configured: Boolean(active && active.baseUrl !== '' && active.token !== ''),
      activeAccountId: active?.id ?? '',
      accounts: this.state.accounts.map((account) => this.publicAccount(account)),
      cloneRoot: this.effectiveCloneRoot(),
    }
  }

  bindingFor(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const binding = this.state.bindings[sessionId]
    return binding && typeof binding === 'object' ? binding : undefined
  }

  /* ------------------------------------------------------ account operations */

  async saveAccount(args, signal) {
    const platform = PLATFORMS[args?.platform] ? args.platform : 'gitea'
    const baseUrl = normalizeAccountUrl(platform, args?.baseUrl)
    if (baseUrl === '') throw new Error(`请填写 ${platformMeta(platform).label} 服务器地址`)
    const id = typeof args?.id === 'string' && args.id.trim() !== '' ? args.id.trim() : ''
    const existing = id ? this.accountById(id) : undefined
    if (id && !existing) throw new Error(`账号不存在：${id}`)
    const token = typeof args?.token === 'string' && args.token.trim() !== '' ? args.token.trim() : existing?.token ?? ''
    if (token === '') throw new Error(`请填写 API 令牌（${platformMeta(platform).tokenHint}）`)
    let username = typeof args?.username === 'string' ? args.username.trim() : existing?.username ?? ''
    const candidate = { id: id || `acc-${randomUUID().slice(0, 8)}`, platform, baseUrl, username, token }
    const profile = await createClient(candidate).account(signal)
    if (username === '') username = profile?.login ?? ''
    candidate.username = username
    if (existing) {
      Object.assign(existing, candidate)
    } else {
      this.state.accounts.push(candidate)
      if (!this.accountById(this.state.activeAccountId)) this.state.activeAccountId = candidate.id
    }
    if (typeof args?.cloneRoot === 'string') this.state.cloneRoot = args.cloneRoot.trim()
    await this.persist()
    return { state: this.publicState(), accountId: candidate.id, account: profile }
  }

  async deleteAccount(args) {
    const id = String(args?.id ?? '').trim()
    const index = this.state.accounts.findIndex((account) => account.id === id)
    if (index < 0) throw new Error(`账号不存在：${id}`)
    this.state.accounts.splice(index, 1)
    if (this.state.activeAccountId === id) this.state.activeAccountId = this.state.accounts[0]?.id ?? ''
    await this.persist()
    return { state: this.publicState() }
  }

  async setActiveAccount(args) {
    const id = String(args?.id ?? '').trim()
    if (!this.accountById(id)) throw new Error(`账号不存在：${id}`)
    this.state.activeAccountId = id
    await this.persist()
    return { state: this.publicState() }
  }

  /* ------------------------------------------------------------ operations */

  async account(args, signal) {
    return this.clientFor(args).account(signal)
  }

  async repos(args, signal) {
    const page = Math.max(1, Number(args?.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 30))
    const query = String(args?.query ?? '').trim()
    return this.clientFor(args).repos({ query, page, limit }, signal)
  }

  async createRepo(args, signal) {
    const name = String(args?.name ?? '').trim()
    if (name === '') throw new Error('仓库名不能为空')
    return this.clientFor(args).createRepo(
      { name, description: args?.description, private: args?.private, autoInit: args?.autoInit },
      signal,
    )
  }

  async deleteRepo(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    return this.clientFor(args).deleteRepo({ owner, repo }, signal)
  }

  async repo(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    return this.clientFor(args).repo({ owner, repo }, signal)
  }

  async updateRepo(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    return this.clientFor(args).updateRepo(
      { owner, repo, name: args?.name, description: args?.description, private: args?.private },
      signal,
    )
  }

  async branches(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    return this.clientFor(args).branches({ owner, repo }, signal)
  }

  async createBranch(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const branch = branchName(args?.branch)
    const from = args?.from ? branchName(args.from) : undefined
    return this.clientFor(args).createBranch({ owner, repo, branch, from }, signal)
  }

  async deleteBranch(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const branch = branchName(args?.branch)
    return this.clientFor(args).deleteBranch({ owner, repo, branch }, signal)
  }

  async commits(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const page = Math.max(1, Number(args?.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 30))
    return this.clientFor(args).commits({ owner, repo, branch: args?.branch, page, limit }, signal)
  }

  /** Branch commit graph assembled from normalized branches + commits. */
  async graph(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const client = this.clientFor(args)
    const limit = Math.min(GRAPH_COMMIT_CAP, Math.max(5, Number(args?.limit) || 40))
    const branchList = await client.branches({ owner, repo }, signal)
    const selected = branchList.slice(0, GRAPH_BRANCH_CAP)
    const nodes = new Map()
    const branches = []
    for (const branch of selected) {
      let commits = []
      try {
        commits = (await client.commits({ owner, repo, branch: branch.name, limit }, signal)).items
      } catch (error) {
        this.log.warn?.(`git-workbench: 读取分支 ${branch.name} 提交失败: ${messageOf(error)}`)
        continue
      }
      branches.push({ name: branch.name, sha: branch.sha, default: branch.default })
      commits.forEach((commit, index) => {
        const existing = nodes.get(commit.sha)
        if (existing) {
          if (index === 0 && !existing.branches.includes(branch.name)) existing.branches.unshift(branch.name)
          return
        }
        nodes.set(commit.sha, { ...commit, branches: index === 0 ? [branch.name] : [] })
      })
    }
    const ordered = [...nodes.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const edges = []
    for (const node of ordered) {
      for (const parent of node.parents) {
        if (nodes.has(parent)) edges.push({ from: node.sha, to: parent })
      }
    }
    return { branches, nodes: ordered, edges }
  }

  async compare(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const base = String(args?.base ?? '').trim()
    const head = String(args?.head ?? '').trim()
    if (base === '' || head === '') throw new Error('compare 需要 base 与 head 两个引用')
    return this.clientFor(args).compare({ owner, repo, base, head }, signal)
  }

  async commitDiff(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const sha = String(args?.ref ?? args?.sha ?? '').trim()
    if (sha === '') throw new Error('缺少提交 sha')
    return this.clientFor(args).commitDiff({ owner, repo, sha }, signal)
  }

  /**
   * Contribution heatmap for one account over the past year. Uses the
   * platform's native heatmap when available (Gitea); otherwise aggregates
   * recent commits across the most recently updated repos (approximate).
   */
  async contributions(args, signal) {
    const account = this.resolveAccount(args)
    if (!account) throw new Error('尚未配置 Git 账号')
    const client = createClient(account)
    const username = String(args?.username ?? account.username ?? '').trim()
    if (username === '') throw new Error('缺少用户名')
    const native = await client.heatmap({ username }, signal).catch(() => null)
    if (native) {
      const items = native.filter((entry) => entry.date >= '1971-01-01')
      return { username, platform: account.platform, approximate: false, items, total: items.reduce((sum, e) => sum + e.contributions, 0) }
    }
    const repos = await client.repos({ limit: 10 }, signal)
    const since = Date.now() - 365 * 24 * 3600 * 1000
    const byDate = new Map()
    for (const repo of repos.items) {
      if (signal?.aborted) throw new Error('已取消')
      const commits = await client.commits({ owner: repo.owner, repo: repo.name, limit: 50 }, signal).catch(() => ({ items: [] }))
      for (const commit of commits.items) {
        const when = Date.parse(commit.date)
        if (!Number.isFinite(when) || when < since) continue
        if ((commit.author || '').toLowerCase() !== username.toLowerCase()) continue
        const day = new Date(when).toISOString().slice(0, 10)
        byDate.set(day, (byDate.get(day) ?? 0) + 1)
      }
    }
    const items = [...byDate.entries()].map(([date, contributions]) => ({ date, contributions })).sort((a, b) => a.date.localeCompare(b.date))
    return { username, platform: account.platform, approximate: true, items, total: items.reduce((sum, e) => sum + e.contributions, 0) }
  }

  async pulls(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const state = ['open', 'closed', 'all'].includes(args?.state) ? args.state : 'open'
    return this.clientFor(args).pulls({ owner, repo, state }, signal)
  }

  async pull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR/MR 编号无效')
    return this.clientFor(args).pull({ owner, repo, index }, signal)
  }

  async createPull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const title = String(args?.title ?? '').trim()
    const head = String(args?.head ?? '').trim()
    const base = String(args?.base ?? '').trim()
    if (title === '' || head === '' || base === '') throw new Error('createPull 需要 title、head、base')
    return this.clientFor(args).createPull({ owner, repo, title, head, base, body: args?.body }, signal)
  }

  async commentPull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR/MR 编号无效')
    const body = String(args?.body ?? '').trim()
    if (body === '') throw new Error('评论内容不能为空')
    return this.clientFor(args).commentPull({ owner, repo, index, body }, signal)
  }

  async mergePull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR/MR 编号无效')
    const style = ['merge', 'rebase', 'rebase-merge', 'squash'].includes(args?.style) ? args.style : 'merge'
    return this.clientFor(args).mergePull({ owner, repo, index, message: args?.message, style }, signal)
  }

  async setPullState(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    const state = args?.state === 'open' ? 'open' : 'closed'
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR/MR 编号无效')
    return this.clientFor(args).setPullState({ owner, repo, index, state }, signal)
  }

  async files(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const path = String(args?.path ?? '').replace(/^\/+|\/+$/g, '')
    const result = await this.clientFor(args).files({ owner, repo, path, ref: args?.ref }, signal)
    result.items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    return result
  }

  async file(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    return this.clientFor(args).file({ owner, repo, path: args?.path, ref: args?.ref }, signal)
  }

  /* ------------------------------------------------------------------- git */

  /** Run one git command with bounded output and a hard timeout. */
  async runGit(args, { cwd, signal, timeoutMs = GIT_TIMEOUT_MS } = {}) {
    const subprocess = this.ctx.get('subprocess')
    if (!subprocess) throw new Error('宿主未提供子进程服务，无法执行 git')
    const collect = { maxBytes: 256 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } }
    const combined = signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal
    const handle = subprocess.spawn({
      argv: ['git', ...args],
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' },
      stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
      graceMs: 5000,
      signal: combined,
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        handle.terminate()
      } catch {
        /* the provider may already have reaped it */
      }
    }, timeoutMs)
    timer.unref?.()
    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      outcome = { exitCode: null, signal: null, error: messageOf(error) }
    } finally {
      clearTimeout(timer)
    }
    const stdout = readCollected(handle, 'stdout')
    const stderr = readCollected(handle, 'stderr')
    const exitCode = typeof outcome?.exitCode === 'number' ? outcome.exitCode : null
    if (timedOut) throw new Error(`git 命令超时（${Math.round(timeoutMs / 1000)}s）：git ${args.slice(0, 3).join(' ')}`)
    if (outcome?.error) throw new Error(`git 执行失败：${outcome.error}`)
    return { exitCode, stdout, stderr, ok: exitCode === 0 }
  }

  /** Clone or update a repository under the clone root; token stays in memory. */
  async clone(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const client = this.clientFor(args)
    const branch = args?.branch ? branchName(args.branch) : ''
    const root = this.effectiveCloneRoot()
    const dir = join(root, owner, repo)
    const auth = client.gitAuthArgs()
    const url = client.cloneUrl(owner, repo)
    let action = 'cloned'
    const existing = await stat(join(dir, '.git')).catch(() => null)
    if (existing) {
      action = 'updated'
      const fetch = await this.runGit([...auth, 'fetch', 'origin', '--prune'], { cwd: dir, signal })
      if (!fetch.ok) throw new Error(`git fetch 失败：${tail(fetch.stderr || fetch.stdout, 600)}`)
      if (branch !== '') {
        let checkout = await this.runGit(['checkout', branch], { cwd: dir, signal })
        if (!checkout.ok) {
          checkout = await this.runGit(['checkout', '-b', branch, `origin/${branch}`], { cwd: dir, signal })
          if (!checkout.ok) throw new Error(`切换分支 ${branch} 失败：${tail(checkout.stderr, 600)}`)
        }
        const merge = await this.runGit(['merge', '--ff-only', `origin/${branch}`], { cwd: dir, signal })
        if (!merge.ok) this.log.warn?.(`git-workbench: ${owner}/${repo} 快进合并失败（可能有本地提交）：${tail(merge.stderr, 300)}`)
      }
    } else {
      await mkdir(join(root, owner), { recursive: true })
      const cloneArgs = [...auth, 'clone', ...(branch !== '' ? ['--branch', branch] : []), url, dir]
      const result = await this.runGit(cloneArgs, { cwd: root, signal })
      if (!result.ok) throw new Error(`git clone 失败：${tail(result.stderr || result.stdout, 800)}`)
    }
    return { path: dir, action }
  }

  /** Resolve the local directory a git operation should run in. */
  resolveProjectPath(args, exec) {
    const explicit = typeof args?.path === 'string' ? args.path.trim() : ''
    if (explicit !== '') return isAbsolute(explicit) ? explicit : resolve(this.workingRoot(exec), explicit)
    const binding = exec?.agent ? this.bindingFor(exec.agent.id) : undefined
    if (binding?.path) return binding.path
    return this.workingRoot(exec)
  }

  workingRoot(exec) {
    const workingDirectory = this.ctx.get('workingDirectory')
    if (exec?.agent && workingDirectory) {
      try {
        return workingDirectory.get(exec.agent.session)
      } catch {
        /* fall through to the deployment default */
      }
    }
    return workingDirectory?.defaultDirectory ?? process.cwd()
  }

  /** Commit the local project and push it to the resolved repository. */
  async push(args, exec, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const account = this.resolveAccount(args, exec)
    const client = this.clientFor(args, exec)
    const message = String(args?.message ?? '').trim()
    if (message === '') throw new Error('提交说明（message）不能为空')
    const branch = args?.branch ? branchName(args.branch) : ''
    const dir = this.resolveProjectPath(args, exec)
    const info = await stat(dir).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`项目目录不存在：${dir}`)
    const auth = client.gitAuthArgs()
    const url = client.cloneUrl(owner, repo)
    const output = []

    const hasGit = await stat(join(dir, '.git')).catch(() => null)
    if (!hasGit) {
      const init = await this.runGit(['init', '-b', branch || 'main'], { cwd: dir, signal })
      if (!init.ok) throw new Error(`git init 失败：${tail(init.stderr, 400)}`)
      output.push('已初始化本地 git 仓库')
    }
    const targetBranch = branch || (await this.currentBranch(dir, signal)) || 'main'

    // Identity: prefer the repository's existing config, else the account.
    const email = await this.runGit(['config', 'user.email'], { cwd: dir, signal })
    if (!email.ok || email.stdout.trim() === '') {
      const profile = await client.account(signal).catch(() => null)
      const name = account?.username || profile?.login || 'git-workbench'
      const mail = profile?.email || `${name}@users.noreply.git`
      await this.runGit(['config', 'user.name', name], { cwd: dir, signal })
      await this.runGit(['config', 'user.email', mail], { cwd: dir, signal })
    }

    const remote = await this.runGit(['remote', 'get-url', 'origin'], { cwd: dir, signal })
    if (!remote.ok) {
      await this.runGit(['remote', 'add', 'origin', url], { cwd: dir, signal })
    } else if (remote.stdout.trim() !== url) {
      await this.runGit(['remote', 'set-url', 'origin', url], { cwd: dir, signal })
    }

    const add = await this.runGit(['add', '-A'], { cwd: dir, signal })
    if (!add.ok) throw new Error(`git add 失败：${tail(add.stderr, 400)}`)
    const staged = await this.runGit(['diff', '--cached', '--quiet'], { cwd: dir, signal })
    let commit = null
    if (staged.exitCode === 1) {
      const committed = await this.runGit(['commit', '-m', message], { cwd: dir, signal })
      if (!committed.ok) throw new Error(`git commit 失败：${tail(committed.stderr || committed.stdout, 600)}`)
      output.push(tail(committed.stdout, 600))
    } else if (staged.exitCode !== 0) {
      throw new Error(`git diff 失败：${tail(staged.stderr, 400)}`)
    } else {
      output.push('没有新的改动可提交，直接推送当前 HEAD')
    }

    const pushed = await this.runGit([...auth, 'push', 'origin', `HEAD:refs/heads/${targetBranch}`], { cwd: dir, signal })
    if (!pushed.ok) {
      const detail = tail(pushed.stderr || pushed.stdout, 800)
      const hint = /rejected|fetch first|non-fast-forward/i.test(detail)
        ? '（远端有新提交：先执行 git pull 同步后再推送）'
        : ''
      throw new Error(`git push 失败${hint}：${detail}`)
    }
    output.push(tail(pushed.stderr || pushed.stdout, 600))
    const head = await this.runGit(['rev-parse', 'HEAD'], { cwd: dir, signal })
    commit = head.ok ? head.stdout.trim() : null
    return { pushed: true, commit, branch: targetBranch, path: dir, output: output.filter(Boolean).join('\n') }
  }

  async currentBranch(dir, signal) {
    const result = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, signal })
    const name = result.stdout.trim()
    return result.ok && name !== '' && name !== 'HEAD' ? name : ''
  }

  /** Fetch and fast-forward the local clone. */
  async gitPull(args, exec, signal) {
    const dir = this.resolveProjectPath(args, exec)
    const info = await stat(join(dir, '.git')).catch(() => null)
    if (!info) throw new Error(`该目录不是 git 仓库：${dir}`)
    const client = this.clientFor(args, exec)
    const branch = args?.branch ? branchName(args.branch) : (await this.currentBranch(dir, signal)) || 'main'
    const auth = client.gitAuthArgs()
    const fetch = await this.runGit([...auth, 'fetch', 'origin', '--prune'], { cwd: dir, signal })
    if (!fetch.ok) throw new Error(`git fetch 失败：${tail(fetch.stderr, 600)}`)
    const merge = await this.runGit(['merge', '--ff-only', `origin/${branch}`], { cwd: dir, signal })
    if (!merge.ok) throw new Error(`快进合并失败（本地可能有分叉提交）：${tail(merge.stderr, 600)}`)
    return { branch, path: dir, output: tail([fetch.stderr, merge.stdout, merge.stderr].filter(Boolean).join('\n'), MAX_OUTPUT_TAIL) }
  }

  /* ------------------------------------------------------- session binding */

  async bind(args, exec) {
    const sessionId = String(args?.sessionId ?? exec?.agent?.id ?? '').trim()
    if (sessionId === '') throw new Error('缺少会话 id')
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const account = this.resolveAccount(args, exec)
    const branch = args?.branch ? branchName(args.branch) : ''
    let path = typeof args?.path === 'string' ? args.path.trim() : ''
    if (path === '') {
      const root = this.effectiveCloneRoot()
      const candidate = join(root, owner, repo)
      const exists = await stat(candidate).catch(() => null)
      if (exists) path = candidate
    }
    const binding = {
      sessionId,
      accountId: account?.id ?? '',
      platform: account?.platform ?? '',
      owner,
      repo,
      branch,
      path,
      boundAt: new Date().toISOString(),
    }
    this.state.bindings[sessionId] = binding
    await this.persist()
    return binding
  }

  async unbind(args, exec) {
    const sessionId = String(args?.sessionId ?? exec?.agent?.id ?? '').trim()
    if (sessionId !== '') {
      delete this.state.bindings[sessionId]
      await this.persist()
    }
    return { unbound: true }
  }

  bindings() {
    return { items: Object.values(this.state.bindings) }
  }

  /** Clone/update a repo locally and register its workspace. */
  async prepareRepo(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const account = this.resolveAccount(args)
    const cloned = await this.clone({ owner, repo, branch: args?.branch, accountId: account?.id }, signal)
    const registry = this.ctx.get('workspaceRegistry')
    let workspaceId = ''
    if (registry) {
      const existing = await registry.resolveByPath(cloned.path)
      const workspace = existing ?? (await registry.create(cloned.path))
      workspaceId = workspace?.id ?? ''
    }
    return { workspaceId, path: cloned.path, branch: args?.branch || '', owner, repo, accountId: account?.id ?? '', platform: account?.platform ?? '' }
  }

  /** Clone + register a workspace so the UI can open a repo-bound session. */
  async openChat(args, signal) {
    return this.prepareRepo(args, signal)
  }

  /** Link one conversation to a repo: clone/update locally, then bind the session. */
  async linkRepo(args, signal, exec) {
    const sessionId = String(args?.sessionId ?? exec?.agent?.id ?? '').trim()
    if (sessionId === '') throw new Error('缺少会话 id')
    const prepared = await this.prepareRepo(args, signal)
    const binding = await this.bind(
      { sessionId, owner: prepared.owner, repo: prepared.repo, branch: prepared.branch, path: prepared.path, accountId: prepared.accountId },
      exec,
    )
    return { ...prepared, sessionId, boundAt: binding.boundAt }
  }

  /* ------------------------------------------------------------------ RPC */

  /** One dispatch table shared by the UI route and the agent tool. */
  operations() {
    return {
      state: async () => this.publicState(),
      saveAccount: (args, signal) => this.saveAccount(args, signal),
      deleteAccount: (args) => this.deleteAccount(args),
      setActiveAccount: (args) => this.setActiveAccount(args),
      account: (args, signal) => this.account(args, signal),
      repos: (args, signal) => this.repos(args, signal),
      createRepo: (args, signal) => this.createRepo(args, signal),
      updateRepo: (args, signal) => this.updateRepo(args, signal),
      deleteRepo: (args, signal) => this.deleteRepo(args, signal),
      repo: (args, signal) => this.repo(args, signal),
      branches: (args, signal) => this.branches(args, signal),
      createBranch: (args, signal) => this.createBranch(args, signal),
      deleteBranch: (args, signal) => this.deleteBranch(args, signal),
      graph: (args, signal) => this.graph(args, signal),
      commits: (args, signal) => this.commits(args, signal),
      compare: (args, signal) => this.compare(args, signal),
      commitDiff: (args, signal) => this.commitDiff(args, signal),
      contributions: (args, signal) => this.contributions(args, signal),
      pulls: (args, signal) => this.pulls(args, signal),
      pull: (args, signal) => this.pull(args, signal),
      createPull: (args, signal) => this.createPull(args, signal),
      commentPull: (args, signal) => this.commentPull(args, signal),
      mergePull: (args, signal) => this.mergePull(args, signal),
      setPullState: (args, signal) => this.setPullState(args, signal),
      files: (args, signal) => this.files(args, signal),
      file: (args, signal) => this.file(args, signal),
      clone: (args, signal, exec) => this.clone(args, signal),
      push: (args, signal, exec) => this.push(args, exec, signal),
      gitPull: (args, signal, exec) => this.gitPull(args, exec, signal),
      bind: (args, signal, exec) => this.bind(args, exec),
      unbind: (args, signal, exec) => this.unbind(args, exec),
      bindings: () => this.bindings(),
      openChat: (args, signal) => this.openChat(args, signal),
      linkRepo: (args, signal, exec) => this.linkRepo(args, signal, exec),
    }
  }

  registerRoutes() {
    this.ctx.inject(['connection'], (connCtx) => {
      const ops = this.operations()
      const dispose = connCtx.connection.fetch.register({
        path: RPC_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let payload
          try {
            const text = await request.text()
            if (text.length > MAX_BODY_BYTES) return jsonResponse(413, { ok: false, error: '请求体过大' })
            payload = JSON.parse(text || '{}')
          } catch {
            return jsonResponse(400, { ok: false, error: '请求体不是有效 JSON' })
          }
          const method = typeof payload?.method === 'string' ? payload.method : ''
          const handler = ops[method]
          if (!handler) return jsonResponse(404, { ok: false, error: `未知方法：${method}` })
          try {
            const value = await handler(payload?.args ?? {}, this.abort.signal, undefined)
            return jsonResponse(200, { ok: true, value })
          } catch (error) {
            return jsonResponse(200, { ok: false, error: messageOf(error) })
          }
        },
      })
      connCtx.effect(() => () => {
        void dispose()
      }, 'git-workbench: rpc route')
    })
  }

  /* ----------------------------------------------------------------- tool */

  registerTool() {
    this.ctx.inject(['tools'], (toolCtx) => {
      const ops = this.operations()
      const definition = {
        name: 'git',
        description:
          'Git 工作台：管理多个 Git 平台账号（Gitea/GitHub/GitLab/Gitee）并同步本地项目。能力：账号（accounts 列出、use_account 切换启用账号）、仓库（repos/create_repo/update_repo/delete_repo）、分支（branches/create_branch/delete_branch/graph）、提交与文件（commits/files/file）、版本对比（compare 对比两个引用、commit_diff 查看单个提交的改动）、贡献统计（contributions 近一年贡献热力图数据）、本地 Git 同步（clone 克隆仓库、push 提交并推送当前项目、pull 拉取远端）、Pull Request/Merge Request（prs/pr/pr_create/pr_comment/pr_merge/pr_state）、会话绑定（link 克隆并关联当前会话到指定仓库、bind/unbind/bindings，绑定后本会话默认操作该仓库）。未配置账号时先用 status 查看并提示用户到「设置 → Git 工作台」添加平台账号。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: [
                'status', 'accounts', 'use_account', 'account',
                'repos', 'create_repo', 'update_repo', 'delete_repo',
                'branches', 'create_branch', 'delete_branch', 'graph', 'commits',
                'compare', 'commit_diff', 'contributions',
                'files', 'file', 'clone', 'push', 'pull',
                'prs', 'pr', 'pr_create', 'pr_comment', 'pr_merge', 'pr_state',
                'link', 'bind', 'unbind', 'bindings',
              ],
              description: '要执行的操作。',
            },
            accountId: { type: 'string', description: '指定账号 id（accounts 可查）。省略时依次使用：会话绑定账号、当前启用账号。' },
            owner: { type: 'string', description: '仓库所有者（用户名或组织；GitLab 可为子组路径）。省略时使用本会话绑定的仓库。' },
            repo: { type: 'string', description: '仓库名。省略时使用本会话绑定的仓库。' },
            branch: { type: 'string', description: '分支名。push 省略时推送当前分支；clone 省略时用默认分支。' },
            from: { type: 'string', description: 'create_branch：源分支，省略时用默认分支。' },
            message: { type: 'string', description: 'push：提交说明（必填）；pr_merge：合并说明（可选）。' },
            title: { type: 'string', description: 'pr_create：PR/MR 标题。' },
            head: { type: 'string', description: 'pr_create：源分支（可写 owner:branch）；compare：对比的目标引用（分支/标签/sha）。' },
            base: { type: 'string', description: 'pr_create：目标分支；compare：对比的基准引用（分支/标签/sha）。' },
            body: { type: 'string', description: 'pr_create 的正文 / pr_comment 的评论内容。' },
            index: { type: 'integer', description: 'PR/MR 编号（pr/pr_comment/pr_merge/pr_state）。' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'prs 的状态过滤；pr_state 的目标状态（open/closed）。' },
            query: { type: 'string', description: 'repos：搜索关键词。' },
            path: { type: 'string', description: '本地项目目录。push/pull 省略时用当前工作目录（或绑定仓库的克隆目录）；file/files 为仓库内路径。' },
            ref: { type: 'string', description: 'file/files：分支或提交 sha，省略用默认分支；commit_diff：提交 sha（必填）。' },
            name: { type: 'string', description: 'create_repo：新仓库名；update_repo：新仓库名（可选）。' },
            description: { type: 'string', description: 'create_repo/update_repo：仓库描述。' },
            private: { type: 'boolean', description: 'create_repo/update_repo：是否私有。' },
            autoInit: { type: 'boolean', description: 'create_repo：是否自动生成初始提交，默认 false。' },
            sessionId: { type: 'string', description: 'bind/unbind/link：目标会话 id，省略为当前会话。' },
            id: { type: 'string', description: 'use_account：要启用的账号 id。' },
            style: { type: 'string', enum: ['merge', 'rebase', 'rebase-merge', 'squash'], description: 'pr_merge：合并方式，默认 merge（平台支持范围不同）。' },
            limit: { type: 'integer', description: 'graph/commits/repos：条数上限。' },
            page: { type: 'integer', description: 'repos/commits：页码，从 1 开始。' },
          },
        },
        timeoutMs: 300000,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [{ type: 'text', text: '```json\n' + JSON.stringify(value, null, 2) + '\n```' }],
        },
        execute: async (args, exec) => {
          const action = args && typeof args === 'object' ? args.action : undefined
          try {
            if (action === 'status') {
              const binding = exec?.agent ? this.bindingFor(exec.agent.id) : undefined
              return { ok: true, state: this.publicState(), binding: binding ?? null }
            }
            if (action === 'accounts') {
              return { ok: true, ...this.publicState() }
            }
            if (action === 'use_account') {
              const value = await this.setActiveAccount({ id: args?.id })
              return { ok: true, ...value }
            }
            const map = {
              account: 'account',
              repos: 'repos',
              create_repo: 'createRepo',
              update_repo: 'updateRepo',
              delete_repo: 'deleteRepo',
              branches: 'branches',
              create_branch: 'createBranch',
              delete_branch: 'deleteBranch',
              graph: 'graph',
              commits: 'commits',
              compare: 'compare',
              commit_diff: 'commitDiff',
              contributions: 'contributions',
              files: 'files',
              file: 'file',
              clone: 'clone',
              push: 'push',
              pull: 'gitPull',
              prs: 'pulls',
              pr: 'pull',
              pr_create: 'createPull',
              pr_comment: 'commentPull',
              pr_merge: 'mergePull',
              pr_state: 'setPullState',
              link: 'linkRepo',
              bind: 'bind',
              unbind: 'unbind',
              bindings: 'bindings',
            }
            const method = map[action]
            if (!method) return { ok: false, error: `未知操作：${String(action)}` }
            const resolved = { ...(args ?? {}) }
            const binding = exec?.agent ? this.bindingFor(exec.agent.id) : undefined
            if (binding) {
              if (!resolved.owner) resolved.owner = binding.owner
              if (!resolved.repo) resolved.repo = binding.repo
              if (!resolved.accountId && binding.accountId) resolved.accountId = binding.accountId
              if (!resolved.branch && binding.branch && ['clone', 'graph', 'commits', 'prs'].includes(action)) {
                resolved.branch = binding.branch
              }
            }
            const value = await ops[method](resolved, exec?.signal ?? this.abort.signal, exec)
            return { ok: true, ...(value && typeof value === 'object' ? value : { value }) }
          } catch (error) {
            return { ok: false, error: messageOf(error) }
          }
        },
      }
      toolCtx.effect(() => toolCtx.tools.register(definition), 'git-workbench: tool')
    })
  }

  /* --------------------------------------------------------- prompt section */

  registerPromptSection() {
    this.ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.effect(
        () =>
          promptCtx.systemPrompt.section({
            name: 'gitea-studio',
            order: 2960,
            interpolate: false,
            text: (context) => {
              const binding = this.bindingFor(context?.agent?.id)
              const active = this.activeAccount()
              const base =
                'Git 工作台插件已启用：git 工具可管理多个 Git 平台账号（Gitea/GitHub/GitLab/Gitee，accounts 列出、use_account 切换）并同步本地 Git。' +
                '用户要求把项目提交/推送到远端时，用 git push（默认提交当前工作目录的全部改动并推送）；' +
                '需要远端仓库上下文时先 git clone；查看分支结构用 git graph，审阅 PR/MR 用 git pr。' +
                '用户消息中的 @git:owner/repo 引用表示把该仓库关联到本会话：若尚未绑定，用 git link（owner/repo）克隆并绑定后再继续。'
              if (!binding) {
                return base + (active ? `当前启用账号：${active.username}（${platformMeta(active.platform).label}）。` : '尚未配置账号，请引导用户到「设置 → Git 工作台」添加。')
              }
              const account = this.accountById(binding.accountId)
              return (
                base +
                `\n本会话绑定仓库 ${binding.owner}/${binding.repo}` +
                (account ? `（${platformMeta(account.platform).label} · ${account.username}）` : '') +
                (binding.branch ? `（分支 ${binding.branch}）` : '') +
                (binding.path ? `，本地路径 ${binding.path}` : '') +
                '。完成代码修改后主动用 git push 提交并推送（写清提交说明），实现自动 Git 迭代；推送被拒绝时先 git pull 同步。'
              )
            },
          }),
        'git-workbench: prompt section',
      )
    })
  }
}

/**
 * Host entrypoint.
 * @param ctx - the plugin context.
 * @param config - the Loader row config (first-start defaults).
 */
export async function apply(ctx, config) {
  const workbench = new GitWorkbench(ctx, config)
  ctx.effect(() => () => workbench.dispose(), 'git-workbench: lifecycle')
  try {
    await workbench.init()
  } catch (error) {
    ;(ctx.logger ?? console).warn?.(`git-workbench: 初始化失败: ${messageOf(error)}`)
  }
}
