/**
 * Gitea Studio — Host half.
 *
 * Binds one Gitea account (server URL + username + API token) and exposes it
 * to two callers through one shared operation layer:
 *   - the Web UI, through an authenticated JSON RPC route on the shared /api
 *     channel (`ctx.connection.fetch`), and
 *   - the model, through the `gitea` agent tool.
 *
 * Git work (clone / push / pull) runs through the Host subprocess service with
 * per-command HTTP Basic auth headers, so the token never lands in .git/config
 * or on disk. Settings and session bindings persist beside the profile in
 * `data/gitea-studio/state.json` (mode 0600); the bundle row config only seeds
 * first-start defaults.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const RPC_PATH = '/api/gitea-studio/rpc'
const STATE_VERSION = 1
const MAX_BODY_BYTES = 256 * 1024
const MAX_FILE_BYTES = 512 * 1024
const MAX_OUTPUT_TAIL = 4000
const GIT_TIMEOUT_MS = 180000
const API_TIMEOUT_MS = 30000
const GRAPH_BRANCH_CAP = 12
const GRAPH_COMMIT_CAP = 60

/** Report the deployment data directory for this plugin. */
function dataDirectory() {
  if (process.env.DSH_PROFILE_DIR) return join(process.env.DSH_PROFILE_DIR, 'data', 'gitea-studio')
  return join(homedir(), '.dsh', 'gitea-studio')
}

/** Turn an unknown thrown value into readable text. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Keep the tail of a long text, bounded by characters. */
function tail(text, limit) {
  const value = typeof text === 'string' ? text : ''
  return value.length <= limit ? value : `…${value.slice(value.length - limit)}`
}

/** Normalize a Gitea server URL: protocol, no trailing slash, no /api suffix. */
function normalizeBaseUrl(raw) {
  let value = String(raw ?? '').trim()
  if (value === '') return ''
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  value = value.replace(/\/+$/, '')
  value = value.replace(/\/api\/v1$/i, '')
  return value
}

/** Validate an owner/repo path segment pair. */
function repoRef(owner, repo) {
  const o = String(owner ?? '').trim()
  const r = String(repo ?? '').trim()
  if (!/^[\w.-]+$/.test(o) || !/^[\w.-]+$/.test(r)) throw new Error('仓库标识无效：需要 owner 与 repo（仅字母、数字、_ . -）')
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

/**
 * Minimal Gitea REST client over the platform fetch. Every failure carries the
 * server's own message when present.
 */
class GiteaClient {
  constructor({ baseUrl, username, token }) {
    this.baseUrl = baseUrl
    this.username = username
    this.token = token
  }

  get configured() {
    return this.baseUrl !== '' && this.token !== ''
  }

  async request(method, path, { query, body, signal } = {}) {
    if (!this.configured) throw new Error('尚未配置 Gitea 账号：请在「设置 → Gitea 工作台」填写服务器地址与 API 令牌')
    const url = new URL(`${this.baseUrl}/api/v1${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    const timeout = AbortSignal.timeout(API_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `token ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: combined,
      })
    } catch (error) {
      if (combined.aborted && !signal?.aborted) throw new Error(`Gitea 请求超时：${method} ${path}`)
      throw new Error(`无法连接 Gitea（${this.baseUrl}）：${messageOf(error)}`)
    }
    const text = await response.text()
    let data = null
    try {
      data = text === '' ? null : JSON.parse(text)
    } catch {
      data = null
    }
    if (!response.ok) {
      const detail = data && typeof data.message === 'string' ? data.message : tail(text, 300) || `HTTP ${response.status}`
      throw new Error(`Gitea ${method} ${path} 失败（${response.status}）：${detail}`)
    }
    return data
  }

  /** HTTP Basic credential for git over HTTP(S); never written to disk. */
  gitAuthArgs() {
    const user = this.username || 'gitea'
    const basic = Buffer.from(`${user}:${this.token}`, 'utf8').toString('base64')
    return ['-c', `http.extraHeader=Authorization: Basic ${basic}`, '-c', 'credential.helper=']
  }
}

