/**
 * Git Workbench — platform adapters.
 *
 * One normalized API face over Gitea, GitHub, GitLab, and Gitee so the Host
 * half (and therefore the UI and the agent tool) stays platform-agnostic.
 * Every method resolves to the shared shapes documented in README.md:
 * Repo / Branch / Commit / Pull / DiffFile / Entry / Comment.
 */

const API_TIMEOUT_MS = 30000
const MAX_FILE_BYTES = 512 * 1024

export const PLATFORMS = {
  gitea: {
    id: 'gitea',
    label: 'Gitea',
    defaultBaseUrl: 'https://gitea.com',
    tokenHint: 'Gitea → 设置 → 应用 → 生成令牌（勾选 repo 权限）',
  },
  github: {
    id: 'github',
    label: 'GitHub',
    defaultBaseUrl: 'https://api.github.com',
    tokenHint: 'GitHub → Settings → Developer settings → Personal access tokens（repo 范围）',
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    defaultBaseUrl: 'https://gitlab.com',
    tokenHint: 'GitLab → Preferences → Access Tokens（api 范围）',
  },
  gitee: {
    id: 'gitee',
    label: 'Gitee',
    defaultBaseUrl: 'https://gitee.com',
    tokenHint: 'Gitee → 设置 → 私人令牌（勾选 projects 权限）',
  },
}

export function platformMeta(id) {
  return PLATFORMS[id] ?? PLATFORMS.gitea
}

export function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function b64(value) {
  return Buffer.from(value, 'utf8').toString('base64')
}

