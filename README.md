# Git 工作台 (Git Workbench)

DeepSeek Harness Web GUI 插件：把主流 Git 平台接入对话工作台，可视化管理仓库、分支、PR/MR 与贡献统计，并让 AI 对话直接提交、推送项目，实现自动 Git 迭代。

> 前身为 Gitea Studio。包名、RPC 路径与数据目录保留 `gitea-studio` 内部标识以保证升级兼容；产品名为 **Git 工作台 / Git Workbench**。

## 支持平台

| 平台 | 默认地址 | 令牌获取 |
| --- | --- | --- |
| Gitea | `https://gitea.com`（自建实例填自己的地址） | 设置 → 应用 → 生成令牌（repo 权限） |
| GitHub | `https://api.github.com`（企业版 `https://<host>/api/v3`） | Settings → Developer settings → Personal access tokens（repo 范围） |
| GitLab | `https://gitlab.com`（自建实例填自己的地址） | Preferences → Access Tokens（api 范围） |
| Gitee | `https://gitee.com` | 设置 → 私人令牌（projects 权限） |

**同时登录多账号**：所有已配置账号同时在线——仓库列表、`@` 引用、加号菜单聚合全部账号的仓库（带平台/账号标识，可按账号筛选）；仓库详情、PR/MR、贡献视图自动路由到所属账号；新建仓库可选择目标账号。默认账号仅作为对话中未指明账号时的回退。

**多平台同步推送**：会话绑定可挂多个同步目标（其他平台/账号的仓库）。`git push` 一次提交后，把同一 HEAD 依次推送到主仓库与全部目标——每个目标用各自账号的临时认证头，逐目标返回结果，某个目标失败不阻塞其他目标。分支视图提供同步目标管理与「提交并同步推送」按钮；输入框仓库芯片显示 ⇄N 同步标识。

## 功能

- **仓库管理**：列表 / 搜索 / 新建 / 删除 / 复制克隆地址，私有、复刻、空仓库标识。
- **仓库地址导入**：直接粘贴 Git 仓库地址（`https://host/owner/repo[.git]`、`git@host:owner/repo.git`、`host/owner/repo`）导入——自动匹配已登录账号、解析 owner/repo（含 GitLab 子组路径），克隆后打开仓库；AI 工具新增 `import_repo`，可 `bind:true` 同时关联当前会话。
- **分支**：分支提交图（graph）、新建 / 删除分支、受保护标识。
- **版本与对比**：提交历史、单提交 diff、任意两个引用（分支 / 标签 / sha）对比，ahead/behind 统计。
- **PR / MR**：列表、详情、文件变更、评论、创建、合并（merge/rebase/squash，按平台支持）、关闭 / 重开。GitLab 使用 Merge Request。
- **文件浏览**：在线查看仓库文件（≤512KB）。
- **贡献热力图**：近一年贡献可视化（Gitea 用原生 heatmap 接口；其他平台由最近更新仓库的提交估算，界面会标注「估算」）。
- **对话集成**：
  - 输入框 `@` 语法列出**所有账号**的仓库，选择后插入 `@git:owner/repo` 引用并自动克隆、绑定会话；跨平台同名仓库自动加平台前缀消歧（`@git:github:owner/repo`）；
  - 输入框加号菜单「关联 Git 仓库」同样可用；
  - 会话轨迹右侧「分支」视图：查看绑定仓库的版本与改动对比；
  - 输入框下方显示当前会话绑定的仓库（可解除关联）。
- **本地 Git 同步**：clone / push / pull。push 默认提交当前工作目录全部改动并推送；令牌仅通过每条命令的临时 HTTP 头传递，**不写入 `.git/config`**。
- **会话绑定**：`link` 克隆并关联会话；绑定后对话中的 Git 操作默认指向该仓库，AI 完成修改后可主动推送迭代；`add_sync_target`/`remove_sync_target` 管理同步目标。

## 安装与配置

插件以 bundle 形式安装（`plugin_manager install_bundle <目录>`）。首次使用：

1. 打开「设置 → Git 工作台」；
2. 点击「添加账号」，选择平台、填写服务器地址与令牌，「测试并保存」；
3. 可继续添加其他平台账号；所有账号同时在线，工作台顶部以徽章展示在线账号（不再需要切换账号）。

账号与会话绑定持久化在 `data/gitea-studio/state.json`（权限 0600，schema v2，自动从 v1 单账号迁移）。

## AI 工具

插件注册 `git` 工具（35 个动作），与 UI 共享同一操作层：

- 账号：`status` `accounts` `use_account` `account`
- 仓库：`all_repos`（聚合所有账号）`repos` `create_repo` `update_repo` `delete_repo` `import_repo`（按 URL 导入，可 `bind`）
- 分支 / 提交：`branches` `create_branch` `delete_branch` `graph` `commits` `compare` `commit_diff` `contributions`
- 文件：`files` `file`
- 本地同步：`clone` `push`（自动同步到全部目标，`sync:false` 可关闭）`pull`
- 同步目标：`add_sync_target` `remove_sync_target`
- PR/MR：`prs` `pr` `pr_create` `pr_comment` `pr_merge` `pr_state`
- 会话绑定：`link` `bind` `unbind` `bindings`

账号解析顺序：显式 `accountId` → 会话绑定账号 → 当前默认账号。`link` 支持 `platform` 提示选择账号。系统提示词会注入默认账号、本会话绑定与同步目标信息。

## 架构

```
index.js      Host 半：多账号状态(v2)、RPC 路由、git 子进程、工具与提示词
platforms.js  平台适配层：Gitea/GitHub/Gitee 共用 REST 方言，GitLab 独立适配；
              统一输出 Repo/Branch/Commit/Pull/DiffFile/Entry/Comment 规范形状
client.js     浏览器半：工作台页面、设置页、@ 引用、分支视图、贡献热力图
```

- UI ↔ Host 通过 `/api/gitea-studio/rpc`（同源 cookie 鉴权）。
- Git 认证：`git -c http.extraHeader="Authorization: Basic …" -c credential.helper=`，令牌不落盘、不进命令行参数。
- 平台差异（认证头、PR/MR 术语、diff/compare 端点、贡献数据源）全部收敛在适配层。

## 开发

```bash
node --check index.js && node --check platforms.js && node --check client.js
node /tmp/gs-host-test/host.mjs     # 宿主测试（含四平台适配与 v1→v2 迁移）
NODE_ENV=test node /tmp/gs-react-test/render.mjs   # 客户端渲染测试
```

修改 Host 半后需 `remove_bundle` + `install_bundle` 重新部署；client.js 修改由宿主 HMR 自动生效。

## 安全

- 令牌仅存于 0600 权限的状态文件与内存；UI 与工具输出不回显令牌。
- 删除仓库 / 删除分支 / 删除账号等破坏性操作在 UI 中均需二次确认。
- 公开仓库不包含任何凭据。


## 更新日志

### v2.1.1
- 新增仓库地址导入：粘贴 Git URL 即可导入，自动匹配平台账号并解析 owner/repo（含 GitLab 子组）；新增 AI 工具动作 `import_repo`（可 `bind` 关联会话），工作台顶部新增「导入地址」入口。
- 工作台顶部重构：移除冗余的默认账号切换下拉，改为所有在线账号的状态徽章（平台色点 + 账号名），并加入品牌标题区。
- 分支提交图视觉重塑：泳道曲线增加柔和光晕、跨泳道平滑 S 曲线、合并提交双环、悬停高亮与分支徽章收纳，暗色主题下更清晰。

## 声明
本项目使用Deepdeek Harness生成