/** Map one Gitea repository payload to the compact wire shape. */
function mapRepo(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    owner: raw.owner?.login ?? '',
    name: raw.name ?? '',
    fullName: raw.full_name ?? `${raw.owner?.login ?? ''}/${raw.name ?? ''}`,
    description: raw.description ?? '',
    private: Boolean(raw.private),
    fork: Boolean(raw.fork),
    empty: Boolean(raw.empty),
    stars: raw.stars_count ?? 0,
    forks: raw.forks_count ?? 0,
    updatedAt: raw.updated_at ?? '',
    defaultBranch: raw.default_branch ?? 'main',
    htmlUrl: raw.html_url ?? '',
    cloneUrl: raw.clone_url ?? '',
  }
}

/** Map one Gitea pull request payload to the compact wire shape. */
function mapPull(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    index: raw.number ?? 0,
    title: raw.title ?? '',
    state: raw.state ?? 'open',
    merged: Boolean(raw.merged),
    author: { login: raw.user?.login ?? '', avatarUrl: raw.user?.avatar_url ?? '' },
    head: { label: raw.head?.label ?? '', ref: raw.head?.ref ?? '' },
    base: { label: raw.base?.label ?? '', ref: raw.base?.ref ?? '' },
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? '',
    htmlUrl: raw.html_url ?? '',
    body: raw.body ?? '',
    comments: raw.comments ?? 0,
  }
}

/** Map one Gitea commit payload. */
function mapCommit(raw) {
  const author = raw.commit?.author ?? raw.author ?? {}
  return {
    sha: raw.sha ?? '',
    short: (raw.sha ?? '').slice(0, 7),
    message: raw.commit?.message ?? '',
    author: author.name ?? raw.author?.login ?? '',
    date: author.date ?? '',
    htmlUrl: raw.html_url ?? '',
    parents: Array.isArray(raw.parents) ? raw.parents.map((p) => p?.sha ?? '').filter(Boolean) : [],
  }
}

/** One changed file in a diff (PR, compare, or single commit). */
function mapDiffFile(file) {
  return {
    filename: file?.filename ?? '',
    status: file?.status ?? '',
    additions: file?.additions ?? 0,
    deletions: file?.deletions ?? 0,
    patch: file?.patch ?? '',
  }
}

/** One studio instance owns state, the API client, routes, git, and the tool. */
class GiteaStudio {
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
      baseUrl: '',
      username: '',
      token: '',
      cloneRoot: '',
      bindings: {},
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  async init() {
    await mkdir(this.directory, { recursive: true })
    try {
      const raw = JSON.parse(await readFile(this.stateFile, 'utf8'))
      if (raw && typeof raw === 'object') {
        this.state.baseUrl = normalizeBaseUrl(raw.baseUrl)
        this.state.username = String(raw.username ?? '')
        this.state.token = String(raw.token ?? '')
        this.state.cloneRoot = String(raw.cloneRoot ?? '')
        this.state.bindings = raw.bindings && typeof raw.bindings === 'object' ? raw.bindings : {}
      }
    } catch {
      /* first start or unreadable state: seed from the row config */
    }
    if (this.state.baseUrl === '' && typeof this.rawConfig.baseUrl === 'string') {
      this.state.baseUrl = normalizeBaseUrl(this.rawConfig.baseUrl)
    }
    if (this.state.username === '' && typeof this.rawConfig.username === 'string') {
      this.state.username = this.rawConfig.username.trim()
    }
    if (this.state.token === '' && typeof this.rawConfig.token === 'string') {
      this.state.token = this.rawConfig.token.trim()
    }
    if (this.state.cloneRoot === '' && typeof this.rawConfig.cloneRoot === 'string') {
      this.state.cloneRoot = this.rawConfig.cloneRoot.trim()
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
      this.log.warn?.(`gitea-studio: 保存状态失败: ${messageOf(error)}`)
    }
  }

  /* ---------------------------------------------------------------- state */