function decodeContent(raw) {
  if (raw?.encoding === 'base64') return Buffer.from(String(raw.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8')
  return String(raw?.content ?? '')
}

/** Count +/- lines in a unified diff when the platform omits stat counters. */
function diffStats(patch) {
  let additions = 0
  let deletions = 0
  for (const line of String(patch ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

/* ------------------------------------------------------------ normalizers */

function mapGitHubRepo(raw) {
  const owner = raw?.owner?.login ?? raw?.namespace?.path ?? String(raw?.full_name ?? '').split('/')[0] ?? ''
  const name = raw?.name ?? ''
  return {
    owner,
    name,
    fullName: raw?.full_name ?? (owner ? owner + '/' + name : name),
    description: raw?.description ?? '',
    private: Boolean(raw?.private),
    fork: Boolean(raw?.fork),
    empty: Boolean(raw?.empty ?? raw?.empty_repo ?? (raw?.size === 0)),
    stars: raw?.stargazers_count ?? raw?.stars_count ?? 0,
    forks: raw?.forks_count ?? 0,
    updatedAt: raw?.updated_at ?? '',
    defaultBranch: raw?.default_branch ?? '',
    htmlUrl: raw?.html_url ?? '',
    cloneUrl: raw?.clone_url ?? '',
  }
}

function mapGitHubCommit(raw) {
  const author = raw?.commit?.author ?? {}
  return {
    sha: raw?.sha ?? '',
    short: String(raw?.sha ?? '').slice(0, 7),
    message: raw?.commit?.message ?? '',
    author: author?.name ?? raw?.author?.login ?? '',
    date: author?.date ?? '',
    htmlUrl: raw?.html_url ?? '',
    parents: Array.isArray(raw?.parents) ? raw.parents.map((p) => p?.sha ?? '').filter(Boolean) : [],
  }
}

function mapGitHubPull(raw) {
  return {
    index: raw?.number ?? 0,
    title: raw?.title ?? '',
    state: raw?.state ?? 'open',
    merged: Boolean(raw?.merged ?? raw?.merged_at),
    author: { login: raw?.user?.login ?? '', avatarUrl: raw?.user?.avatar_url ?? '' },
    head: { label: raw?.head?.label ?? raw?.head?.ref ?? '', ref: raw?.head?.ref ?? '' },
    base: { label: raw?.base?.label ?? raw?.base?.ref ?? '', ref: raw?.base?.ref ?? '' },
    createdAt: raw?.created_at ?? '',
    updatedAt: raw?.updated_at ?? '',
    htmlUrl: raw?.html_url ?? '',
    body: raw?.body ?? '',
    comments: raw?.comments ?? 0,
  }
}

function mapGitHubDiffFile(file) {
  return {
    filename: file?.filename ?? '',
    status: file?.status ?? '',
    additions: file?.additions ?? 0,
    deletions: file?.deletions ?? 0,
    patch: file?.patch ?? '',
  }
}

function mapGitHubComment(raw) {
  return {
    id: raw?.id ?? 0,
    author: { login: raw?.user?.login ?? '', avatarUrl: raw?.user?.avatar_url ?? '' },
    body: raw?.body ?? '',
    createdAt: raw?.created_at ?? '',
  }
}

/* ------------------------------------------------------------- base client */

class BaseClient {
  constructor(account) {
    this.accountRow = account ?? {}
    this.platform = this.accountRow.platform ?? 'gitea'
    this.baseUrl = normalizeBaseUrl(this.accountRow.baseUrl)
    this.username = String(this.accountRow.username ?? '')
    this.token = String(this.accountRow.token ?? '')
  }

  get configured() {
    return this.baseUrl !== '' && this.token !== ''
  }

  assertConfigured() {
    if (!this.configured) throw new Error('尚未配置 Git 账号：请在「设置 → Git 工作台」添加平台账号')
  }

  async fetchJson(url, { method = 'GET', headers = {}, body, signal } = {}) {
    const timeout = AbortSignal.timeout(API_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: combined,
      })
    } catch (error) {
      if (combined.aborted && !signal?.aborted) throw new Error(`请求超时：${method} ${url}`)
      throw new Error(`无法连接 ${this.platform}（${this.baseUrl}）：${messageOf(error)}`)
    }
    const text = await response.text().catch(() => '')
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    if (!response.ok) {
      const detail =
        (typeof data?.message === 'string' && data.message) ||
        (typeof data?.error === 'string' && data.error) ||
        (data?.message && typeof data.message === 'object' && JSON.stringify(data.message)) ||
        (data?.error && typeof data.error === 'object' && JSON.stringify(data.error)) ||
        text.slice(0, 200) ||
        response.statusText
      throw new Error(`${this.platform} API ${response.status}：${detail}`)
    }
    return data
  }

  /** Per-command git auth; the token never touches .git/config. */
  gitAuthArgs() {
    const pair = `${this.gitUser()}:${this.token}`
    return ['-c', `http.extraHeader=Authorization: Basic ${b64(pair)}`, '-c', 'credential.helper=']
  }

  gitUser() {
    return this.username || 'git'
  }
}

/* ----------------------------------------- Gitea / GitHub / Gitee dialect */

class RestClient extends BaseClient {
  apiRoot() {
    if (this.platform === 'github') return this.baseUrl
    if (this.platform === 'gitee') return this.baseUrl + '/api/v5'
    return this.baseUrl + '/api/v1'
  }

  authHeaders() {
    if (this.platform === 'github') return { Authorization: `Bearer ${this.token}` }
    if (this.platform === 'gitea') return { Authorization: `token ${this.token}` }
    return {}
  }

  async request(method, path, { query, body, signal } = {}) {
    this.assertConfigured()
    const url = new URL(this.apiRoot() + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    if (this.platform === 'gitee') url.searchParams.set('access_token', this.token)
    return this.fetchJson(url, { method, headers: this.authHeaders(), body, signal })
  }

  repoPath(owner, repo) {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  }

  cloneUrl(owner, repo) {
    let root = this.baseUrl
    if (this.platform === 'github') root = root === 'https://api.github.com' ? 'https://github.com' : root.replace(/\/api\/v3$/, '')
    if (this.platform === 'gitee') root = root.replace(/\/api\/v5$/, '')
    return `${root}/${owner}/${repo}.git`
  }

  async account(signal) {
    const raw = await this.request('GET', '/user', { signal })
    return { login: raw?.login ?? '', name: raw?.name ?? '', avatarUrl: raw?.avatar_url ?? '', email: raw?.email ?? '' }
  }

  async repos({ query, page = 1, limit = 30 } = {}, signal) {
    let items
    if (query) {
      if (this.platform === 'gitea') {
        const result = await this.request('GET', '/repos/search', { query: { q: query, page, limit }, signal })
        items = Array.isArray(result?.data) ? result.data : []
      } else {
        const result = await this.request('GET', '/search/repositories', { query: { q: query, page, per_page: limit }, signal })
        items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : []
      }
    } else {
      const raw = await this.request('GET', '/user/repos', {
        query: this.platform === 'gitea' ? { page, limit } : { page, per_page: limit, sort: 'updated' },
        signal,
      })
      items = Array.isArray(raw) ? raw : []
    }
    const mapped = items.map(mapGitHubRepo).filter((repo) => repo.name !== '')
    return { items: mapped, page, hasMore: mapped.length === limit }
  }

  async createRepo({ name, description, private: isPrivate, autoInit }, signal) {
    const raw = await this.request('POST', '/user/repos', {
      body: { name, description: description ?? '', private: Boolean(isPrivate), auto_init: Boolean(autoInit) },
      signal,
    })
    return mapGitHubRepo(raw)
  }

  async deleteRepo({ owner, repo }, signal) {
    await this.request('DELETE', this.repoPath(owner, repo), { signal })
    return { deleted: true }
  }

  async repo({ owner, repo }, signal) {
    return mapGitHubRepo(await this.request('GET', this.repoPath(owner, repo), { signal }))
  }

  async updateRepo({ owner, repo, name, description, private: isPrivate }, signal) {
    const body = {}
    if (name !== undefined) body.name = name
    if (description !== undefined) body.description = description
    if (isPrivate !== undefined) body.private = Boolean(isPrivate)
    return mapGitHubRepo(await this.request('PATCH', this.repoPath(owner, repo), { body, signal }))
  }

  async branches({ owner, repo }, signal) {
    const [raw, info] = await Promise.all([
      this.request('GET', this.repoPath(owner, repo) + '/branches', { query: { limit: 100, per_page: 100 }, signal }),
      this.repo({ owner, repo }, signal).catch(() => null),
    ])
    const defaultBranch = info?.defaultBranch ?? ''
    return (Array.isArray(raw) ? raw : []).map((branch) => ({
      name: branch?.name ?? '',
      sha: branch?.commit?.id ?? branch?.commit?.sha ?? '',
      protected: Boolean(branch?.protected),
      default: branch?.name === defaultBranch,
    }))
  }

  async createBranch({ owner, repo, branch, from }, signal) {
    if (this.platform === 'github') {
      let ref = from
      if (!ref) ref = (await this.repo({ owner, repo }, signal)).defaultBranch
      const source = await this.request('GET', this.repoPath(owner, repo) + `/git/ref/heads/${encodeURIComponent(ref)}`, { signal })
      const sha = source?.object?.sha ?? ''
      if (!sha) throw new Error(`无法解析源分支 ${ref}`)
      await this.request('POST', this.repoPath(owner, repo) + '/git/refs', { body: { ref: `refs/heads/${branch}`, sha }, signal })
      return { name: branch, sha }
    }
    if (this.platform === 'gitee') {
      let ref = from
      if (!ref) ref = (await this.repo({ owner, repo }, signal)).defaultBranch
      const raw = await this.request('POST', this.repoPath(owner, repo) + '/branches', { body: { branch_name: branch, refs: ref }, signal })
      return { name: raw?.name ?? branch, sha: raw?.commit?.sha ?? '' }
    }
    const raw = await this.request('POST', this.repoPath(owner, repo) + '/branches', {
      body: { new_branch_name: branch, ...(from ? { old_branch_name: from } : {}) },
      signal,
    })
    return { name: raw?.name ?? branch, sha: raw?.commit?.id ?? '' }
  }

  async deleteBranch({ owner, repo, branch }, signal) {
    const path = this.platform === 'github'
      ? this.repoPath(owner, repo) + `/git/refs/heads/${encodeURIComponent(branch)}`
      : this.repoPath(owner, repo) + `/branches/${encodeURIComponent(branch)}`
    await this.request('DELETE', path, { signal })
    return { deleted: true }
  }

  async commits({ owner, repo, branch, page = 1, limit = 30 } = {}, signal) {
    const raw = await this.request('GET', this.repoPath(owner, repo) + '/commits', {
      query: this.platform === 'gitea'
        ? { sha: branch || undefined, page, limit }
        : { sha: branch || undefined, page, per_page: limit },
      signal,
    })
    const items = (Array.isArray(raw) ? raw : []).map(mapGitHubCommit)
    return { items, hasMore: items.length === limit }
  }

  async compare({ owner, repo, base, head }, signal) {
    const raw = await this.request('GET', this.repoPath(owner, repo) + `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, { signal })
    const commits = (Array.isArray(raw?.commits) ? raw.commits : []).map(mapGitHubCommit)
    return {
      base,
      head,
      aheadBy: raw?.ahead_by ?? commits.length,
      behindBy: raw?.behind_by ?? 0,
      totalCommits: raw?.total_commits ?? commits.length,
      commits,
      files: (Array.isArray(raw?.files) ? raw.files : []).map(mapGitHubDiffFile),
    }
  }

  async commitDiff({ owner, repo, sha }, signal) {
    const path = this.platform === 'gitea'
      ? this.repoPath(owner, repo) + `/git/commits/${encodeURIComponent(sha)}`
      : this.repoPath(owner, repo) + `/commits/${encodeURIComponent(sha)}`
    const raw = await this.request('GET', path, { signal })
    const files = (Array.isArray(raw?.files) ? raw.files : []).map(mapGitHubDiffFile)
    const stats = raw?.stats ?? {
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    }
    return { commit: mapGitHubCommit(raw), stats: { additions: stats.additions ?? 0, deletions: stats.deletions ?? 0, total: stats.total ?? 0 }, files }
  }

  async pulls({ owner, repo, state = 'open' }, signal) {
    const raw = await this.request('GET', this.repoPath(owner, repo) + '/pulls', {
      query: { state, limit: 50, per_page: 50 },
      signal,
    })
    return { items: (Array.isArray(raw) ? raw : []).map(mapGitHubPull).filter((pull) => pull.index > 0) }
  }

  async pull({ owner, repo, index }, signal) {
    const base = this.repoPath(owner, repo)
    const [raw, files, comments] = await Promise.all([
      this.request('GET', `${base}/pulls/${index}`, { signal }),
      this.request('GET', `${base}/pulls/${index}/files`, { query: { limit: 100, per_page: 100 }, signal }).catch(() => []),
      this.request('GET', `${base}/issues/${index}/comments`, { query: { limit: 100, per_page: 100 }, signal }).catch(() => []),
    ])
    return {
      pull: mapGitHubPull(raw),
      files: (Array.isArray(files) ? files : []).map(mapGitHubDiffFile),
      comments: (Array.isArray(comments) ? comments : []).map(mapGitHubComment),
    }
  }

  async createPull({ owner, repo, title, head, base, body }, signal) {
    const raw = await this.request('POST', this.repoPath(owner, repo) + '/pulls', {
      body: { title, head, base, body: body ?? '' },
      signal,
    })
    return mapGitHubPull(raw)
  }

  async commentPull({ owner, repo, index, body }, signal) {
    const raw = await this.request('POST', this.repoPath(owner, repo) + `/issues/${index}/comments`, { body: { body }, signal })
    return { id: raw?.id ?? 0 }
  }

  async mergePull({ owner, repo, index, message, style = 'merge' }, signal) {
    if (this.platform === 'github') {
      const method = style === 'rebase-merge' ? 'rebase' : style
      await this.request('PUT', this.repoPath(owner, repo) + `/pulls/${index}/merge`, {
        body: { merge_method: method, ...(message ? { commit_message: message } : {}) },
        signal,
      })
    } else if (this.platform === 'gitee') {
      await this.request('POST', this.repoPath(owner, repo) + `/pulls/${index}/merge`, {
        body: { merge_method: style === 'squash' ? 'squash' : 'merge' },
        signal,
      })
    } else {
      await this.request('POST', this.repoPath(owner, repo) + `/pulls/${index}/merge`, {
        body: { Do: style, ...(message ? { MergeMessageField: message } : {}) },
        signal,
      })
    }
    return { merged: true }
  }

  async setPullState({ owner, repo, index, state }, signal) {
    await this.request('PATCH', this.repoPath(owner, repo) + `/pulls/${index}`, { body: { state }, signal })
    return { state }
  }

  async files({ owner, repo, path = '', ref }, signal) {
    const clean = String(path).replace(/^\/+/, '')
    const raw = await this.request('GET', this.repoPath(owner, repo) + `/contents/${clean}`, { query: { ref: ref || undefined }, signal })
    const items = (Array.isArray(raw) ? raw : []).map((entry) => ({
      name: entry?.name ?? '',
      path: entry?.path ?? '',
      type: entry?.type === 'dir' ? 'dir' : 'file',
      size: entry?.size ?? 0,
    }))
    return { items }
  }

  async file({ owner, repo, path, ref }, signal) {
    const clean = String(path ?? '').replace(/^\/+/, '')
    if (clean === '') throw new Error('文件路径不能为空')
    const raw = await this.request('GET', this.repoPath(owner, repo) + `/contents/${clean}`, { query: { ref: ref || undefined }, signal })
    if (Array.isArray(raw)) throw new Error('该路径是目录，请使用 files 操作')
    if ((raw?.size ?? 0) > MAX_FILE_BYTES) throw new Error('文件过大，无法在线查看（>512KB）')
    const content = decodeContent(raw)
    return { path: raw?.path ?? clean, content, size: raw?.size ?? content.length }
  }

  async heatmap({ username }, signal) {
    if (this.platform !== 'gitea') return null
    const raw = await this.request('GET', `/users/${encodeURIComponent(username)}/heatmap`, { signal })
    return (Array.isArray(raw) ? raw : []).map((entry) => ({
      date: new Date(Number(entry?.timestamp ?? 0) * 1000).toISOString().slice(0, 10),
      contributions: Number(entry?.contributions ?? 0),
    }))
  }
}

/* --------------------------------------------------------------- GitLab */

class GitLabClient extends BaseClient {
  apiRoot() {
    return this.baseUrl + '/api/v4'
  }

  gitUser() {
    return 'oauth2'
  }

  projectId(owner, repo) {
    return encodeURIComponent(`${owner}/${repo}`)
  }

  async request(method, path, { query, body, signal } = {}) {
    this.assertConfigured()
    const url = new URL(this.apiRoot() + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    return this.fetchJson(url, { method, headers: { 'PRIVATE-TOKEN': this.token }, body, signal })
  }

  cloneUrl(owner, repo) {
    return `${this.baseUrl.replace(/\/api\/v4$/, '')}/${owner}/${repo}.git`
  }

  mapProject(raw) {
    const fullName = raw?.path_with_namespace ?? ''
    const name = raw?.path ?? ''
    const owner = fullName.endsWith('/' + name) ? fullName.slice(0, -(name.length + 1)) : String(fullName).split('/')[0]
    return {
      owner,
      name,
      fullName,
      description: raw?.description ?? '',
      private: raw?.visibility === 'private',
      fork: Boolean(raw?.forked_from_project),
      empty: Boolean(raw?.empty_repo),
      stars: raw?.star_count ?? 0,
      forks: raw?.forks_count ?? 0,
      updatedAt: raw?.last_activity_at ?? '',
      defaultBranch: raw?.default_branch ?? '',
      htmlUrl: raw?.web_url ?? '',
      cloneUrl: raw?.http_url_to_repo ?? '',
    }
  }

  mapCommit(raw) {
    return {
      sha: raw?.id ?? '',
      short: raw?.short_id ?? String(raw?.id ?? '').slice(0, 7),
      message: raw?.message ?? raw?.title ?? '',
      author: raw?.author_name ?? '',
      date: raw?.authored_date ?? raw?.created_at ?? '',
      htmlUrl: raw?.web_url ?? '',
      parents: Array.isArray(raw?.parent_ids) ? raw.parent_ids : [],
    }
  }

  mapMergeRequest(raw) {
    const state = raw?.state === 'opened' ? 'open' : raw?.state === 'locked' ? 'open' : raw?.state ?? 'open'
    return {
      index: raw?.iid ?? 0,
      title: raw?.title ?? '',
      state,
      merged: raw?.state === 'merged',
      author: { login: raw?.author?.username ?? '', avatarUrl: raw?.author?.avatar_url ?? '' },
      head: { label: raw?.source_branch ?? '', ref: raw?.source_branch ?? '' },
      base: { label: raw?.target_branch ?? '', ref: raw?.target_branch ?? '' },
      createdAt: raw?.created_at ?? '',
      updatedAt: raw?.updated_at ?? '',
      htmlUrl: raw?.web_url ?? '',
      body: raw?.description ?? '',
      comments: raw?.user_notes_count ?? 0,
    }
  }

  mapDiff(raw) {
    const patch = raw?.diff ?? ''
    const counted = diffStats(patch)
    const status = raw?.new_file ? 'added' : raw?.deleted_file ? 'deleted' : raw?.renamed_file ? 'renamed' : 'modified'
    return {
      filename: raw?.new_path ?? raw?.old_path ?? '',
      status,
      additions: counted.additions,
      deletions: counted.deletions,
      patch,
    }
  }

  async account(signal) {
    const raw = await this.request('GET', '/user', { signal })
    return { login: raw?.username ?? '', name: raw?.name ?? '', avatarUrl: raw?.avatar_url ?? '', email: raw?.email ?? '' }
  }

  async repos({ query, page = 1, limit = 30 } = {}, signal) {
    const raw = query
      ? await this.request('GET', '/projects', { query: { search: query, page, per_page: limit }, signal })
      : await this.request('GET', '/projects', { query: { membership: true, order_by: 'last_activity_at', page, per_page: limit }, signal })
    const items = (Array.isArray(raw) ? raw : []).map((project) => this.mapProject(project)).filter((repo) => repo.name !== '')
    return { items, page, hasMore: items.length === limit }
  }

  async createRepo({ name, description, private: isPrivate, autoInit }, signal) {
    const raw = await this.request('POST', '/projects', {
      body: { name, description: description ?? '', visibility: isPrivate ? 'private' : 'public', initialize_with_readme: Boolean(autoInit) },
      signal,
    })
    return this.mapProject(raw)
  }

  async deleteRepo({ owner, repo }, signal) {
    await this.request('DELETE', `/projects/${this.projectId(owner, repo)}`, { signal })
    return { deleted: true }
  }

  async repo({ owner, repo }, signal) {
    return this.mapProject(await this.request('GET', `/projects/${this.projectId(owner, repo)}`, { signal }))
  }

  async updateRepo({ owner, repo, name, description, private: isPrivate }, signal) {
    const body = {}
    if (name !== undefined) body.name = name
    if (description !== undefined) body.description = description
    if (isPrivate !== undefined) body.visibility = isPrivate ? 'private' : 'public'
    return this.mapProject(await this.request('PUT', `/projects/${this.projectId(owner, repo)}`, { body, signal }))
  }

  async branches({ owner, repo }, signal) {
    const id = this.projectId(owner, repo)
    const raw = await this.request('GET', `/projects/${id}/repository/branches`, { query: { per_page: 100 }, signal })
    return (Array.isArray(raw) ? raw : []).map((branch) => ({
      name: branch?.name ?? '',
      sha: branch?.commit?.id ?? '',
      protected: Boolean(branch?.protected),
      default: Boolean(branch?.default),
    }))
  }

  async createBranch({ owner, repo, branch, from }, signal) {
    const id = this.projectId(owner, repo)
    let ref = from
    if (!ref) ref = (await this.repo({ owner, repo }, signal)).defaultBranch
    const raw = await this.request('POST', `/projects/${id}/repository/branches`, { body: { branch, ref }, signal })
    return { name: raw?.name ?? branch, sha: raw?.commit?.id ?? '' }
  }

  async deleteBranch({ owner, repo, branch }, signal) {
    await this.request('DELETE', `/projects/${this.projectId(owner, repo)}/repository/branches/${encodeURIComponent(branch)}`, { signal })
    return { deleted: true }
  }

  async commits({ owner, repo, branch, page = 1, limit = 30 } = {}, signal) {
    const raw = await this.request('GET', `/projects/${this.projectId(owner, repo)}/repository/commits`, {
      query: { ref_name: branch || undefined, page, per_page: limit },
      signal,
    })
    const items = (Array.isArray(raw) ? raw : []).map((commit) => this.mapCommit(commit))
    return { items, hasMore: items.length === limit }
  }

  async compare({ owner, repo, base, head }, signal) {
    const raw = await this.request('GET', `/projects/${this.projectId(owner, repo)}/repository/compare`, {
      query: { from: base, to: head },
      signal,
    })
    const commits = (Array.isArray(raw?.commits) ? raw.commits : []).map((commit) => this.mapCommit(commit))
    return {
      base,
      head,
      aheadBy: commits.length,
      behindBy: 0,
      totalCommits: commits.length,
      commits,
      files: (Array.isArray(raw?.diffs) ? raw.diffs : []).map((diff) => this.mapDiff(diff)),
    }
  }

  async commitDiff({ owner, repo, sha }, signal) {
    const id = this.projectId(owner, repo)
    const [raw, diffs] = await Promise.all([
      this.request('GET', `/projects/${id}/repository/commits/${encodeURIComponent(sha)}`, { signal }),
      this.request('GET', `/projects/${id}/repository/commits/${encodeURIComponent(sha)}/diff`, { query: { per_page: 100 }, signal }).catch(() => []),
    ])
    const files = (Array.isArray(diffs) ? diffs : []).map((diff) => this.mapDiff(diff))
    return {
      commit: this.mapCommit(raw),
      stats: {
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        total: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
      },
      files,
    }
  }

  async pulls({ owner, repo, state = 'open' }, signal) {
    const mapped = state === 'open' ? 'opened' : state === 'closed' ? 'closed' : 'all'
    const raw = await this.request('GET', `/projects/${this.projectId(owner, repo)}/merge_requests`, {
      query: { state: mapped, per_page: 50, order_by: 'updated_at' },
      signal,
    })
    return { items: (Array.isArray(raw) ? raw : []).map((mr) => this.mapMergeRequest(mr)).filter((pull) => pull.index > 0) }
  }

  async pull({ owner, repo, index }, signal) {
    const id = this.projectId(owner, repo)
    const [raw, diffs, notes] = await Promise.all([
      this.request('GET', `/projects/${id}/merge_requests/${index}`, { signal }),
      this.request('GET', `/projects/${id}/merge_requests/${index}/diffs`, { query: { per_page: 100 }, signal })
        .catch(() => this.request('GET', `/projects/${id}/merge_requests/${index}/changes`, { signal }).then((v) => v?.changes ?? [])),
      this.request('GET', `/projects/${id}/merge_requests/${index}/notes`, { query: { per_page: 100, sort: 'asc' }, signal }).catch(() => []),
    ])
    return {
      pull: this.mapMergeRequest(raw),
      files: (Array.isArray(diffs) ? diffs : []).map((diff) => this.mapDiff(diff)),
      comments: (Array.isArray(notes) ? notes : [])
        .filter((note) => !note?.system)
        .map((note) => ({
          id: note?.id ?? 0,
          author: { login: note?.author?.username ?? '', avatarUrl: note?.author?.avatar_url ?? '' },
          body: note?.body ?? '',
          createdAt: note?.created_at ?? '',
        })),
    }
  }

  async createPull({ owner, repo, title, head, base, body }, signal) {
    const source = String(head ?? '').includes(':') ? String(head).split(':').slice(1).join(':') : head
    const raw = await this.request('POST', `/projects/${this.projectId(owner, repo)}/merge_requests`, {
      body: { source_branch: source, target_branch: base, title, description: body ?? '' },
      signal,
    })
    return this.mapMergeRequest(raw)
  }

  async commentPull({ owner, repo, index, body }, signal) {
    const raw = await this.request('POST', `/projects/${this.projectId(owner, repo)}/merge_requests/${index}/notes`, { body: { body }, signal })
    return { id: raw?.id ?? 0 }
  }

  async mergePull({ owner, repo, index, message, style = 'merge' }, signal) {
    await this.request('PUT', `/projects/${this.projectId(owner, repo)}/merge_requests/${index}/merge`, {
      body: { ...(message ? { merge_commit_message: message } : {}), squash: style === 'squash' },
      signal,
    })
    return { merged: true }
  }

  async setPullState({ owner, repo, index, state }, signal) {
    await this.request('PUT', `/projects/${this.projectId(owner, repo)}/merge_requests/${index}`, {
      body: { state_event: state === 'closed' ? 'close' : 'reopen' },
      signal,
    })
    return { state }
  }

  async files({ owner, repo, path = '', ref }, signal) {
    const raw = await this.request('GET', `/projects/${this.projectId(owner, repo)}/repository/tree`, {
      query: { path: String(path).replace(/^\/+/, '') || undefined, ref: ref || undefined, per_page: 100 },
      signal,
    })
    const items = (Array.isArray(raw) ? raw : []).map((entry) => ({
      name: entry?.name ?? '',
      path: entry?.path ?? '',
      type: entry?.type === 'tree' ? 'dir' : 'file',
      size: 0,
    }))
    return { items }
  }

  async file({ owner, repo, path, ref }, signal) {
    const clean = String(path ?? '').replace(/^\/+/, '')
    if (clean === '') throw new Error('文件路径不能为空')
    const raw = await this.request('GET', `/projects/${this.projectId(owner, repo)}/repository/files/${encodeURIComponent(clean)}`, {
      query: { ref: ref || undefined },
      signal,
    })
    if ((raw?.size ?? 0) > MAX_FILE_BYTES) throw new Error('文件过大，无法在线查看（>512KB）')
    const content = decodeContent(raw)
    return { path: raw?.file_path ?? clean, content, size: raw?.size ?? content.length }
  }

  async heatmap() {
    return null
  }
}

/** Build the adapter for one account row. */
export function createClient(account) {
  if ((account?.platform ?? 'gitea') === 'gitlab') return new GitLabClient(account)
  return new RestClient(account)
}
