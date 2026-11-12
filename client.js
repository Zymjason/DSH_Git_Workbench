/**
 * Git 工作台 (Git Workbench) — browser half.
 *
 * Registers one Settings section (account binding), one sidebar panel icon,
 * and the main studio page: repositories, branch commit graph, Pull Request
 * review (diff + comments + merge), and file browsing. Also integrates repo
 * linking into the composer: a + menu command, an @ reference source, and a
 * per-session link chip. All data flows through the authenticated Host RPC
 * route; every operation shares its implementation with the `git` agent tool.
 */
window.__ModuleLoader__.load({
  id: '@local/gitea-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'giteaStudio'
    const RPC_URL = 'api/gitea-studio/rpc'

    /* ------------------------------------------------------------ locales */

    const zh = {
      loading: '加载中…', refresh: '刷新', retry: '重试', error: '出错了', save: '保存', cancel: '取消',
      confirm: '确认', delete: '删除', create: '创建', back: '返回', close: '关闭', copy: '复制',
      copied: '已复制', copyFailed: '复制失败', empty: '暂无数据', search: '搜索', busy: '处理中…',
      settingsTitle: 'Git 工作台',
      settingsDesc: '接入 Gitea / GitHub / GitLab / Gitee 账号（可多个），在左侧栏工作台管理仓库、分支与 PR/MR，并让对话直接推送项目。',
      serverUrl: '服务器地址',
      username: '用户名', usernamePh: '留空则自动使用令牌所属账号',
      token: 'API 令牌', tokenPh: '粘贴访问令牌', tokenKeepPh: '留空保留当前令牌',
      cloneRoot: '克隆根目录', cloneRootPh: '可选，默认在插件数据目录下',
      testSave: '测试并保存',
      platform: '平台', addAccount: '添加账号', editAccount: '编辑账号', activate: '启用', activeAccount: '当前启用',
      accountActivated: '已切换启用账号', edit: '编辑', deleteAccountConfirm: '确认删除该账号？', switchAccount: '切换账号',
      githubUrlHint: '默认 api.github.com；企业版填 https://<host>/api/v3', selfHostHint: '自建实例填自己的地址',
      notConfigured: '未配置',
      bindingsTitle: '会话绑定', noBindings: '没有绑定仓库的会话', unbindSession: '解绑',
      saveOk: '账号保存成功',
      panelTitle: 'Git 工作台', studioTitle: 'Git 工作台',
      setupPitch: '接入 Gitea / GitHub / GitLab / Gitee 账号，可视化管理仓库、分支与 PR/MR，并让对话直接提交项目。',
      setupHint: '也可在「设置 → Git 工作台」中随时管理账号。',
      newRepo: '新建仓库', repoName: '仓库名', repoNamePh: 'my-project',
      repoDesc: '描述', repoDescPh: '可选', privateRepo: '私有仓库', autoInit: '生成初始提交（README）',
      createRepo: '创建仓库', reposTab: '仓库',
      searchRepos: '搜索仓库…', loadMore: '加载更多', noRepos: '没有仓库',
      noReposHint: '点击右上角「新建仓库」创建第一个仓库。',
      privateBadge: '私有', forkBadge: '复刻', emptyBadge: '空',
      stars: '星标', forks: '复刻', updated: '更新于', defaultBranch: '默认分支',
      chatRepo: '对话此仓库', chatBusy: '正在准备仓库…',
      chatNoService: '无法自动打开会话，请手动在此目录开启对话：',
      cloneUrl: '复制克隆地址', deleteRepo: '删除仓库', deleteRepoConfirm: '确认删除？不可恢复',
      branchesTab: '分支', pullsTab: 'Pull Requests', filesTab: '文件',
      newBranch: '新建分支', branchNamePh: '分支名', fromBranch: '源分支',
      createBranch: '创建分支', deleteBranchConfirm: '确认删除分支？', protectedBranch: '受保护',
      graphEmpty: '仓库还没有提交', graphTitle: '分支提交图',
      stateOpen: '开启中', stateClosed: '已关闭', stateAll: '全部', stateMerged: '已合并',
      newPull: '新建 PR', pullTitlePh: 'PR 标题', headBranch: '源分支', baseBranch: '目标分支',
      pullBodyPh: '描述（可选）', createPull: '创建 PR', noPulls: '没有 Pull Request',
      pullFiles: '变更', pullComments: '评论', addComment: '发表评论', commentPh: '写下评论…',
      merge: '合并', mergeConfirm: '确认合并？', mergedOk: '合并成功',
      closePull: '关闭 PR', reopenPull: '重新打开', diffEmpty: '没有文件变更', noComments: '没有评论',
      dirEmpty: '空目录', pathRoot: '根目录', fileTooLarge: '文件过大',
      gitSection: 'Git 仓库', linkRepoTitle: '关联 Git 仓库',
      linkRepoDesc: '克隆并绑定仓库到当前会话，之后可直接推送迭代',
      unlink: '解除关联', unlinkConfirm: '确认解除关联？', linkFailed: '仓库关联失败',
      branchesView: '分支', branchViewNoBinding: '当前会话未关联仓库。用输入框加号菜单或 @ 语法关联一个仓库，即可查看版本与改动对比。',
      openStudio: '打开工作台', versionsTab: '版本', compareTab: '对比', backToCommits: '返回提交列表',
      noChanges: '没有文件改动', noCommits: '暂无提交', refPlaceholder: '分支 / 标签 / sha',
      compareSwap: '交换基准与目标', compareRun: '对比', compareSame: '基准与目标不能相同', compareEmpty: '选择两个引用（分支、标签或提交 sha）开始对比',
      ahead: '领先', behind: '落后', commitsBetween: '个提交',
      contribTab: '贡献', contribTotal: '总贡献', contribActiveDays: '活跃天数', contribMaxDay: '单日最高', contribStreak: '最长连续',
      contribApprox: '该平台无热力图接口，数据由最近更新的仓库提交估算', contribEmpty: '近一年没有贡献记录',
      contribLess: '少', contribMore: '多', contribOn: '次贡献', contribYear: '近一年',
      months: '1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月', wdMon: '一', wdWed: '三', wdFri: '五',
      branchLabel: '分支', authorLabel: '作者', commentCount: '条评论',
      justNow: '刚刚', minutesAgo: '分钟前', hoursAgo: '小时前', daysAgo: '天前',
      createOk: '创建成功', deleteOk: '已删除', commentOk: '评论已发表',
      branchDeleted: '分支已删除', pullClosed: 'PR 已关闭', pullReopened: 'PR 已重新打开',
      repoDeleted: '仓库已删除', unboundOk: '已解绑',
    }
    const en = {
      loading: 'Loading…', refresh: 'Refresh', retry: 'Retry', error: 'Something went wrong', save: 'Save', cancel: 'Cancel',
      confirm: 'Confirm', delete: 'Delete', create: 'Create', back: 'Back', close: 'Close', copy: 'Copy',
      copied: 'Copied', copyFailed: 'Copy failed', empty: 'Nothing here yet', search: 'Search', busy: 'Working…',
      settingsTitle: 'Git Workbench',
      settingsDesc: 'Connect Gitea / GitHub / GitLab / Gitee accounts (multiple allowed) to manage repos, branches and PRs/MRs from the sidebar panel, and let chat push projects directly.',
      serverUrl: 'Server URL',
      username: 'Username', usernamePh: 'Leave empty to use the token owner',
      token: 'API token', tokenPh: 'Paste the access token', tokenKeepPh: 'Leave empty to keep the current token',
      cloneRoot: 'Clone root directory', cloneRootPh: 'Optional; defaults to the plugin data directory',
      testSave: 'Test & save',
      platform: 'Platform', addAccount: 'Add account', editAccount: 'Edit account', activate: 'Activate', activeAccount: 'Active',
      accountActivated: 'Active account switched', edit: 'Edit', deleteAccountConfirm: 'Delete this account?', switchAccount: 'Switch account',
      githubUrlHint: 'Defaults to api.github.com; Enterprise: https://<host>/api/v3', selfHostHint: 'Use your own URL for self-hosted instances',
      notConfigured: 'Not configured',
      bindingsTitle: 'Session bindings', noBindings: 'No repo-bound sessions', unbindSession: 'Unbind',
      saveOk: 'Account saved',
      panelTitle: 'Git Workbench', studioTitle: 'Git Workbench',
      setupPitch: 'Connect Gitea / GitHub / GitLab / Gitee accounts to manage repos, branches and PRs/MRs visually, and let chat commit projects for you.',
      setupHint: 'Manage accounts anytime in Settings → Git Workbench.',
      newRepo: 'New repository', repoName: 'Repository name', repoNamePh: 'my-project',
      repoDesc: 'Description', repoDescPh: 'Optional', privateRepo: 'Private repository', autoInit: 'Initialize with a README',
      createRepo: 'Create repository', reposTab: 'Repositories',
      searchRepos: 'Search repositories…', loadMore: 'Load more', noRepos: 'No repositories',
      noReposHint: 'Use “New repository” to create your first one.',
      privateBadge: 'Private', forkBadge: 'Fork', emptyBadge: 'Empty',
      stars: 'Stars', forks: 'Forks', updated: 'Updated', defaultBranch: 'Default branch',
      chatRepo: 'Chat with this repo', chatBusy: 'Preparing repository…',
      chatNoService: 'Cannot open a session automatically; start a chat in this directory:',
      cloneUrl: 'Copy clone URL', deleteRepo: 'Delete repository', deleteRepoConfirm: 'Delete permanently?',
      branchesTab: 'Branches', pullsTab: 'Pull Requests', filesTab: 'Files',
      newBranch: 'New branch', branchNamePh: 'Branch name', fromBranch: 'From branch',
      createBranch: 'Create branch', deleteBranchConfirm: 'Delete this branch?', protectedBranch: 'Protected',
      graphEmpty: 'No commits yet', graphTitle: 'Branch commit graph',
      stateOpen: 'Open', stateClosed: 'Closed', stateAll: 'All', stateMerged: 'Merged',
      newPull: 'New PR', pullTitlePh: 'PR title', headBranch: 'Head branch', baseBranch: 'Base branch',
      pullBodyPh: 'Description (optional)', createPull: 'Create PR', noPulls: 'No pull requests',
      pullFiles: 'Changes', pullComments: 'Comments', addComment: 'Comment', commentPh: 'Write a comment…',
      merge: 'Merge', mergeConfirm: 'Merge this PR?', mergedOk: 'Merged',
      closePull: 'Close PR', reopenPull: 'Reopen', diffEmpty: 'No file changes', noComments: 'No comments',
      dirEmpty: 'Empty directory', pathRoot: 'Root', fileTooLarge: 'File too large',
      gitSection: 'Git repositories', linkRepoTitle: 'Link Git repository',
      linkRepoDesc: 'Clone and bind a repository to this session for direct push iteration',
      unlink: 'Unlink', unlinkConfirm: 'Unlink this repository?', linkFailed: 'Repository link failed',
      branchesView: 'Branches', branchViewNoBinding: 'This session is not linked to a repository. Link one via the + menu or an @ mention to browse versions and diffs.',
      openStudio: 'Open studio', versionsTab: 'Versions', compareTab: 'Compare', backToCommits: 'Back to commits',
      noChanges: 'No file changes', noCommits: 'No commits yet', refPlaceholder: 'branch / tag / sha',
      compareSwap: 'Swap base and head', compareRun: 'Compare', compareSame: 'Base and head must differ', compareEmpty: 'Pick two refs (branches, tags, or commit shas) to compare',
      ahead: 'ahead', behind: 'behind', commitsBetween: 'commits',
      contribTab: 'Contributions', contribTotal: 'Total', contribActiveDays: 'Active days', contribMaxDay: 'Best day', contribStreak: 'Longest streak',
      contribApprox: 'This platform lacks a heatmap API; estimated from commits in recently updated repos', contribEmpty: 'No contributions in the past year',
      contribLess: 'Less', contribMore: 'More', contribOn: 'contributions', contribYear: 'past year',
      months: 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec', wdMon: 'Mon', wdWed: 'Wed', wdFri: 'Fri',
      branchLabel: 'Branch', authorLabel: 'Author', commentCount: 'comments',
      justNow: 'just now', minutesAgo: 'min ago', hoursAgo: 'h ago', daysAgo: 'd ago',
      createOk: 'Created', deleteOk: 'Deleted', commentOk: 'Comment posted',
      branchDeleted: 'Branch deleted', pullClosed: 'PR closed', pullReopened: 'PR reopened',
      repoDeleted: 'Repository deleted', unboundOk: 'Unbound',
    }

    let t = (key) => key
    let clientCtx = null

    /* ---------------------------------------------------------------- rpc */

    async function rpc(method, args) {
      let response
      try {
        response = await fetch(RPC_URL, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, args: args || {} }),
        })
      } catch (error) {
        throw new Error(String(error && error.message ? error.message : error))
      }
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) throw new Error((body && body.error) || 'HTTP ' + response.status)
      if (!body || body.ok !== true) throw new Error((body && body.error) || 'RPC failed')
      return body.value
    }

    /* -------------------------------------------------------------- store */

    const store = { state: null, account: null, listeners: new Set() }
    function setStore(patch) {
      Object.assign(store, patch)
      for (const listener of store.listeners) listener()
    }
    function useStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((n) => n + 1)
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      }, [])
      return store
    }
    async function loadState() {
      const state = await rpc('state')
      let account = null
      if (state.configured) account = await rpc('account').catch(() => null)
      setStore({ state, account })
      return state
    }

    /* ------------------------------------------------------------- styles */

    const PALETTE = ['#4c8eda', '#57ab5a', '#d29922', '#e5534b', '#986ee2', '#39a5cf', '#d2691e', '#6e7781']

    const css = `
.gs-root{height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px}
.gs-root *{box-sizing:border-box}
.gs-root ::-webkit-scrollbar{width:8px;height:8px}
.gs-root ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:4px}
.gs-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;transition:background 120ms ease,border-color 120ms ease}
.gs-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.gs-btn:disabled{opacity:.55;cursor:default}
.gs-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.gs-btn-primary:hover{background:var(--dsw-alias-brand-primary);filter:brightness(1.08)}
.gs-btn-danger{color:var(--dsw-alias-state-error-primary)}
.gs-btn-danger:hover{border-color:var(--dsw-alias-state-error-primary)}
.gs-btn-armed{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#fff}
.gs-input,.gs-select,.gs-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:13px;outline:none;font-family:inherit}
.gs-input:focus,.gs-select:focus,.gs-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.gs-textarea{resize:vertical;min-height:72px}
.gs-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px}
.gs-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;transition:background 100ms ease}
.gs-row:hover{background:var(--dsw-alias-bg-layer-2)}
.gs-row:last-child{border-bottom:none}
.gs-tab{border:none;background:none;color:var(--dsw-alias-label-secondary);padding:8px 14px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent}
.gs-tab:hover{color:var(--dsw-alias-label-primary)}
.gs-tab-active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.gs-badge{display:inline-block;padding:1px 8px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.gs-muted{color:var(--dsw-alias-label-secondary)}
.gs-mono{font-family:var(--ds-font-family-code,monospace);font-size:12px}
.gs-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 12px;font-size:13px;white-space:pre-wrap;word-break:break-word}
.gs-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);color:var(--dsw-alias-state-success-primary);border-radius:8px;padding:8px 12px;font-size:13px}
.gs-spin{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:gs-rot .8s linear infinite;display:inline-block;flex:none}
@keyframes gs-rot{to{transform:rotate(360deg)}}
.gs-diff{font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:1.55;overflow-x:auto;margin:0;padding:8px 0}
.gs-diff-line{padding:0 12px;white-space:pre}
.gs-diff-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);color:var(--dsw-alias-state-success-primary)}
.gs-diff-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.gs-diff-hunk{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.gs-commit-row{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;border-radius:6px;min-width:0}
.gs-commit-row:hover{background:var(--dsw-alias-bg-layer-2)}
.gs-graph-wrap{display:flex;align-items:flex-start;overflow-x:auto}
.gs-pre{font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:1.6;margin:0;padding:12px;overflow:auto;max-height:480px;white-space:pre;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.gs-crumb{background:none;border:none;color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:13px;padding:2px 4px}
.gs-crumb:hover{text-decoration:underline}
.gs-link-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:2px 6px;font-size:12px;color:var(--dsw-alias-label-secondary);max-width:280px}
.gs-link-chip-main{border:none;background:none;color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:12px;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}
.gs-link-chip-main:hover{text-decoration:underline}
.gs-link-chip-x{border:none;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:0 3px;border-radius:4px;line-height:1.4}
.gs-link-chip-x:hover{color:var(--dsw-alias-state-error-primary)}
.gs-link-chip-x-armed{color:#fff;background:var(--dsw-alias-state-error-primary)}
.gs-link-chip-error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
`

    const S = {
      page: { maxWidth: 1080, margin: '0 auto', padding: '20px 24px 48px' },
      header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 18, fontWeight: 650 },
      subtitle: { margin: '4px 0 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      spacer: { flex: 1 },
      toolbar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
      tabs: { display: 'flex', gap: 2, borderBottom: '1px solid var(--dsw-alias-border-l1)', marginBottom: 14 },
      field: { marginBottom: 14 },
      label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 },
      hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 },
      badgeRow: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
      avatar: (size) => ({ width: size, height: size, borderRadius: '50%', flex: 'none', background: 'var(--dsw-alias-bg-layer-2)' }),
      ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
      grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
      sectionTitle: { margin: '18px 0 10px', fontSize: 14, fontWeight: 650 },
      emptyBox: { padding: '40px 20px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 },
    }

    /* ---------------------------------------------------------- utilities */

    function relativeTime(iso) {
      if (!iso) return ''
      const then = new Date(iso).getTime()
      if (!Number.isFinite(then)) return ''
      const diff = Date.now() - then
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return t('justNow')
      if (minutes < 60) return minutes + ' ' + t('minutesAgo')
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + ' ' + t('hoursAgo')
      const days = Math.floor(hours / 24)
      if (days < 30) return days + ' ' + t('daysAgo')
      return new Date(then).toLocaleDateString()
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    }

    /* ------------------------------------------------------- shared parts */

    function StyleTag() {
      return h('style', null, css)
    }

    function Spinner() {
      return h('span', { className: 'gs-spin', 'aria-hidden': true })
    }

    function Btn({ primary, danger, armed, busy, disabled, onClick, children, title }) {
      const cls = ['gs-btn', primary ? 'gs-btn-primary' : '', danger ? 'gs-btn-danger' : '', armed ? 'gs-btn-armed' : ''].filter(Boolean).join(' ')
      return h('button', { type: 'button', className: cls, onClick, disabled: disabled || busy, title }, busy ? h(Spinner) : null, children)
    }

    /** Two-step destructive button: first click arms, second confirms. */
    function ConfirmBtn({ label, confirmLabel, onConfirm, danger, disabled }) {
      const [armed, setArmed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        if (!armed) return undefined
        const timer = setTimeout(() => setArmed(false), 3000)
        return () => clearTimeout(timer)
      }, [armed])
      return h(Btn, {
        danger: danger !== false,
        armed,
        busy,
        disabled,
        onClick: async () => {
          if (!armed) {
            setArmed(true)
            return
          }
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setArmed(false)
          }
        },
      }, armed ? confirmLabel || t('confirm') : label)
    }

    function Badge({ tone, children }) {
      const color = tone === 'success' ? 'var(--dsw-alias-state-success-primary)'
        : tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
        : tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
        : tone === 'brand' ? 'var(--dsw-alias-brand-primary)'
        : 'var(--dsw-alias-label-secondary)'
      return h('span', { className: 'gs-badge', style: { color, borderColor: 'color-mix(in srgb, ' + color + ' 45%, transparent)' } }, children)
    }

    function ErrorBanner({ error, onRetry }) {
      if (!error) return null
      return h('div', { className: 'gs-error', style: { marginBottom: 12 }, role: 'alert' },
        error,
        onRetry ? h('div', { style: { marginTop: 8 } }, h(Btn, { onClick: onRetry }, t('retry'))) : null)
    }

    function OkBanner({ text }) {
      if (!text) return null
      return h('div', { className: 'gs-ok', style: { marginBottom: 12 }, role: 'status' }, text)
    }

    function Field({ label, hint, children }) {
      return h('div', { style: S.field },
        h('label', { style: S.label }, label),
        children,
        hint ? h('div', { style: S.hint }, hint) : null)
    }

    function EmptyBox({ text, hint }) {
      return h('div', { className: 'gs-card' }, h('div', { style: S.emptyBox }, text, hint ? h('div', { style: { marginTop: 6, fontSize: 12 } }, hint) : null))
    }

    function Avatar({ url, size }) {
      const px = size || 24
      if (!url) return h('span', { style: { ...S.avatar(px), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: px * 0.5, color: 'var(--dsw-alias-label-secondary)' } }, '?')
      return h('img', { src: url, alt: '', style: S.avatar(px), loading: 'lazy' })
    }

    function Tabs({ tabs, active, onSelect }) {
      return h('div', { style: S.tabs, role: 'tablist' }, tabs.map((tab) =>
        h('button', {
          key: tab.id,
          type: 'button',
          role: 'tab',
          'aria-selected': active === tab.id,
          className: 'gs-tab' + (active === tab.id ? ' gs-tab-active' : ''),
          onClick: () => onSelect(tab.id),
        }, tab.label)))
    }

    /* ------------------------------------------------------ settings form */

    const PLATFORM_META = {
      gitea: { label: 'Gitea', defaultBaseUrl: 'https://gitea.com', tokenHint: 'Gitea → 设置 → 应用 → 生成令牌（repo 权限）' },
      github: { label: 'GitHub', defaultBaseUrl: 'https://api.github.com', tokenHint: 'GitHub → Settings → Developer settings → Personal access tokens（repo 范围）' },
      gitlab: { label: 'GitLab', defaultBaseUrl: 'https://gitlab.com', tokenHint: 'GitLab → Preferences → Access Tokens（api 范围）' },
      gitee: { label: 'Gitee', defaultBaseUrl: 'https://gitee.com', tokenHint: 'Gitee → 设置 → 私人令牌（projects 权限）' },
    }
    function platformLabel(id) {
      return (PLATFORM_META[id] || PLATFORM_META.gitea).label
    }
    function activeAccountOf(state) {
      if (!state || !Array.isArray(state.accounts)) return null
      return state.accounts.find((a) => a.id === state.activeAccountId) || state.accounts[0] || null
    }

    /* Add or edit one platform account. */
    function AccountForm({ editing, onSaved, onCancel }) {
      const [platform, setPlatform] = React.useState(editing ? editing.platform : 'gitea')
      const [baseUrl, setBaseUrl] = React.useState(editing ? editing.baseUrl : PLATFORM_META.gitea.defaultBaseUrl)
      const [username, setUsername] = React.useState(editing ? editing.username : '')
      const [token, setToken] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const meta = PLATFORM_META[platform] || PLATFORM_META.gitea
      const changePlatform = (id) => {
        setPlatform(id)
        const next = PLATFORM_META[id] || PLATFORM_META.gitea
        const defaults = Object.values(PLATFORM_META).map((m) => m.defaultBaseUrl)
        if (!editing && (baseUrl === '' || defaults.includes(baseUrl))) setBaseUrl(next.defaultBaseUrl)
      }
      const submit = async () => {
        setBusy(true)
        setError('')
        try {
          const result = await rpc('saveAccount', {
            id: editing ? editing.id : undefined,
            platform,
            baseUrl,
            username,
            token,
          })
          setStore({ state: result.state })
          void loadState().catch(() => {})
          if (onSaved) onSaved(result)
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }
      return h('div', { className: 'gs-card', style: { padding: 14, marginBottom: 16 } },
        h('div', { style: { fontWeight: 650, marginBottom: 10 } }, editing ? t('editAccount') : t('addAccount')),
        h(ErrorBanner, { error }),
        h(Field, { label: t('platform') },
          h('select', { className: 'gs-select', value: platform, onChange: (e) => changePlatform(e.target.value) },
            Object.values(PLATFORM_META).map((m) => h('option', { key: m.label, value: m.label.toLowerCase() }, m.label)))),
        h(Field, { label: t('serverUrl'), hint: platform === 'github' ? t('githubUrlHint') : t('selfHostHint') },
          h('input', { className: 'gs-input', value: baseUrl, placeholder: meta.defaultBaseUrl, onChange: (e) => setBaseUrl(e.target.value) })),
        h(Field, { label: t('username'), hint: t('usernamePh') },
          h('input', { className: 'gs-input', value: username, onChange: (e) => setUsername(e.target.value) })),
        h(Field, { label: t('token'), hint: meta.tokenHint },
          h('input', { className: 'gs-input', type: 'password', value: token, autoComplete: 'off', placeholder: editing && editing.hasToken ? t('tokenKeepPh') : t('tokenPh'), onChange: (e) => setToken(e.target.value) })),
        h('div', { style: { display: 'flex', gap: 8 } },
          h(Btn, { primary: true, busy, onClick: submit }, t('testSave')),
          onCancel ? h(Btn, { onClick: onCancel }, t('cancel')) : null))
    }

    /* The account roster: activate, edit, delete; add new platform accounts. */
    function AccountsCard() {
      const current = useStore()
      const state = current.state
      const [adding, setAdding] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [error, setError] = React.useState('')
      const [ok, setOk] = React.useState('')
      if (!state) return null
      const accounts = state.accounts || []
      const activate = async (id) => {
        setError('')
        try {
          const result = await rpc('setActiveAccount', { id })
          setStore({ state: result.state })
          void loadState().catch(() => {})
          setOk(t('accountActivated'))
        } catch (err) {
          setError(messageOf(err))
        }
      }
      const remove = async (id) => {
        const result = await rpc('deleteAccount', { id })
        setStore({ state: result.state, account: null })
        void loadState().catch(() => {})
      }
      return h('div', null,
        h(ErrorBanner, { error }),
        h(OkBanner, { text: ok }),
        accounts.length === 0
          ? h('div', { className: 'gs-card', style: { padding: 14, marginBottom: 16 } }, h(Badge, { tone: 'warn' }, t('notConfigured')))
          : h('div', { className: 'gs-card', style: { marginBottom: 16 } }, accounts.map((account) =>
              h('div', { key: account.id, className: 'gs-row', style: { cursor: 'default' } },
                h(Badge, { tone: account.id === state.activeAccountId ? 'brand' : 'neutral' }, platformLabel(account.platform)),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontWeight: 600, fontSize: 13 } },
                    account.username || '(?)',
                    account.id === state.activeAccountId ? h('span', { style: { marginLeft: 8 } }, h(Badge, { tone: 'success' }, t('activeAccount'))) : null),
                  h('div', { className: 'gs-muted gs-mono', style: { fontSize: 11, ...S.ellipsis } }, account.baseUrl)),
                account.id !== state.activeAccountId
                  ? h(Btn, { onClick: () => activate(account.id) }, t('activate'))
                  : null,
                h(Btn, { onClick: () => { setEditing(account); setAdding(false) } }, t('edit')),
                h(ConfirmBtn, { label: t('delete'), confirmLabel: t('deleteAccountConfirm'), onConfirm: () => remove(account.id) })))),
        adding ? h(AccountForm, { onSaved: () => { setAdding(false); setOk(t('saveOk')) }, onCancel: () => setAdding(false) }) : null,
        editing ? h(AccountForm, { key: editing.id, editing, onSaved: () => { setEditing(null); setOk(t('saveOk')) }, onCancel: () => setEditing(null) }) : null,
        !adding && !editing
          ? h(Btn, { primary: true, onClick: () => setAdding(true) }, '+ ' + t('addAccount'))
          : null)
    }

    function BindingsCard() {
      const [items, setItems] = React.useState(null)
      const [error, setError] = React.useState('')
      const load = React.useCallback(() => {
        rpc('bindings').then((v) => setItems(v.items)).catch((e) => setError(messageOf(e)))
      }, [])
      React.useEffect(load, [load])
      if (error) return h(ErrorBanner, { error, onRetry: load })
      if (!items) return h('div', { style: { padding: 12 } }, h(Spinner))
      return h('div', null,
        items.length === 0
          ? h('div', { className: 'gs-muted', style: { fontSize: 13, padding: '8px 0' } }, t('noBindings'))
          : h('div', { className: 'gs-card' }, items.map((binding) =>
              h('div', { key: binding.sessionId, className: 'gs-row', style: { cursor: 'default' } },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontWeight: 600, fontSize: 13 } },
                    binding.owner + '/' + binding.repo + (binding.branch ? ' · ' + binding.branch : ''),
                    binding.platform ? h('span', { style: { marginLeft: 8 } }, h(Badge, null, platformLabel(binding.platform))) : null),
                  h('div', { className: 'gs-muted gs-mono', style: { fontSize: 11, ...S.ellipsis } }, binding.path || binding.sessionId)),
                h(ConfirmBtn, {
                  label: t('unbindSession'),
                  confirmLabel: t('confirm'),
                  onConfirm: async () => {
                    await rpc('unbind', { sessionId: binding.sessionId })
                    load()
                  },
                })))))
    }

    function SettingsPage() {
      const current = useStore()
      const [error, setError] = React.useState('')
      const [cloneRoot, setCloneRoot] = React.useState('')
      const [savingRoot, setSavingRoot] = React.useState(false)
      const [ok, setOk] = React.useState('')
      React.useEffect(() => {
        loadState().catch((e) => setError(messageOf(e)))
      }, [])
      const state = current.state
      const active = activeAccountOf(state)
      const saveCloneRoot = async () => {
        if (!active) return
        setSavingRoot(true)
        setError('')
        try {
          const result = await rpc('saveAccount', {
            id: active.id,
            platform: active.platform,
            baseUrl: active.baseUrl,
            username: active.username,
            token: '',
            cloneRoot,
          })
          setStore({ state: result.state })
          setCloneRoot('')
          setOk(t('saveOk'))
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setSavingRoot(false)
        }
      }
      return h('div', { className: 'gs-root' },
        h(StyleTag),
        h('div', { style: { maxWidth: 640, margin: '0 auto', padding: '20px 24px 48px' } },
          h('h2', { style: S.title }, t('settingsTitle')),
          h('p', { style: S.subtitle }, t('settingsDesc')),
          h('div', { style: { marginTop: 16 } },
            h(ErrorBanner, { error }),
            h(OkBanner, { text: ok }),
            h(AccountsCard),
            active
              ? h(Field, { label: t('cloneRoot'), hint: state ? state.cloneRoot : '' },
                  h('div', { style: { display: 'flex', gap: 8 } },
                    h('input', { className: 'gs-input', value: cloneRoot, placeholder: t('cloneRootPh'), onChange: (e) => setCloneRoot(e.target.value) }),
                    h(Btn, { busy: savingRoot, onClick: saveCloneRoot }, t('save'))))
              : null,
            h('h3', { style: S.sectionTitle }, t('bindingsTitle')),
            h(BindingsCard))))
    }

    /* -------------------------------------------------------- studio shell */

    function NewRepoForm({ onCreated, onCancel }) {
      const [name, setName] = React.useState('')
      const [description, setDescription] = React.useState('')
      const [isPrivate, setPrivate] = React.useState(false)
      const [autoInit, setAutoInit] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const submit = async () => {
        setBusy(true)
        setError('')
        try {
          const repo = await rpc('createRepo', { name, description, private: isPrivate, autoInit })
          if (onCreated) onCreated(repo)
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }
      return h('div', { className: 'gs-card', style: { padding: 16, marginBottom: 14 } },
        h(ErrorBanner, { error }),
        h('div', { style: S.grid2 },
          h(Field, { label: t('repoName') }, h('input', { className: 'gs-input', value: name, placeholder: t('repoNamePh'), onChange: (e) => setName(e.target.value) })),
          h(Field, { label: t('repoDesc') }, h('input', { className: 'gs-input', value: description, placeholder: t('repoDescPh'), onChange: (e) => setDescription(e.target.value) }))),
        h('div', { style: { display: 'flex', gap: 18, marginBottom: 14, fontSize: 13 } },
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: isPrivate, onChange: (e) => setPrivate(e.target.checked) }), t('privateRepo')),
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: autoInit, onChange: (e) => setAutoInit(e.target.checked) }), t('autoInit'))),
        h('div', { style: { display: 'flex', gap: 8 } },
          h(Btn, { primary: true, busy, disabled: name.trim() === '', onClick: submit }, t('createRepo')),
          h(Btn, { onClick: onCancel }, t('cancel'))))
    }

    function RepoRow({ repo, onOpen }) {
      return h('div', { className: 'gs-row', onClick: () => onOpen(repo), role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter') onOpen(repo) } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h('span', { style: { fontWeight: 650, ...S.ellipsis } }, repo.fullName),
            repo.private ? h(Badge, { tone: 'warn' }, t('privateBadge')) : null,
            repo.fork ? h(Badge, null, t('forkBadge')) : null,
            repo.empty ? h(Badge, null, t('emptyBadge')) : null),
          repo.description ? h('div', { className: 'gs-muted', style: { fontSize: 12, marginTop: 2, ...S.ellipsis } }, repo.description) : null),
        h('div', { className: 'gs-muted', style: { fontSize: 12, display: 'flex', gap: 12, flex: 'none' } },
          h('span', null, '★ ' + repo.stars),
          h('span', null, '⑂ ' + repo.forks),
          h('span', null, relativeTime(repo.updatedAt))))
    }

    function ReposList({ onOpen, refreshKey }) {
      const [query, setQuery] = React.useState('')
      const [items, setItems] = React.useState([])
      const [page, setPage] = React.useState(1)
      const [hasMore, setHasMore] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [showNew, setShowNew] = React.useState(false)
      const requestSeq = React.useRef(0)
      const load = React.useCallback((q, p, append) => {
        const seq = ++requestSeq.current
        setLoading(true)
        setError('')
        rpc('repos', { query: q, page: p, limit: 30 })
          .then((result) => {
            if (seq !== requestSeq.current) return
            setItems((prev) => (append ? prev.concat(result.items) : result.items))
            setPage(p)
            setHasMore(result.hasMore)
          })
          .catch((err) => { if (seq === requestSeq.current) setError(messageOf(err)) })
          .finally(() => { if (seq === requestSeq.current) setLoading(false) })
      }, [])
      React.useEffect(() => {
        const timer = setTimeout(() => load(query.trim(), 1, false), query ? 300 : 0)
        return () => clearTimeout(timer)
      }, [query, load, refreshKey])
      return h('div', null,
        h('div', { style: S.toolbar },
          h('input', { className: 'gs-input', style: { maxWidth: 320 }, value: query, placeholder: t('searchRepos'), onChange: (e) => setQuery(e.target.value) }),
          h('div', { style: S.spacer }),
          h(Btn, { onClick: () => setShowNew((v) => !v) }, t('newRepo')),
          h(Btn, { onClick: () => load(query.trim(), 1, false), title: t('refresh') }, '↻')),
        showNew ? h(NewRepoForm, { onCancel: () => setShowNew(false), onCreated: () => { setShowNew(false); load(query.trim(), 1, false) } }) : null,
        h(ErrorBanner, { error, onRetry: () => load(query.trim(), 1, false) }),
        loading && items.length === 0
          ? h('div', { style: { padding: 24, textAlign: 'center' } }, h(Spinner))
          : items.length === 0
            ? h(EmptyBox, { text: t('noRepos'), hint: query ? undefined : t('noReposHint') })
            : h('div', { className: 'gs-card' }, items.map((repo) => h(RepoRow, { key: repo.fullName, repo, onOpen }))),
        hasMore ? h('div', { style: { marginTop: 12, textAlign: 'center' } }, h(Btn, { busy: loading, onClick: () => load(query.trim(), page + 1, true) }, t('loadMore'))) : null)
    }

    /* ------------------------------------------------------- branch graph */

    const LANE_W = 22
    const ROW_H = 30
    const GRAPH_PAD = 12

    /** Assign each commit a lane so parents continue their child's lane. */
    function layoutGraph(nodes) {
      const rowOf = new Map()
      nodes.forEach((node, index) => rowOf.set(node.sha, index))
      const lanes = []
      const laneOf = new Map()
      for (const node of nodes) {
        let lane = lanes.findIndex((expected) => expected === node.sha)
        if (lane === -1) {
          lane = lanes.findIndex((expected) => expected === null)
          if (lane === -1) {
            lane = lanes.length
            lanes.push(null)
          }
        }
        lanes[lane] = null
        laneOf.set(node.sha, lane)
        node.parents.forEach((parent, index) => {
          if (!rowOf.has(parent)) return
          if (lanes.some((expected) => expected === parent)) return
          if (index === 0) {
            lanes[lane] = parent
          } else {
            let free = lanes.findIndex((expected) => expected === null)
            if (free === -1) {
              free = lanes.length
              lanes.push(null)
            }
            lanes[free] = parent
          }
        })
      }
      return { rowOf, laneOf, laneCount: Math.max(1, lanes.length) }
    }

    function BranchGraph({ owner, repo, refreshKey }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const load = React.useCallback(() => {
        setLoading(true)
        setError('')
        rpc('graph', { owner, repo, limit: 60 })
          .then(setData)
          .catch((err) => setError(messageOf(err)))
          .finally(() => setLoading(false))
      }, [owner, repo])
      React.useEffect(() => { load() }, [load, refreshKey])
      if (loading && !data) return h('div', { style: { padding: 24, textAlign: 'center' } }, h(Spinner))
      if (error) return h(ErrorBanner, { error, onRetry: load })
      if (!data || data.nodes.length === 0) return h(EmptyBox, { text: t('graphEmpty') })
      const { rowOf, laneOf, laneCount } = layoutGraph(data.nodes)
      const xOf = (lane) => GRAPH_PAD + lane * LANE_W + 9
      const yOf = (row) => row * ROW_H + ROW_H / 2
      const svgWidth = GRAPH_PAD * 2 + laneCount * LANE_W
      const svgHeight = data.nodes.length * ROW_H
      const colorOfLane = (lane) => PALETTE[((lane % PALETTE.length) + PALETTE.length) % PALETTE.length]
      return h('div', { className: 'gs-card', style: { padding: '12px 8px' } },
        h('div', { className: 'gs-graph-wrap' },
          h('svg', { width: svgWidth, height: svgHeight, style: { flex: 'none' }, 'aria-hidden': true },
            data.edges.map((edge, index) => {
              const fromLane = laneOf.get(edge.from)
              const toLane = laneOf.get(edge.to)
              const fromRow = rowOf.get(edge.from)
              const toRow = rowOf.get(edge.to)
              if (fromLane === undefined || toLane === undefined) return null
              const x1 = xOf(fromLane)
              const y1 = yOf(fromRow) + 6
              const x2 = xOf(toLane)
              const y2 = yOf(toRow) - 6
              const mid = (y1 + y2) / 2
              return h('path', {
                key: index,
                d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + mid + ', ' + x2 + ' ' + mid + ', ' + x2 + ' ' + y2,
                fill: 'none',
                stroke: colorOfLane(fromLane),
                strokeWidth: 2,
                strokeOpacity: 0.5,
              })
            }),
            data.nodes.map((node) => {
              const lane = laneOf.get(node.sha)
              return h('circle', {
                key: node.sha,
                cx: xOf(lane),
                cy: yOf(rowOf.get(node.sha)),
                r: 5,
                fill: colorOfLane(lane),
                stroke: 'var(--dsw-alias-bg-layer-1)',
                strokeWidth: 2,
              })
            })),
          h('div', { style: { flex: 1, minWidth: 420 } }, data.nodes.map((node) =>
            h('div', { key: node.sha, className: 'gs-commit-row', title: node.message },
              h('span', { style: { flex: 1, ...S.ellipsis, fontSize: 13 } }, node.message.split('\n')[0]),
              node.branches.map((branch) => h(Badge, { key: branch, tone: 'brand' }, branch)),
              h('span', { className: 'gs-mono gs-muted', style: { flex: 'none' } }, node.short),
              h('span', { className: 'gs-muted', style: { flex: 'none', fontSize: 12, maxWidth: 110, ...S.ellipsis } }, node.author),
              h('span', { className: 'gs-muted', style: { flex: 'none', fontSize: 12, width: 70, textAlign: 'right' } }, relativeTime(node.date)))))))
    }

    function BranchPanel({ owner, repo, refreshKey, onChanged }) {
      const [branches, setBranches] = React.useState(null)
      const [error, setError] = React.useState('')
      const [showNew, setShowNew] = React.useState(false)
      const [name, setName] = React.useState('')
      const [from, setFrom] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const load = React.useCallback(() => {
        rpc('branches', { owner, repo }).then(setBranches).catch((err) => setError(messageOf(err)))
      }, [owner, repo])
      React.useEffect(() => { load() }, [load, refreshKey])
      const create = async () => {
        setBusy(true)
        setError('')
        try {
          await rpc('createBranch', { owner, repo, branch: name, from: from || undefined })
          setName('')
          setShowNew(false)
          load()
          if (onChanged) onChanged()
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }
      const remove = async (branch) => {
        await rpc('deleteBranch', { owner, repo, branch })
        load()
        if (onChanged) onChanged()
      }
      return h('div', null,
        h(ErrorBanner, { error, onRetry: load }),
        h('div', { style: { ...S.badgeRow, marginBottom: 12 } },
          branches === null ? h(Spinner) : branches.map((branch) =>
            h('span', { key: branch.name, className: 'gs-badge', style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', fontSize: 12 } },
              branch.name,
              branch.default ? h(Badge, { tone: 'brand' }, t('defaultBranch')) : null,
              branch.protected ? h('span', { title: t('protectedBranch') }, '🔒') : null,
              !branch.default && !branch.protected
                ? h(ConfirmBtn, { label: '✕', confirmLabel: t('deleteBranchConfirm'), onConfirm: () => remove(branch.name) })
                : null)),
          h(Btn, { onClick: () => setShowNew((v) => !v) }, '+ ' + t('newBranch'))),
        showNew ? h('div', { className: 'gs-card', style: { padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { className: 'gs-input', style: { width: 180 }, value: name, placeholder: t('branchNamePh'), onChange: (e) => setName(e.target.value) }),
          h('select', { className: 'gs-select', style: { width: 160 }, value: from, onChange: (e) => setFrom(e.target.value) },
            h('option', { value: '' }, t('fromBranch')),
            (branches || []).map((branch) => h('option', { key: branch.name, value: branch.name }, branch.name))),
          h(Btn, { primary: true, busy, disabled: name.trim() === '', onClick: create }, t('createBranch')),
          h(Btn, { onClick: () => setShowNew(false) }, t('cancel'))) : null,
        h(BranchGraph, { owner, repo, refreshKey }))
    }

    /* -------------------------------------------------------- repo detail */

    function RepoDetail({ owner, name, onBack, onOpenPull, initialTab }) {
      const [repo, setRepo] = React.useState(null)
      const [error, setError] = React.useState('')
      const [tab, setTab] = React.useState(initialTab || 'branches')
      const [refreshKey, setRefreshKey] = React.useState(0)
      const [chatBusy, setChatBusy] = React.useState(false)
      const [chatError, setChatError] = React.useState('')
      const [copied, setCopied] = React.useState(false)
      const load = React.useCallback(() => {
        rpc('repo', { owner, repo: name }).then(setRepo).catch((err) => setError(messageOf(err)))
      }, [owner, name])
      React.useEffect(() => { load() }, [load])
      const bump = () => setRefreshKey((n) => n + 1)
      const chat = async () => {
        setChatBusy(true)
        setChatError('')
        try {
          const result = await rpc('openChat', { owner, repo: name, branch: repo ? repo.defaultBranch : undefined })
          const uiWorkspace = clientCtx && clientCtx.get('uiWorkspace')
          if (!uiWorkspace || !uiWorkspace.openWorkspace || !result.workspaceId) {
            setChatError(t('chatNoService') + ' ' + result.path)
            return
          }
          await uiWorkspace.openWorkspace(result.workspaceId, (sessionId) => {
            void rpc('bind', { sessionId, owner, repo: name, branch: result.branch || (repo && repo.defaultBranch) || '', path: result.path }).catch(() => {})
          })
          const layout = clientCtx && clientCtx.get('layout')
          if (layout && layout.selectPanel) layout.selectPanel('conversation')
        } catch (err) {
          setChatError(messageOf(err))
        } finally {
          setChatBusy(false)
        }
      }
      const copyClone = async () => {
        const ok = await copyText(repo ? repo.cloneUrl : '')
        setCopied(ok)
        setTimeout(() => setCopied(false), 2000)
      }
      const remove = async () => {
        await rpc('deleteRepo', { owner, repo: name })
        onBack()
      }
      return h('div', null,
        h('div', { style: S.header },
          h(Btn, { onClick: onBack }, '← ' + t('back')),
          h('div', { style: { minWidth: 0 } },
            h('h2', { style: { ...S.title, ...S.ellipsis } }, owner + '/' + name),
            repo && repo.description ? h('p', { style: S.subtitle }, repo.description) : null),
          repo && repo.private ? h(Badge, { tone: 'warn' }, t('privateBadge')) : null,
          h('div', { style: S.spacer }),
          h(Btn, { primary: true, busy: chatBusy, onClick: chat }, chatBusy ? t('chatBusy') : t('chatRepo')),
          h(Btn, { onClick: copyClone }, copied ? t('copied') : t('cloneUrl')),
          h(ConfirmBtn, { label: t('deleteRepo'), confirmLabel: t('deleteRepoConfirm'), onConfirm: remove })),
        h(ErrorBanner, { error, onRetry: load }),
        h(ErrorBanner, { error: chatError }),
        h(Tabs, {
          tabs: [
            { id: 'branches', label: t('branchesTab') },
            { id: 'pulls', label: t('pullsTab') },
            { id: 'files', label: t('filesTab') },
          ],
          active: tab,
          onSelect: setTab,
        }),
        tab === 'branches' ? h(BranchPanel, { owner, repo: name, refreshKey, onChanged: bump }) : null,
        tab === 'pulls' ? h(PullsList, { owner, repo: name, onOpen: onOpenPull, refreshKey }) : null,
        tab === 'files' ? h(FilesBrowser, { owner, repo: name, defaultRef: repo ? repo.defaultBranch : '' }) : null)
    }

    /* ------------------------------------------------------ pull requests */

    function pullBadge(pull) {
      if (pull.merged) return h(Badge, { tone: 'brand' }, t('stateMerged'))
      if (pull.state === 'open') return h(Badge, { tone: 'success' }, t('stateOpen'))
      return h(Badge, { tone: 'error' }, t('stateClosed'))
    }

    function PullRow({ pull, onOpen, showRepo }) {
      return h('div', { className: 'gs-row', onClick: () => onOpen(pull), role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter') onOpen(pull) } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            pullBadge(pull),
            h('span', { style: { fontWeight: 600, ...S.ellipsis } }, (showRepo && pull.repo ? pull.repo.fullName + ' ' : '') + '#' + pull.index + ' ' + pull.title)),
          h('div', { className: 'gs-muted', style: { fontSize: 12, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' } },
            pull.head && pull.head.ref ? h('span', { className: 'gs-mono' }, pull.head.ref + ' → ' + (pull.base ? pull.base.ref : '')) : null,
            h('span', null, (pull.author && pull.author.login) || ''),
            h('span', null, relativeTime(pull.updatedAt)))),
        h(Avatar, { url: pull.author && pull.author.avatarUrl, size: 22 }))
    }

    function PullsList({ owner, repo, onOpen, refreshKey }) {
      const [state, setState] = React.useState('open')
      const [items, setItems] = React.useState(null)
      const [branches, setBranches] = React.useState([])
      const [error, setError] = React.useState('')
      const [showNew, setShowNew] = React.useState(false)
      const [title, setTitle] = React.useState('')
      const [head, setHead] = React.useState('')
      const [base, setBase] = React.useState('')
      const [body, setBody] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const load = React.useCallback(() => {
        setError('')
        rpc('pulls', { owner, repo, state }).then((v) => setItems(v.items)).catch((err) => setError(messageOf(err)))
      }, [owner, repo, state])
      React.useEffect(() => { load() }, [load, refreshKey])
      React.useEffect(() => {
        rpc('branches', { owner, repo }).then((list) => {
          setBranches(list)
          const def = list.find((b) => b.default)
          if (def) setBase((prev) => prev || def.name)
        }).catch(() => {})
      }, [owner, repo, refreshKey])
      const create = async () => {
        setBusy(true)
        setError('')
        try {
          await rpc('createPull', { owner, repo, title, head, base, body })
          setTitle(''); setBody(''); setShowNew(false)
          load()
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }
      return h('div', null,
        h('div', { style: S.toolbar },
          h('select', { className: 'gs-select', style: { width: 130 }, value: state, onChange: (e) => setState(e.target.value) },
            h('option', { value: 'open' }, t('stateOpen')),
            h('option', { value: 'closed' }, t('stateClosed')),
            h('option', { value: 'all' }, t('stateAll'))),
          h('div', { style: S.spacer }),
          h(Btn, { onClick: () => setShowNew((v) => !v) }, '+ ' + t('newPull')),
          h(Btn, { onClick: load, title: t('refresh') }, '↻')),
        showNew ? h('div', { className: 'gs-card', style: { padding: 16, marginBottom: 14 } },
          h(Field, { label: t('pullTitlePh') }, h('input', { className: 'gs-input', value: title, onChange: (e) => setTitle(e.target.value) })),
          h('div', { style: S.grid2 },
            h(Field, { label: t('headBranch') }, h('select', { className: 'gs-select', value: head, onChange: (e) => setHead(e.target.value) },
              h('option', { value: '' }, '—'), branches.map((b) => h('option', { key: b.name, value: b.name }, b.name)))),
            h(Field, { label: t('baseBranch') }, h('select', { className: 'gs-select', value: base, onChange: (e) => setBase(e.target.value) },
              h('option', { value: '' }, '—'), branches.map((b) => h('option', { key: b.name, value: b.name }, b.name))))),
          h(Field, { label: t('pullBodyPh') }, h('textarea', { className: 'gs-textarea', value: body, onChange: (e) => setBody(e.target.value) })),
          h('div', { style: { display: 'flex', gap: 8 } },
            h(Btn, { primary: true, busy, disabled: !title.trim() || !head || !base, onClick: create }, t('createPull')),
            h(Btn, { onClick: () => setShowNew(false) }, t('cancel')))) : null,
        h(ErrorBanner, { error, onRetry: load }),
        items === null
          ? h('div', { style: { padding: 24, textAlign: 'center' } }, h(Spinner))
          : items.length === 0
            ? h(EmptyBox, { text: t('noPulls') })
            : h('div', { className: 'gs-card' }, items.map((pull) => h(PullRow, { key: pull.index, pull, onOpen }))))
    }

    function DiffFile({ file }) {
      const [open, setOpen] = React.useState(true)
      const lines = (file.patch || '').split('\n')
      return h('div', { className: 'gs-card', style: { marginBottom: 10, overflow: 'hidden' } },
        h('div', { className: 'gs-row', style: { cursor: 'pointer' }, onClick: () => setOpen((v) => !v) },
          h('span', { style: { flex: 'none' } }, open ? '▾' : '▸'),
          h('span', { className: 'gs-mono', style: { flex: 1, ...S.ellipsis } }, file.filename),
          h('span', { style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, flex: 'none' } }, '+' + file.additions),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, flex: 'none' } }, '−' + file.deletions)),
        open ? (file.patch
          ? h('pre', { className: 'gs-diff' }, lines.map((line, index) => {
              const cls = line.startsWith('+') ? 'gs-diff-line gs-diff-add'
                : line.startsWith('-') ? 'gs-diff-line gs-diff-del'
                : line.startsWith('@@') ? 'gs-diff-line gs-diff-hunk'
                : 'gs-diff-line'
              return h('div', { key: index, className: cls }, line || ' ')
            }))
          : h('div', { className: 'gs-muted', style: { padding: 12, fontSize: 12 } }, t('diffEmpty'))) : null)
    }

    function PullDetail({ owner, repo, index, onBack }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [tab, setTab] = React.useState('files')
      const [comment, setComment] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [ok, setOk] = React.useState('')
      const load = React.useCallback(() => {
        setError('')
        rpc('pull', { owner, repo, index }).then(setData).catch((err) => setError(messageOf(err)))
      }, [owner, repo, index])
      React.useEffect(() => { load() }, [load])
      const act = async (kind, fn, okText) => {
        setBusy(kind)
        setError('')
        setOk('')
        try {
          await fn()
          setOk(okText)
          load()
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy('')
        }
      }
      if (error && !data) return h('div', null, h('div', { style: S.header }, h(Btn, { onClick: onBack }, '← ' + t('back'))), h(ErrorBanner, { error, onRetry: load }))
      if (!data) return h('div', { style: { padding: 24, textAlign: 'center' } }, h(Spinner))
      const pull = data.pull
      return h('div', null,
        h('div', { style: S.header },
          h(Btn, { onClick: onBack }, '← ' + t('back')),
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('h2', { style: { ...S.title, ...S.ellipsis } }, pull.title + ' #' + pull.index),
            h('div', { className: 'gs-muted', style: { fontSize: 12, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              pullBadge(pull),
              h(Avatar, { url: pull.author && pull.author.avatarUrl, size: 16 }),
              h('span', null, (pull.author && pull.author.login) || ''),
              h('span', null, relativeTime(pull.createdAt)),
              pull.head && pull.head.ref ? h('span', { className: 'gs-mono' }, pull.head.ref + ' → ' + (pull.base ? pull.base.ref : '')) : null)),
          pull.state === 'open' && !pull.merged
            ? h(ConfirmBtn, { label: t('merge'), confirmLabel: t('mergeConfirm'), danger: false, onConfirm: () => act('merge', () => rpc('mergePull', { owner, repo, index }), t('mergedOk')) })
            : null,
          pull.state === 'open'
            ? h(Btn, { busy: busy === 'state', onClick: () => act('state', () => rpc('setPullState', { owner, repo, index, state: 'closed' }), t('pullClosed')) }, t('closePull'))
            : h(Btn, { busy: busy === 'state', onClick: () => act('state', () => rpc('setPullState', { owner, repo, index, state: 'open' }), t('pullReopened')) }, t('reopenPull'))),
        h(ErrorBanner, { error }),
        h(OkBanner, { text: ok }),
        pull.body ? h('div', { className: 'gs-card', style: { padding: 14, marginBottom: 14, whiteSpace: 'pre-wrap', fontSize: 13 } }, pull.body) : null,
        h(Tabs, {
          tabs: [
            { id: 'files', label: t('pullFiles') + ' (' + data.files.length + ')' },
            { id: 'comments', label: t('pullComments') + ' (' + data.comments.length + ')' },
          ],
          active: tab,
          onSelect: setTab,
        }),
        tab === 'files'
          ? (data.files.length === 0 ? h(EmptyBox, { text: t('diffEmpty') }) : data.files.map((file, i) => h(DiffFile, { key: file.filename + i, file })))
          : h('div', null,
              data.comments.length === 0 ? h(EmptyBox, { text: t('noComments') }) : data.comments.map((c) =>
                h('div', { key: c.id, className: 'gs-card', style: { padding: 12, marginBottom: 10 } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                    h(Avatar, { url: c.author && c.author.avatarUrl, size: 20 }),
                    h('span', { style: { fontWeight: 600, fontSize: 13 } }, (c.author && c.author.login) || ''),
                    h('span', { className: 'gs-muted', style: { fontSize: 12 } }, relativeTime(c.createdAt))),
                  h('div', { style: { whiteSpace: 'pre-wrap', fontSize: 13 } }, c.body))),
              h('div', { className: 'gs-card', style: { padding: 12, marginTop: 12 } },
                h('textarea', { className: 'gs-textarea', value: comment, placeholder: t('commentPh'), onChange: (e) => setComment(e.target.value) }),
                h('div', { style: { marginTop: 8 } },
                  h(Btn, { primary: true, busy: busy === 'comment', disabled: comment.trim() === '', onClick: () => act('comment', async () => { await rpc('commentPull', { owner, repo, index, body: comment }); setComment('') }, t('commentOk')) }, t('addComment'))))))
    }

    /* ------------------------------------------------------- file browser */

    function FilesBrowser({ owner, repo, defaultRef }) {
      const [path, setPath] = React.useState('')
      const [items, setItems] = React.useState(null)
      const [fileView, setFileView] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const load = React.useCallback((p) => {
        setLoading(true)
        setError('')
        setItems(null)
        rpc('files', { owner, repo, path: p, ref: defaultRef || undefined })
          .then((v) => setItems(v.items))
          .catch((err) => setError(messageOf(err)))
          .finally(() => setLoading(false))
      }, [owner, repo, defaultRef])
      React.useEffect(() => { load(path) }, [path, load])
      const openFile = async (entry) => {
        setError('')
        try {
          const result = await rpc('file', { owner, repo, path: entry.path, ref: defaultRef || undefined })
          setFileView(result)
        } catch (err) {
          setError(messageOf(err))
        }
      }
      const segments = path === '' ? [] : path.split('/')
      if (fileView) {
        return h('div', null,
          h('div', { style: S.toolbar },
            h(Btn, { onClick: () => setFileView(null) }, '← ' + t('back')),
            h('span', { className: 'gs-mono', style: S.ellipsis }, fileView.path)),
          h('pre', { className: 'gs-pre' }, fileView.content))
      }
      return h('div', null,
        h('div', { style: { ...S.toolbar, fontSize: 13 } },
          h('button', { type: 'button', className: 'gs-crumb', onClick: () => setPath('') }, t('pathRoot')),
          segments.map((segment, i) => h('span', { key: i, style: { display: 'inline-flex', alignItems: 'center' } },
            h('span', { className: 'gs-muted' }, '/'),
            h('button', { type: 'button', className: 'gs-crumb', onClick: () => setPath(segments.slice(0, i + 1).join('/')) }, segment)))),
        h(ErrorBanner, { error, onRetry: () => load(path) }),
        loading || items === null
          ? h('div', { style: { padding: 24, textAlign: 'center' } }, h(Spinner))
          : items.length === 0
            ? h(EmptyBox, { text: t('dirEmpty') })
            : h('div', { className: 'gs-card' }, items.map((entry) =>
                h('div', { key: entry.path, className: 'gs-row', onClick: () => (entry.type === 'dir' ? setPath(entry.path) : openFile(entry)), role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter') entry.type === 'dir' ? setPath(entry.path) : openFile(entry) } },
                  h('span', { style: { flex: 'none' } }, entry.type === 'dir' ? '📁' : '📄'),
                  h('span', { style: { flex: 1, ...S.ellipsis, fontSize: 13 } }, entry.name),
                  entry.type === 'file' ? h('span', { className: 'gs-muted', style: { fontSize: 12, flex: 'none' } }, entry.size + ' B') : null))))
    }

    /* ------------------------------------------- conversation repo linking */

    const GIT_REF_PREFIX = '@git:'

    /* Shared repo catalog for the @ source, the + menu popup, and pickers. */
    const repoCache = { items: null, promise: null, listeners: new Set() }
    function notifyRepoCache() {
      for (const listener of repoCache.listeners) listener()
    }
    function getRepos(force) {
      if (repoCache.items && !force) return Promise.resolve(repoCache.items)
      if (repoCache.promise && !force) return repoCache.promise
      repoCache.promise = rpc('repos', { limit: 100 })
        .then((result) => {
          repoCache.items = result.items
          repoCache.promise = null
          notifyRepoCache()
          return result.items
        })
        .catch((error) => {
          repoCache.promise = null
          throw error
        })
      return repoCache.promise
    }

    /* Per-session binding state, refreshed after every link/unlink. */
    const linkStore = { bySession: {}, errors: {}, listeners: new Set() }
    function notifyLinkStore() {
      for (const listener of linkStore.listeners) listener()
    }
    function useLinkStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((n) => n + 1)
        linkStore.listeners.add(listener)
        return () => linkStore.listeners.delete(listener)
      }, [])
      return linkStore
    }
    async function refreshBindings() {
      const result = await rpc('bindings')
      const map = {}
      for (const binding of result.items) map[binding.sessionId] = binding
      linkStore.bySession = map
      notifyLinkStore()
      return map
    }
    async function linkRepoToSession(sessionId, fullName, branch) {
      const splitAt = fullName.lastIndexOf('/')
      const owner = fullName.slice(0, splitAt)
      const repo = fullName.slice(splitAt + 1)
      try {
        const result = await rpc('linkRepo', { sessionId, owner, repo, branch: branch || '' })
        linkStore.bySession = {
          ...linkStore.bySession,
          [sessionId]: {
            sessionId, owner, repo,
            branch: result.branch || branch || '',
            path: result.path,
            accountId: result.accountId || '',
            platform: result.platform || '',
          },
        }
        const errors = { ...linkStore.errors }
        delete errors[sessionId]
        linkStore.errors = errors
        notifyLinkStore()
        void refreshBindings().catch(() => {})
        return result
      } catch (error) {
        linkStore.errors = { ...linkStore.errors, [sessionId]: messageOf(error) }
        notifyLinkStore()
        throw error
      }
    }
    async function unlinkSession(sessionId) {
      await rpc('unbind', { sessionId })
      const next = { ...linkStore.bySession }
      delete next[sessionId]
      linkStore.bySession = next
      notifyLinkStore()
    }
    function defaultBranchOf(fullName) {
      const item = (repoCache.items || []).find((repo) => repo.fullName === fullName)
      return item ? item.defaultBranch : ''
    }

    /* @ trigger source: typing @ lists repos of the active account; a pick inserts a chip and links the session. */
    function makeGiteaTriggerSource() {
      return {
        trigger: '@',
        name: 'git-repo',
        async warm() {
          if (store.state && store.state.configured) await getRepos().catch(() => {})
        },
        async candidates(session, req) {
          if (!store.state || !store.state.configured) return []
          const items = await getRepos()
          if (req.signal && req.signal.aborted) return []
          const query = (req.query || '').toLowerCase()
          return items
            .filter((repo) => query === '' || repo.fullName.toLowerCase().includes(query) || (repo.description || '').toLowerCase().includes(query))
            .map((repo) => ({
              name: repo.fullName,
              label: repo.fullName,
              description: repo.description || '',
              icon: GitGlyph,
              section: t('gitSection'),
              value: repo.fullName,
            }))
        },
        onPick({ candidate, session }) {
          const fullName = candidate.value || candidate.name
          void linkRepoToSession(session.sessionId, fullName, defaultBranchOf(fullName)).catch(() => {})
          return {
            insert: {
              source: 'git-repo',
              ref: fullName,
              label: fullName,
              appearance: 'folder',
              clipboardText: GIT_REF_PREFIX + fullName,
            },
          }
        },
        codec: {
          clipboardText: (ref) => GIT_REF_PREFIX + ref,
          serialize: (ref) => Promise.resolve(GIT_REF_PREFIX + ref),
        },
      }
    }

    /* + menu contribution: a popupSelect command listing repos for the current session. */
    function makeGiteaCommandContribution() {
      return {
        name: 'git-repo',
        label: () => t('linkRepoTitle'),
        description: () => t('linkRepoDesc'),
        icon: GitGlyph,
        available: () => Boolean(store.state && store.state.configured),
        ui: {
          kind: 'popupSelect',
          searchMode: 'fuzzy-label',
          searchLabels: () => ({ placeholder: t('searchRepos'), empty: t('noRepos'), noResults: t('noRepos') }),
          async options(session) {
            if (!store.state || !store.state.configured) return []
            const items = await getRepos()
            const binding = linkStore.bySession[session.sessionId]
            const activeName = binding ? binding.owner + '/' + binding.repo : ''
            return items.map((repo) => ({
              id: repo.fullName,
              label: repo.fullName,
              detail: repo.description || '',
              badge: repo.private ? t('privateBadge') : undefined,
              active: repo.fullName === activeName,
            }))
          },
          async onSelect(option, session) {
            await linkRepoToSession(session.sessionId, option.id, defaultBranchOf(option.id))
          },
        },
      }
    }

    /* Render submitted @git:owner/repo references as compact repo chips (@gitea: kept for old messages). */
    const giteaRefRule = {
      id: 'text',
      order: 20,
      match(text, from) {
        const re = /@(?:git|gitea):([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g
        re.lastIndex = from
        const found = re.exec(text)
        if (!found) return undefined
        return {
          id: 'text',
          start: found.index,
          end: found.index + found[0].length,
          data: { text: found[0], display: '⎇ ' + found[1] },
        }
      },
    }

    /* Composer-row indicator: the repo linked to this session, with unlink. */
    function RepoLinkChip({ sessionId }) {
      const links = useLinkStore()
      const current = useStore()
      const [armed, setArmed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const configured = Boolean(current.state && current.state.configured)
      React.useEffect(() => {
        if (configured) void refreshBindings().catch(() => {})
      }, [configured])
      React.useEffect(() => {
        if (!armed) return undefined
        const timer = setTimeout(() => setArmed(false), 3000)
        return () => clearTimeout(timer)
      }, [armed])
      if (!configured) return null
      const binding = links.bySession[sessionId]
      const error = links.errors[sessionId]
      if (!binding) {
        return error ? h('span', { className: 'gs-link-chip gs-link-chip-error', title: error }, t('linkFailed')) : null
      }
      const fullName = binding.owner + '/' + binding.repo
      const openStudio = () => {
        const layout = clientCtx && clientCtx.get('layout')
        if (layout && layout.selectPanel) layout.selectPanel('gitea-studio')
      }
      return h('span', {
        className: 'gs-link-chip',
        title: (binding.path || fullName) + (binding.branch ? ' · ' + binding.branch : ''),
      },
        h('button', { type: 'button', className: 'gs-link-chip-main', onClick: openStudio }, '⎇ ' + fullName),
        h('button', {
          type: 'button',
          className: 'gs-link-chip-x' + (armed ? ' gs-link-chip-x-armed' : ''),
          title: armed ? t('unlinkConfirm') : t('unlink'),
          'aria-label': armed ? t('unlinkConfirm') : t('unlink'),
          disabled: busy,
          onClick: async () => {
            if (!armed) {
              setArmed(true)
              return
            }
            setBusy(true)
            try {
              await unlinkSession(sessionId)
            } finally {
              setBusy(false)
              setArmed(false)
            }
          },
        }, busy ? '…' : '✕'))
    }

    /* --------------------------------------- conversation branches view */

    function CommitRow({ commit, onOpen, active }) {
      return h('div', {
        className: 'gs-row',
        style: { cursor: onOpen ? 'pointer' : 'default', background: active ? 'var(--dsw-alias-bg-layer-2)' : undefined },
        onClick: onOpen ? () => onOpen(commit) : undefined,
      },
        h('span', { className: 'gs-mono', style: { flex: 'none', color: 'var(--dsw-alias-brand-primary)', fontSize: 12 } }, commit.short),
        h('span', { style: { flex: 1, minWidth: 0, ...S.ellipsis } }, (commit.message || '').split('\n')[0]),
        h('span', { className: 'gs-muted', style: { flex: 'none', fontSize: 12, maxWidth: 110, ...S.ellipsis } }, commit.author),
        h('span', { className: 'gs-muted', style: { flex: 'none', fontSize: 12, width: 76, textAlign: 'right' } }, relativeTime(commit.date)))
    }

    function DiffStats({ stats }) {
      if (!stats) return null
      return h('span', { className: 'gs-mono', style: { fontSize: 12 } },
        h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, '+' + (stats.additions ?? 0)),
        ' ',
        h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '−' + (stats.deletions ?? 0)))
    }

    /* The "分支" view in the conversation view ring: versions and diffs of the linked repo. */
    function BranchView({ sessionId }) {
      const links = useLinkStore()
      const current = useStore()
      const [branches, setBranches] = React.useState(null)
      const [branch, setBranch] = React.useState('')
      const [mode, setMode] = React.useState('commits')
      const [commits, setCommits] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [base, setBase] = React.useState('')
      const [head, setHead] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [tick, setTick] = React.useState(0)
      const configured = Boolean(current.state && current.state.configured)
      const binding = links.bySession[sessionId]
      const fullName = binding ? binding.owner + '/' + binding.repo : ''

      React.useEffect(() => {
        if (configured) void refreshBindings().catch(() => {})
      }, [configured])

      React.useEffect(() => {
        if (!binding) return undefined
        let alive = true
        setBranches(null)
        setCommits(null)
        setSelected(null)
        setResult(null)
        setError('')
        rpc('branches', { owner: binding.owner, repo: binding.repo, accountId: binding.accountId || undefined })
          .then((items) => {
            if (!alive) return
            setBranches(items)
            const def = items.find((b) => b.default) || items[0]
            const initial = binding.branch || (def ? def.name : '')
            setBranch(initial)
            setBase(initial)
            setHead(initial)
          })
          .catch((err) => { if (alive) setError(messageOf(err)) })
        return () => { alive = false }
      }, [fullName, tick])

      React.useEffect(() => {
        if (!binding || !branch) return undefined
        let alive = true
        setCommits(null)
        setSelected(null)
        rpc('commits', { owner: binding.owner, repo: binding.repo, branch, limit: 30, accountId: binding.accountId || undefined })
          .then((v) => { if (alive) setCommits(v.items) })
          .catch((err) => { if (alive) setError(messageOf(err)) })
        return () => { alive = false }
      }, [fullName, branch, tick])

      const openCommit = async (commit) => {
        setBusy(true)
        setError('')
        try {
          setSelected(await rpc('commitDiff', { owner: binding.owner, repo: binding.repo, ref: commit.sha, accountId: binding.accountId || undefined }))
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }
      const runCompare = async () => {
        if (!base || !head || base === head) return
        setBusy(true)
        setError('')
        setResult(null)
        try {
          setResult(await rpc('compare', { owner: binding.owner, repo: binding.repo, base, head, accountId: binding.accountId || undefined }))
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }
      const openStudio = () => {
        const layout = clientCtx && clientCtx.get('layout')
        if (layout && layout.selectPanel) layout.selectPanel('gitea-studio')
      }

      if (!configured) {
        return h('div', { style: { padding: 24 } }, h(SetupCard))
      }
      if (!binding) {
        return h('div', { style: { padding: 24 } },
          h(EmptyBox, { text: t('branchViewNoBinding') }),
          h('div', { style: { textAlign: 'center', marginTop: 12 } }, h(Btn, { primary: true, onClick: openStudio }, t('openStudio'))))
      }

      const refListId = 'gs-refs-' + sessionId
      const refOptions = (branches || []).map((b) => h('option', { key: b.name, value: b.name }))
      const toolbar = h('div', { style: { ...S.toolbar, flexWrap: 'wrap' } },
        h('span', { className: 'gs-mono', style: { fontWeight: 650, fontSize: 13 } }, '⎇ ' + fullName),
        mode === 'commits'
          ? h('select', { className: 'gs-select', style: { width: 160 }, value: branch, onChange: (e) => setBranch(e.target.value) },
              (branches || []).map((b) => h('option', { key: b.name, value: b.name }, b.name + (b.default ? ' ★' : ''))))
          : null,
        h('div', { style: S.spacer }),
        h(Tabs, {
          tabs: [{ id: 'commits', label: t('versionsTab') }, { id: 'compare', label: t('compareTab') }],
          active: mode,
          onSelect: (id) => { setMode(id); setError('') },
        }),
        h(Btn, { onClick: () => { setSelected(null); setResult(null); setTick((n) => n + 1); void refreshBindings().catch(() => {}) }, title: t('refresh') }, '↻'))

      let body
      if (mode === 'commits') {
        if (selected) {
          body = h('div', null,
            h('div', { style: { marginBottom: 10 } },
              h(Btn, { onClick: () => setSelected(null) }, '← ' + t('backToCommits'))),
            h('div', { className: 'gs-card', style: { padding: 12, marginBottom: 12 } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { className: 'gs-mono', style: { color: 'var(--dsw-alias-brand-primary)' } }, selected.commit.short),
                h(DiffStats, { stats: selected.stats }),
                h('span', { className: 'gs-muted', style: { fontSize: 12 } }, selected.commit.author + ' · ' + relativeTime(selected.commit.date))),
              h('div', { style: { marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13 } }, selected.commit.message)),
            selected.files.length === 0
              ? h(EmptyBox, { text: t('noChanges') })
              : selected.files.map((file) => h(DiffFile, { key: file.filename, file })))
        } else {
          body = commits === null
            ? h('div', { style: { padding: 24, textAlign: 'center' } }, h(Spinner))
            : commits.length === 0
              ? h(EmptyBox, { text: t('noCommits') })
              : h('div', { className: 'gs-card' }, commits.map((commit) =>
                  h(CommitRow, { key: commit.sha, commit, onOpen: openCommit })))
        }
      } else {
        body = h('div', null,
          h('div', { className: 'gs-card', style: { padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { className: 'gs-input', style: { width: 170 }, list: refListId, value: base, placeholder: t('refPlaceholder'), onChange: (e) => setBase(e.target.value) }),
            h(Btn, { onClick: () => { setBase(head); setHead(base) }, title: t('compareSwap') }, '⇄'),
            h('input', { className: 'gs-input', style: { width: 170 }, list: refListId, value: head, placeholder: t('refPlaceholder'), onChange: (e) => setHead(e.target.value) }),
            h('datalist', { id: refListId }, refOptions),
            h(Btn, { primary: true, busy, disabled: !base || !head || base === head, onClick: runCompare }, t('compareRun')),
            base && head && base === head ? h('span', { className: 'gs-muted', style: { fontSize: 12 } }, t('compareSame')) : null),
          result === null
            ? h(EmptyBox, { text: t('compareEmpty') })
            : h('div', null,
                h('div', { style: { ...S.badgeRow, marginBottom: 10 } },
                  h(Badge, { tone: 'brand' }, t('ahead') + ' ' + result.aheadBy),
                  h(Badge, { tone: 'neutral' }, t('behind') + ' ' + result.behindBy),
                  h(Badge, { tone: 'neutral' }, result.totalCommits + ' ' + t('commitsBetween'))),
                result.commits.length > 0
                  ? h('div', { className: 'gs-card', style: { marginBottom: 12 } }, result.commits.map((commit) => h(CommitRow, { key: commit.sha, commit })))
                  : null,
                result.files.length === 0
                  ? h(EmptyBox, { text: t('noChanges') })
                  : result.files.map((file) => h(DiffFile, { key: file.filename, file }))))
      }

      return h('div', { style: { height: '100%', overflowY: 'auto', padding: 16 } },
        h(StyleTag),
        toolbar,
        h(ErrorBanner, { error, onRetry: () => setError('') }),
        busy && !selected && mode === 'commits' ? h('div', { style: { padding: 12, textAlign: 'center' } }, h(Spinner)) : null,
        body)
    }

    /* ------------------------------------------- contributions heatmap */

    function buildHeatmap(items) {
      const counts = new Map()
      for (const item of items || []) counts.set(item.date, (counts.get(item.date) || 0) + item.contributions)
      const now = new Date()
      const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      const start = new Date(end)
      start.setUTCDate(start.getUTCDate() - 364)
      start.setUTCDate(start.getUTCDate() - start.getUTCDay())
      const weeks = []
      for (let cursor = new Date(start); cursor.getTime() <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
        const week = []
        for (let d = 0; d < 7; d++) {
          const day = new Date(cursor)
          day.setUTCDate(day.getUTCDate() + d)
          const key = day.toISOString().slice(0, 10)
          week.push({ date: key, count: counts.get(key) || 0, future: day.getTime() > end, month: day.getUTCMonth() })
        }
        weeks.push(week)
      }
      const max = Math.max(1, ...counts.values())
      const windowStart = end - 364 * 86400000
      let total = 0
      let active = 0
      let best = 0
      const activeDays = []
      for (const [date, count] of counts) {
        const ts = Date.parse(date + 'T00:00:00Z')
        if (!Number.isFinite(ts) || ts < windowStart || ts > end) continue
        total += count
        active += 1
        best = Math.max(best, count)
        activeDays.push(ts)
      }
      activeDays.sort((a, b) => a - b)
      let streak = 0
      let longest = 0
      let prev = null
      for (const ts of activeDays) {
        streak = prev !== null && ts - prev === 86400000 ? streak + 1 : 1
        longest = Math.max(longest, streak)
        prev = ts
      }
      return { weeks, max, total, active, best, longest }
    }

    const HEAT_COLORS = [
      'color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 72%, var(--dsw-alias-bg-layer-1))',
      'var(--dsw-alias-brand-primary)',
    ]
    function heatLevel(count, max) {
      if (count <= 0) return 0
      return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)))
    }

    function ContributionsView({ refreshKey }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [hover, setHover] = React.useState(null)
      const load = React.useCallback(() => {
        setError('')
        rpc('contributions', {}).then(setData).catch((err) => setError(messageOf(err)))
      }, [])
      React.useEffect(() => { load() }, [load, refreshKey])
      if (error) return h(ErrorBanner, { error, onRetry: load })
      if (data === null) return h('div', { style: { padding: 48, textAlign: 'center' } }, h(Spinner))
      const heat = buildHeatmap(data.items)
      const months = t('months').split(',')
      const CELL = 12
      const GAP = 3
      const LEFT = 34
      const TOP = 20
      const width = LEFT + heat.weeks.length * (CELL + GAP) + 6
      const height = TOP + 7 * (CELL + GAP) + 6
      const monthLabels = []
      let lastMonth = -1
      let lastLabelCol = -3
      heat.weeks.forEach((week, i) => {
        const m = week[0].month
        if (m !== lastMonth && i - lastLabelCol >= 3) {
          monthLabels.push({ x: LEFT + i * (CELL + GAP), label: months[m] || '' })
          lastLabelCol = i
        }
        lastMonth = m
      })
      const stat = (label, value) => h('div', { className: 'gs-card', style: { padding: '10px 16px', textAlign: 'center', minWidth: 96 } },
        h('div', { style: { fontSize: 20, fontWeight: 700, color: 'var(--dsw-alias-brand-primary)' } }, value),
        h('div', { className: 'gs-muted', style: { fontSize: 12, marginTop: 2 } }, label))
      return h('div', null,
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 } },
          stat(t('contribTotal'), heat.total),
          stat(t('contribActiveDays'), heat.active),
          stat(t('contribMaxDay'), heat.best),
          stat(t('contribStreak'), heat.longest)),
        data.approximate ? h('div', { className: 'gs-muted', style: { fontSize: 12, marginBottom: 10 } }, 'ⓘ ' + t('contribApprox')) : null,
        heat.total === 0 ? h(EmptyBox, { text: t('contribEmpty') }) : null,
        h('div', { className: 'gs-card', style: { padding: 14, overflowX: 'auto' } },
          h('div', { className: 'gs-muted', style: { fontSize: 12, height: 18, marginBottom: 4 } },
            hover ? hover.date + ' · ' + hover.count + ' ' + t('contribOn') : data.username + ' · ' + t('contribYear')),
          h('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': t('contribTab') },
            monthLabels.map((m, i) => h('text', { key: 'm' + i, x: m.x, y: 12, fontSize: 10, fill: 'var(--dsw-alias-label-secondary)' }, m.label)),
            [1, 3, 5].map((row) => h('text', {
              key: 'w' + row,
              x: 0,
              y: TOP + row * (CELL + GAP) + CELL - 2,
              fontSize: 9,
              fill: 'var(--dsw-alias-label-secondary)',
            }, row === 1 ? t('wdMon') : row === 3 ? t('wdWed') : t('wdFri'))),
            heat.weeks.map((week, i) => week.map((day, j) => day.future ? null : h('rect', {
              key: day.date,
              x: LEFT + i * (CELL + GAP),
              y: TOP + j * (CELL + GAP),
              width: CELL,
              height: CELL,
              rx: 2,
              fill: HEAT_COLORS[heatLevel(day.count, heat.max)],
              style: { cursor: 'default' },
              onMouseEnter: () => setHover({ date: day.date, count: day.count }),
              onMouseLeave: () => setHover(null),
            }, h('title', null, day.date + ' · ' + day.count + ' ' + t('contribOn')))))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 8 } },
            h('span', { className: 'gs-muted', style: { fontSize: 11 } }, t('contribLess')),
            HEAT_COLORS.map((color, i) => h('span', { key: i, style: { width: 11, height: 11, borderRadius: 2, background: color, display: 'inline-block' } })),
            h('span', { className: 'gs-muted', style: { fontSize: 11 } }, t('contribMore')))))
    }

    /* -------------------------------------------------------- studio page */

    function GitGlyph({ size }) {
      const s = size || 18
      return h('svg', { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('circle', { cx: 6, cy: 5, r: 2.2 }),
        h('circle', { cx: 6, cy: 19, r: 2.2 }),
        h('circle', { cx: 18, cy: 9, r: 2.2 }),
        h('path', { d: 'M6 7.2v9.6' }),
        h('path', { d: 'M18 11.2c0 3-2.5 4.8-6 4.8H8.2' }))
    }

    function PanelIcon({ size }) {
      return h(GitGlyph, { size: size || 18 })
    }

    function SetupCard() {
      return h('div', { style: { maxWidth: 560, margin: '48px auto 0', textAlign: 'center' } },
        h('div', { style: { display: 'inline-flex', padding: 16, borderRadius: 16, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-brand-primary)' } }, h(GitGlyph, { size: 40 })),
        h('h2', { style: { ...S.title, marginTop: 16 } }, t('studioTitle')),
        h('p', { style: S.subtitle }, t('setupPitch')),
        h('div', { className: 'gs-card', style: { padding: 20, marginTop: 20, textAlign: 'left' } },
          h(AccountForm, { onSaved: () => { void loadState().catch(() => {}); void getRepos(true).catch(() => {}) } })),
        h('p', { style: { ...S.hint, marginTop: 12 } }, t('setupHint')))
    }

    function StudioPage() {
      const current = useStore()
      const [loadError, setLoadError] = React.useState('')
      const [view, setView] = React.useState({ name: 'repos' })
      const [refreshKey, setRefreshKey] = React.useState(0)
      React.useEffect(() => {
        loadState().catch((err) => setLoadError(messageOf(err)))
      }, [])
      const state = current.state
      const refresh = () => {
        loadState().catch((err) => setLoadError(messageOf(err)))
        setRefreshKey((n) => n + 1)
      }
      let body
      if (!state) {
        body = loadError
          ? h(ErrorBanner, { error: loadError, onRetry: refresh })
          : h('div', { style: { padding: 48, textAlign: 'center' } }, h(Spinner))
      } else if (!state.configured) {
        body = h(SetupCard)
      } else {
        const account = current.account
        const active = activeAccountOf(state)
        const openRepo = (repo) => setView({ name: 'repo', owner: repo.owner, repo: repo.name })
        const openPull = (owner, repoName, index) => setView({ name: 'pull', owner, repo: repoName, index })
        const switchAccount = async (id) => {
          try {
            const result = await rpc('setActiveAccount', { id })
            setStore({ state: result.state, account: null })
            await loadState().catch(() => {})
            void getRepos(true).catch(() => {})
            void refreshBindings().catch(() => {})
            setView({ name: 'repos' })
            setRefreshKey((n) => n + 1)
          } catch (err) {
            setLoadError(messageOf(err))
          }
        }
        body = h('div', null,
          h('div', { style: S.header },
            h(Avatar, { url: account && account.avatarUrl, size: 32 }),
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontWeight: 650, display: 'flex', alignItems: 'center', gap: 8 } },
                (account && (account.name || account.login)) || (active && active.username) || '',
                active ? h(Badge, { tone: 'brand' }, platformLabel(active.platform)) : null),
              h('div', { className: 'gs-muted', style: { fontSize: 12, ...S.ellipsis } }, active ? active.baseUrl : '')),
            state.accounts && state.accounts.length > 1
              ? h('select', {
                  className: 'gs-select',
                  style: { maxWidth: 220 },
                  value: state.activeAccountId,
                  title: t('switchAccount'),
                  onChange: (e) => switchAccount(e.target.value),
                }, state.accounts.map((a) => h('option', { key: a.id, value: a.id }, platformLabel(a.platform) + ' · ' + (a.username || a.baseUrl))))
              : null,
            h('div', { style: S.spacer }),
            h(Btn, { onClick: refresh, title: t('refresh') }, '↻ ' + t('refresh'))),
          (view.name === 'repos' || view.name === 'contributions')
            ? h(Tabs, {
                tabs: [{ id: 'repos', label: t('reposTab') }, { id: 'contributions', label: t('contribTab') }],
                active: view.name,
                onSelect: (id) => setView({ name: id }),
              })
            : null,
          view.name === 'repos' ? h(ReposList, { onOpen: openRepo, refreshKey }) : null,
          view.name === 'contributions' ? h(ContributionsView, { refreshKey }) : null,
          view.name === 'repo' ? h(RepoDetail, {
            key: view.owner + '/' + view.repo,
            owner: view.owner,
            name: view.repo,
            initialTab: view.tab,
            onBack: () => setView({ name: 'repos' }),
            onOpenPull: (pull) => openPull(view.owner, view.repo, pull.index),
          }) : null,
          view.name === 'pull' ? h(PullDetail, {
            key: view.owner + '/' + view.repo + '#' + view.index,
            owner: view.owner,
            repo: view.repo,
            index: view.index,
            onBack: () => setView({ name: 'repo', owner: view.owner, repo: view.repo, tab: 'pulls' }),
          }) : null)
      }
      return h('div', { className: 'gs-root' }, h(StyleTag), h('div', { style: S.page }, body))
    }

    /* ------------------------------------------------------------- plugin */

    const inject = ['slots', 'locale']

    function apply(ctx) {
      clientCtx = ctx
      t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gitea-studio: dictionaries')
      /* Bootstrap account state so composer integrations work without opening the studio. */
      void rpc('state')
        .then((state) => {
          setStore({ state })
          if (state.configured) void getRepos().catch(() => {})
        })
        .catch(() => {})
      const slots = ctx.slots
      if (!slots) return
      ctx.effect(
        () => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'gitea-studio', order: 32, label: () => t('settingsTitle') },
          SettingsPage,
        )),
        'gitea-studio: settings page',
      )
      ctx.effect(
        () => slots.inject('sidebar.panellist', () => slots.register(
          { name: 'sidebar.panellist', id: 'gitea-studio', order: 12, label: () => t('panelTitle') },
          PanelIcon,
        )),
        'gitea-studio: panel icon',
      )
      ctx.effect(
        () => slots.inject('main', () => slots.register(
          { name: 'main', key: 'gitea-studio' },
          StudioPage,
        )),
        'gitea-studio: studio page',
      )
      ctx.effect(
        () => slots.inject('conversation.view', () => slots.register(
          {
            name: 'conversation.view',
            id: 'gitea-branches',
            order: 20,
            locale: NS,
            label: () => t('branchesView'),
            inject: (sessionId) => ({ sessionId }),
          },
          BranchView,
        )),
        'gitea-studio: branches view',
      )
      ctx.effect(
        () => slots.inject('conversation.input.left', () => slots.register(
          {
            name: 'conversation.input.left',
            id: 'gitea-studio-link',
            order: 50,
            locale: NS,
            inject: (sessionId) => ({ sessionId }),
          },
          RepoLinkChip,
        )),
        'gitea-studio: repo link chip',
      )
      ctx.inject(['inputTriggers'], (scope) => {
        scope.effect(
          () => scope.inputTriggers.registerSource(makeGiteaTriggerSource()),
          'gitea-studio: @ repo source',
        )
      })
      ctx.inject(['commandUi'], (scope) => {
        scope.effect(
          () => scope.commandUi.register(makeGiteaCommandContribution()),
          'gitea-studio: link repo command',
        )
      })
      ctx.inject(['uiConversation'], (scope) => {
        scope.effect(
          () => scope.uiConversation.userText.register(giteaRefRule),
          'gitea-studio: repo reference display',
        )
      })
    }

    return { apply, inject, name: 'gitea-studio' }
  },
})