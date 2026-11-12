# Git Studio（Git 工作台）

> [!CAUTION]
> 由于某些原因，最新版不会第一时间同步到Github中，需要最新版的请移步[Gitea仓库](https://gitea.com/ZymJason_DSH/gitea-studio)带来的不便，敬请谅解！

> [!WARNING]
> 目前仅适配Gitea平台

绑定一个 Gitea 账号，在 DeepSeek Harness Web GUI 中可视化管理它，并让对话直接驱动 Git 迭代。

## 功能

- **设置页**（设置 → Gitea 工作台）：填写服务器地址、用户名、API 令牌；保存时自动校验并显示账号信息；令牌仅保存在宿主 `data/gitea-studio/state.json`（0600），不会回传给页面或模型。
- **左侧栏面板**：仓库列表与搜索、新建/删除仓库、分支提交图（SVG 泳道图）、分支管理、Pull Request 列表/详情/差异审阅/评论/合并/关闭、文件浏览、近一年贡献热力图（Contributions，含统计与旧版 Gitea 估算降级）。
- **对话「分支」视图**：对话窗口视图环中「轨迹」右侧的「分支」标签，查看当前会话关联仓库的版本历史与改动对比——单击提交看该提交的 diff，或在「对比」页选择两个引用（分支/标签/sha）查看领先/落后与聚合差异。
- **对话关联仓库**：在输入框加号菜单选「关联 Gitea 仓库」，或输入 `@` 选择 Gitea 仓库，即可把当前会话绑定到该仓库（自动克隆/更新到本地）。输入框左侧显示关联 chip，可两步解除关联；消息中的 `@gitea:owner/repo` 引用会渲染为仓库标记。
- **对话此仓库**：一键克隆/更新仓库并注册工作区，打开绑定会话；此后该会话的 `gitea` 工具默认操作此仓库。
- **`gitea` 工具**：账号/仓库/分支/提交/文件查询与管理，`compare`/`commit_diff` 版本对比，`contributions` 贡献统计，`clone`/`push`/`pull` 本地 Git 同步，PR 全流程，`link` 克隆并关联当前会话、`bind`/`unbind`/`bindings` 会话绑定。推送使用每命令内存态 HTTP Basic 认证，令牌不写入 `.git/config`。

## 使用

1. 在「设置 → Gitea 工作台」填写 Gitea 地址与 API 令牌（Gitea → 设置 → 应用 → 生成令牌，勾选 repo 权限）。
2. 打开左侧栏 Gitea 图标进入工作台；或在对话中说「把当前项目推送到 Gitea 的 xxx 仓库」，模型会调用 `gitea push`。
3. 关联仓库到对话：输入框加号菜单 →「关联 Gitea 仓库」，或直接输入 `@` 后选择仓库；也可在仓库页点「对话此仓库」开启自动 Git 迭代：修改代码后模型会主动提交并推送。

## 结构

- `index.js` — Host 半：Gitea REST 客户端、git 子进程、认证 RPC 路由（`/api/gitea-studio/rpc`）、`gitea` 工具、系统提示节。
- `client.js` — Client 半：设置页、侧栏图标、主面板（仓库/分支图/PR/文件）、加号菜单命令、`@` 引用源、会话关联 chip。
- `cordis.patch.yml` — 插入一个 Host 行；行 config 仅为首次启动默认值。

## 未来计划(详情请移步Gitea平台)
适配其他Git平台
优化和增加功能