  client() {
    return new GiteaClient({ baseUrl: this.state.baseUrl, username: this.state.username, token: this.state.token })
  }

  effectiveCloneRoot() {
    const configured = this.state.cloneRoot.trim()
    if (configured !== '') return isAbsolute(configured) ? configured : resolve(this.directory, configured)
    return join(this.directory, 'clones')
  }

  publicState() {
    return {
      configured: this.state.baseUrl !== '' && this.state.token !== '',
      baseUrl: this.state.baseUrl,
      username: this.state.username,
      hasToken: this.state.token !== '',
      cloneRoot: this.effectiveCloneRoot(),
    }
  }

  bindingFor(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const binding = this.state.bindings[sessionId]
    return binding && typeof binding === 'object' ? binding : undefined
  }

  /* ------------------------------------------------------------ operations */

  async account(signal) {
    const raw = await this.client().request('GET', '/user', { signal })
    return {
      login: raw?.login ?? '',
      name: raw?.full_name ?? '',
      avatarUrl: raw?.avatar_url ?? '',
      email: raw?.email ?? '',
      htmlUrl: raw?.html_url ?? '',
    }
  }

  async saveSettings(args, signal) {
    const baseUrl = normalizeBaseUrl(args?.baseUrl)
    if (baseUrl === '') throw new Error('请填写 Gitea 服务器地址')
    const token = typeof args?.token === 'string' && args.token.trim() !== '' ? args.token.trim() : this.state.token
    if (token === '') throw new Error('请填写 API 令牌（Gitea → 设置 → 应用 → 生成令牌）')
    let username = typeof args?.username === 'string' ? args.username.trim() : ''
    const candidate = new GiteaClient({ baseUrl, username, token })
    const profile = await candidate.request('GET', '/user', { signal })
    if (username === '') username = profile?.login ?? ''
    this.state.baseUrl = baseUrl
    this.state.username = username
    this.state.token = token
    if (typeof args?.cloneRoot === 'string') this.state.cloneRoot = args.cloneRoot.trim()
    await this.persist()
    return {
      state: this.publicState(),
      account: {
        login: profile?.login ?? '',
        name: profile?.full_name ?? '',
        avatarUrl: profile?.avatar_url ?? '',
        email: profile?.email ?? '',
        htmlUrl: profile?.html_url ?? '',
      },
    }
  }

  async clearSettings() {
    this.state.baseUrl = ''
    this.state.username = ''
    this.state.token = ''
    await this.persist()
    return { state: this.publicState() }
  }

  async repos(args, signal) {
    const client = this.client()
    const page = Math.max(1, Number(args?.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 30))
    const query = String(args?.query ?? '').trim()
    let items
    if (query !== '') {
      const result = await client.request('GET', '/repos/search', { query: { q: query, page, limit }, signal })
      items = Array.isArray(result?.data) ? result.data : []
    } else {
      items = await client.request('GET', '/user/repos', { query: { page, limit }, signal })
    }
    const mapped = (Array.isArray(items) ? items : []).map(mapRepo).filter(Boolean)
    return { items: mapped, page, hasMore: mapped.length === limit }
  }

  async createRepo(args, signal) {
    const name = String(args?.name ?? '').trim()
    if (!/^[\w.-]+$/.test(name)) throw new Error('仓库名无效（仅字母、数字、_ . -）')
    const raw = await this.client().request('POST', '/user/repos', {
      body: {
        name,
        description: String(args?.description ?? ''),
        private: Boolean(args?.private),
        auto_init: Boolean(args?.autoInit),
      },
      signal,
    })
    return mapRepo(raw)
  }

  async deleteRepo(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    await this.client().request('DELETE', `/repos/${owner}/${repo}`, { signal })
    return { deleted: true }
  }

  async repo(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    return mapRepo(await this.client().request('GET', `/repos/${owner}/${repo}`, { signal }))
  }

  async branches(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const client = this.client()
    const [raw, repoInfo] = await Promise.all([
      client.request('GET', `/repos/${owner}/${repo}/branches`, { query: { limit: 100 }, signal }),
      client.request('GET', `/repos/${owner}/${repo}`, { signal }),
    ])
    const defaultBranch = repoInfo?.default_branch ?? ''
    return (Array.isArray(raw) ? raw : []).map((branch) => ({
      name: branch?.name ?? '',
      sha: branch?.commit?.id ?? '',
      protected: Boolean(branch?.protected),
      default: branch?.name === defaultBranch,
    }))
  }

  async createBranch(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const branch = branchName(args?.branch)
    const from = args?.from ? branchName(args.from) : undefined
    const raw = await this.client().request('POST', `/repos/${owner}/${repo}/branches`, {
      body: { new_branch_name: branch, ...(from ? { old_branch_name: from } : {}) },
      signal,
    })
    return { name: raw?.name ?? branch, sha: raw?.commit?.id ?? '' }
  }

  async deleteBranch(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const branch = branchName(args?.branch)
    await this.client().request('DELETE', `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { signal })
    return { deleted: true }
  }

  /** Commit DAG across branch tips, for the visual branch graph. */
  async graph(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const client = this.client()
    const limit = Math.min(GRAPH_COMMIT_CAP, Math.max(5, Number(args?.limit) || 40))
    const branchList = await this.branches({ owner, repo }, signal)
    const selected = branchList.slice(0, GRAPH_BRANCH_CAP)
    const nodes = new Map()
    const branches = []
    for (const branch of selected) {
      let commits = []
      try {
        commits = await client.request('GET', `/repos/${owner}/${repo}/commits`, {
          query: { sha: branch.name, limit },
          signal,
        })
      } catch (error) {
        this.log.warn?.(`gitea-studio: 读取分支 ${branch.name} 提交失败: ${messageOf(error)}`)
        continue
      }
      const mapped = (Array.isArray(commits) ? commits : []).map(mapCommit)
      branches.push({ name: branch.name, sha: branch.sha, default: branch.default })
      mapped.forEach((commit, index) => {
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

  async commits(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const page = Math.max(1, Number(args?.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 30))
    const raw = await this.client().request('GET', `/repos/${owner}/${repo}/commits`, {
      query: { sha: args?.branch || undefined, page, limit },
      signal,
    })
    const items = (Array.isArray(raw) ? raw : []).map(mapCommit)
    return { items, hasMore: items.length === limit }
  }

  /** Compare two refs (branches, tags, or shas): commits between plus the aggregate diff. */
  async compare(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const base = String(args?.base ?? '').trim()
    const head = String(args?.head ?? '').trim()
    if (base === '' || head === '') throw new Error('compare 需要 base 与 head 两个引用')
    const raw = await this.client().request(
      'GET',
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      { signal },
    )
    return {
      base,
      head,
      aheadBy: raw?.ahead_by ?? 0,
      behindBy: raw?.behind_by ?? 0,
      totalCommits: raw?.total_commits ?? 0,
      commits: (Array.isArray(raw?.commits) ? raw.commits : []).map(mapCommit),
      files: (Array.isArray(raw?.files) ? raw.files : []).map(mapDiffFile),
    }
  }

  /** One commit's metadata and its changed files with patches. */
  async commitDiff(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const sha = String(args?.ref ?? args?.sha ?? '').trim()
    if (sha === '') throw new Error('缺少提交 sha')
    const raw = await this.client().request('GET', `/repos/${owner}/${repo}/git/commits/${encodeURIComponent(sha)}`, { signal })
    return {
      commit: mapCommit(raw),
      stats: raw?.stats ?? { additions: 0, deletions: 0, total: 0 },
      files: (Array.isArray(raw?.files) ? raw.files : []).map(mapDiffFile),
    }
  }

  /**
   * Contribution heatmap for the bound account over the past year.
   * Prefers Gitea's native heatmap endpoint; older servers fall back to
   * aggregating recent commits across the most recently updated repos.
   */
  async contributions(args, signal) {
    const state = this.publicState()
    if (!state.configured) throw new Error('尚未配置 Gitea 账号')
    const username = String(args?.username ?? state.username ?? '').trim()
    if (username === '') throw new Error('缺少用户名')
    const client = this.client()
    try {
      const raw = await client.request('GET', `/users/${encodeURIComponent(username)}/heatmap`, { signal })
      const items = (Array.isArray(raw) ? raw : [])
        .map((entry) => ({
          date: new Date(Number(entry?.timestamp ?? 0) * 1000).toISOString().slice(0, 10),
          contributions: Number(entry?.contributions ?? 0),
        }))
        .filter((entry) => entry.date >= '1971-01-01')
      return { username, approximate: false, items, total: items.reduce((sum, e) => sum + e.contributions, 0) }
    } catch (error) {
      if (signal?.aborted) throw error
      /* Fallback: aggregate commits authored by this user across recent repos. */
      const repos = await this.repos({ limit: 10 }, signal)
      const since = Date.now() - 365 * 24 * 3600 * 1000
      const byDate = new Map()
      for (const repo of repos.items) {
        if (signal?.aborted) throw new Error('已取消')
        const commits = await this.commits({ owner: repo.owner, repo: repo.name, limit: 50 }, signal).catch(() => ({ items: [] }))
        for (const commit of commits.items) {
          const when = Date.parse(commit.date)
          if (!Number.isFinite(when) || when < since) continue
          const author = (commit.author || '').toLowerCase()
          if (author !== username.toLowerCase() && author !== (state.username || '').toLowerCase()) continue
          const day = new Date(when).toISOString().slice(0, 10)
          byDate.set(day, (byDate.get(day) ?? 0) + 1)
        }
      }
      const items = [...byDate.entries()].map(([date, contributions]) => ({ date, contributions })).sort((a, b) => a.date.localeCompare(b.date))
      return { username, approximate: true, items, total: items.reduce((sum, e) => sum + e.contributions, 0) }
    }
  }

  async pulls(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const state = ['open', 'closed', 'all'].includes(args?.state) ? args.state : 'open'
    const raw = await this.client().request('GET', `/repos/${owner}/${repo}/pulls`, {
      query: { state, limit: 50 },
      signal,
    })
    return { items: (Array.isArray(raw) ? raw : []).map(mapPull).filter(Boolean) }
  }

  async pull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR 编号无效')
    const client = this.client()
    const [raw, files, comments] = await Promise.all([
      client.request('GET', `/repos/${owner}/${repo}/pulls/${index}`, { signal }),
      client.request('GET', `/repos/${owner}/${repo}/pulls/${index}/files`, { query: { limit: 100 }, signal }).catch(() => []),
      client.request('GET', `/repos/${owner}/${repo}/issues/${index}/comments`, { query: { limit: 100 }, signal }).catch(() => []),
    ])
    return {
      pull: mapPull(raw),
      files: (Array.isArray(files) ? files : []).map(mapDiffFile),
      comments: (Array.isArray(comments) ? comments : []).map((comment) => ({
        id: comment?.id ?? 0,
        author: { login: comment?.user?.login ?? '', avatarUrl: comment?.user?.avatar_url ?? '' },
        body: comment?.body ?? '',
        createdAt: comment?.created_at ?? '',
      })),
    }
  }

  async createPull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const title = String(args?.title ?? '').trim()
    const head = String(args?.head ?? '').trim()
    const base = String(args?.base ?? '').trim()
    if (title === '' || head === '' || base === '') throw new Error('创建 PR 需要 title、head（源分支）与 base（目标分支）')
    const raw = await this.client().request('POST', `/repos/${owner}/${repo}/pulls`, {
      body: { title, head, base, body: String(args?.body ?? '') },
      signal,
    })
    return mapPull(raw)
  }

  async commentPull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    const body = String(args?.body ?? '').trim()
    if (!Number.isSafeInteger(index) || index <= 0 || body === '') throw new Error('评论需要有效的 PR 编号与内容')
    const raw = await this.client().request('POST', `/repos/${owner}/${repo}/issues/${index}/comments`, {
      body: { body },
      signal,
    })
    return {
      id: raw?.id ?? 0,
      author: { login: raw?.user?.login ?? '', avatarUrl: raw?.user?.avatar_url ?? '' },
      body: raw?.body ?? '',
      createdAt: raw?.created_at ?? '',
    }
  }

  async mergePull(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR 编号无效')
    const style = ['merge', 'rebase', 'rebase-merge', 'squash'].includes(args?.style) ? args.style : 'merge'
    await this.client().request('POST', `/repos/${owner}/${repo}/pulls/${index}/merge`, {
      body: { Do: style, ...(args?.message ? { MergeMessageField: String(args.message) } : {}) },
      signal,
    })
    return { merged: true }
  }

  async setPullState(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const index = Number(args?.index)
    const state = args?.state === 'open' ? 'open' : 'closed'
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error('PR 编号无效')
    const raw = await this.client().request('PATCH', `/repos/${owner}/${repo}/pulls/${index}`, {
      body: { state },
      signal,
    })
    return mapPull(raw)
  }

  async files(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const path = String(args?.path ?? '').replace(/^\/+|\/+$/g, '')
    const raw = await this.client().request('GET', `/repos/${owner}/${repo}/contents/${path}`, {
      query: { ref: args?.ref || undefined },
      signal,
    })
    const items = (Array.isArray(raw) ? raw : []).map((entry) => ({
      name: entry?.name ?? '',
      path: entry?.path ?? '',
      type: entry?.type === 'dir' ? 'dir' : 'file',
      size: entry?.size ?? 0,
    }))
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    return { items }
  }

  async file(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const path = String(args?.path ?? '').replace(/^\/+/, '')
    if (path === '') throw new Error('文件路径不能为空')
    const raw = await this.client().request('GET', `/repos/${owner}/${repo}/contents/${path}`, {
      query: { ref: args?.ref || undefined },
      signal,
    })
    if (Array.isArray(raw)) throw new Error('该路径是目录，请使用 files 操作')
    if ((raw?.size ?? 0) > MAX_FILE_BYTES) throw new Error('文件过大，无法在线查看（>512KB）')
    const content = raw?.encoding === 'base64' ? Buffer.from(raw.content ?? '', 'base64').toString('utf8') : String(raw?.content ?? '')
    return { path: raw?.path ?? path, content, size: raw?.size ?? content.length }
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

  cleanCloneUrl(owner, repo) {
    return `${this.state.baseUrl}/${owner}/${repo}.git`
  }

  /** Clone or update a repository under the clone root; token stays in memory. */
  async clone(args, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const client = this.client()
    if (!client.configured) throw new Error('尚未配置 Gitea 账号')
    const branch = args?.branch ? branchName(args.branch) : ''
    const root = this.effectiveCloneRoot()
    const dir = join(root, owner, repo)
    const auth = client.gitAuthArgs()
    const url = this.cleanCloneUrl(owner, repo)
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
        if (!merge.ok) this.log.warn?.(`gitea-studio: ${owner}/${repo} 快进合并失败（可能有本地提交）：${tail(merge.stderr, 300)}`)
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

  /** Commit the local project and push it to the bound Gitea repository. */
  async push(args, exec, signal) {
    const { owner, repo } = repoRef(args?.owner, args?.repo)
    const client = this.client()
    if (!client.configured) throw new Error('尚未配置 Gitea 账号')
    const message = String(args?.message ?? '').trim()
    if (message === '') throw new Error('提交说明（message）不能为空')
    const branch = args?.branch ? branchName(args.branch) : ''
    const dir = this.resolveProjectPath(args, exec)
    const info = await stat(dir).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`项目目录不存在：${dir}`)
    const auth = client.gitAuthArgs()
    const url = this.cleanCloneUrl(owner, repo)
    const output = []

    const hasGit = await stat(join(dir, '.git')).catch(() => null)
    if (!hasGit) {
      const init = await this.runGit(['init', '-b', branch || 'main'], { cwd: dir, signal })
      if (!init.ok) throw new Error(`git init 失败：${tail(init.stderr, 400)}`)
      output.push('已初始化本地 git 仓库')
    }
    const targetBranch = branch || (await this.currentBranch(dir, signal)) || 'main'

    // Identity: prefer the repository's existing config, else the Gitea account.
    const email = await this.runGit(['config', 'user.email'], { cwd: dir, signal })
    if (!email.ok || email.stdout.trim() === '') {
      const account = await this.account(signal).catch(() => null)
      const name = this.state.username || account?.login || 'gitea-studio'
      const mail = account?.email || `${name}@users.noreply.gitea`
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
        ? '（远端有新提交：先执行 gitea pull 同步后再推送）'
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
    const client = this.client()
    if (!client.configured) throw new Error('尚未配置 Gitea 账号')
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
    const branch = args?.branch ? branchName(args.branch) : ''
    let path = typeof args?.path === 'string' ? args.path.trim() : ''
    if (path === '') {
      const candidate = join(this.effectiveCloneRoot(), owner, repo)
      const exists = await stat(join(candidate, '.git')).catch(() => null)
      if (exists) path = candidate
    }
    const binding = { sessionId, owner, repo, branch, path, boundAt: new Date().toISOString() }
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
    const cloned = await this.clone({ owner, repo, branch: args?.branch }, signal)
    const registry = this.ctx.get('workspaceRegistry')
    let workspaceId = ''
    if (registry) {
      const existing = await registry.resolveByPath(cloned.path)
      const workspace = existing ?? (await registry.create(cloned.path))
      workspaceId = workspace?.id ?? ''
    }
    return { workspaceId, path: cloned.path, branch: args?.branch || '', owner, repo }
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
      { sessionId, owner: prepared.owner, repo: prepared.repo, branch: prepared.branch, path: prepared.path },
      exec,
    )
    return { ...prepared, sessionId, boundAt: binding.boundAt }
  }

  /* ------------------------------------------------------------------ RPC */

  /** One dispatch table shared by the UI route and the agent tool. */
  operations() {
    return {
      state: async () => this.publicState(),
      saveSettings: (args, signal) => this.saveSettings(args, signal),
      clearSettings: () => this.clearSettings(),
      account: (args, signal) => this.account(signal),
      repos: (args, signal) => this.repos(args, signal),
      createRepo: (args, signal) => this.createRepo(args, signal),
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
      }, 'gitea-studio: rpc route')
    })
  }

  /* ----------------------------------------------------------------- tool */

  registerTool() {
    this.ctx.inject(['tools'], (toolCtx) => {
      const ops = this.operations()
      const definition = {
        name: 'gitea',
        description:
          '管理已绑定的 Gitea 账号并把本地项目同步到 Gitea。能力：账号与仓库（repos/create_repo/delete_repo）、分支（branches/create_branch/delete_branch/graph）、提交与文件（commits/files/file）、版本对比（compare 对比两个引用、commit_diff 查看单个提交的改动）、贡献统计（contributions 近一年贡献热力图数据）、本地 Git 同步（clone 克隆仓库、push 提交并推送当前项目、pull 拉取远端）、Pull Request（prs/pr/pr_create/pr_comment/pr_merge/pr_state）、会话绑定（link 克隆并关联当前会话到指定仓库、bind/unbind/bindings，绑定后本会话默认操作该仓库）。未配置账号时先用 status 查看并提示用户到「设置 → Gitea 工作台」填写。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: [
                'status', 'account', 'repos', 'create_repo', 'delete_repo',
                'branches', 'create_branch', 'delete_branch', 'graph', 'commits',
                'compare', 'commit_diff', 'contributions',
                'files', 'file', 'clone', 'push', 'pull',
                'prs', 'pr', 'pr_create', 'pr_comment', 'pr_merge', 'pr_state',
                'link', 'bind', 'unbind', 'bindings',
              ],
              description: '要执行的操作。',
            },
            owner: { type: 'string', description: '仓库所有者（用户名或组织）。省略时使用本会话绑定的仓库。' },
            repo: { type: 'string', description: '仓库名。省略时使用本会话绑定的仓库。' },
            branch: { type: 'string', description: '分支名。push 省略时推送当前分支；clone 省略时用默认分支。' },
            from: { type: 'string', description: 'create_branch：源分支，省略时用默认分支。' },
            message: { type: 'string', description: 'push：提交说明（必填）；pr_merge：合并说明（可选）。' },
            title: { type: 'string', description: 'pr_create：PR 标题。' },
            head: { type: 'string', description: 'pr_create：源分支（可写 owner:branch）；compare：对比的目标引用（分支/标签/sha）。' },
            base: { type: 'string', description: 'pr_create：目标分支；compare：对比的基准引用（分支/标签/sha）。' },
            body: { type: 'string', description: 'pr_create 的正文 / pr_comment 的评论内容。' },
            index: { type: 'integer', description: 'PR 编号（pr/pr_comment/pr_merge/pr_state）。' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'prs 的状态过滤；pr_state 的目标状态（open/closed）。' },
            query: { type: 'string', description: 'repos：搜索关键词。' },
            path: { type: 'string', description: '本地项目目录。push/pull 省略时用当前工作目录（或绑定仓库的克隆目录）；file/files 为仓库内路径。' },
            ref: { type: 'string', description: 'file/files：分支或提交 sha，省略用默认分支；commit_diff：提交 sha（必填）。' },
            name: { type: 'string', description: 'create_repo：新仓库名。' },
            description: { type: 'string', description: 'create_repo：仓库描述。' },
            private: { type: 'boolean', description: 'create_repo：是否私有，默认 false。' },
            autoInit: { type: 'boolean', description: 'create_repo：是否自动生成初始提交，默认 false。' },
            sessionId: { type: 'string', description: 'bind/unbind/link：目标会话 id，省略为当前会话。' },
            style: { type: 'string', enum: ['merge', 'rebase', 'rebase-merge', 'squash'], description: 'pr_merge：合并方式，默认 merge。' },
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
            const map = {
              account: 'account',
              repos: 'repos',
              create_repo: 'createRepo',
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
      toolCtx.effect(() => toolCtx.tools.register(definition), 'gitea-studio: tool')
    })
  }

  /* --------------------------------------------------------------- prompt */

  registerPromptSection() {
    this.ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.effect(
        () =>
          promptCtx.systemPrompt.section({
            name: 'gitea-studio',
            order: 2960,
            interpolate: false,
            text: (context) => {
              const agent = context?.agent
              const binding = agent ? this.bindingFor(agent.id) : undefined
              const base =
                'Gitea Studio 插件已启用：gitea 工具可管理绑定的 Gitea 账号（仓库、分支、PR）并同步本地 Git。' +
                '用户要求把项目提交/推送到 Gitea 时，用 gitea push（默认提交当前工作目录的全部改动并推送）；' +
                '需要远端仓库上下文时先 gitea clone；查看分支结构用 gitea graph，审阅 PR 用 gitea pr。' +
                '用户消息中的 @gitea:owner/repo 引用表示把该仓库关联到本会话：若尚未绑定，用 gitea link（owner/repo）克隆并绑定后再继续。'
              if (!binding) return base
              return (
                `${base}\n本会话绑定仓库 ${binding.owner}/${binding.repo}` +
                (binding.branch ? `（分支 ${binding.branch}）` : '') +
                (binding.path ? `，本地路径 ${binding.path}` : '') +
                '。完成代码修改后主动用 gitea push 提交并推送（写清提交说明），实现自动 Git 迭代；推送被拒绝时先 gitea pull 同步。'
              )
            },
          }),
        'gitea-studio: prompt section',
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
  const studio = new GiteaStudio(ctx, config)
  ctx.effect(() => () => studio.dispose(), 'gitea-studio: lifecycle')
  try {
    await studio.init()
  } catch (error) {
    ;(ctx.logger ?? console).warn?.(`gitea-studio: 初始化失败: ${messageOf(error)}`)
  }
}