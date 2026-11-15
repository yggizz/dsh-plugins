# dsh-sync-panel

在 **设置 → 同步与迁移** 里一键打包 / 一键还原「本地插件 + DSH 配置」，用于两台电脑之间保持同一套环境。

## 它做什么

| 按钮 | 底层动作 | 结果 |
|---|---|---|
| 开始打包 | `scripts/dsh-pack.ps1 -ProfileDir … -OutDir …` | 在 `syncDir` 生成 `dsh-sync-YYYYMMDD-HHmm.zip`（大小取决于 `link:` 插件的数量） |
| 开始还原 | `scripts/dsh-restore.ps1 -Zip … -ProfileDir … -PluginsRoot …` | 覆盖插件与 profile 配置，改写 `link:` 路径，按需 `pnpm install`，逐文件校验 SHA256 |

打包内容 = profile `package.json` 里所有 `link:` 插件源码 + `cordis.patch.yml` / `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `cordis.yml`（可选 `.agent-presets`）。

**不带**：`node_modules`、插件 `.data` 缓存、`sessions`、`storages`、`imap_config.json`、`.credentials.yaml`。凭据仍需单独传。

## 为什么调用 ps1 而不是重写一套

命令行脚本已经实测过（30 个插件目录、80 个文件校验一致），设置页只是把它们接到按钮上——**同一份逻辑，不会出现「命令行能跑、界面不能跑」的分叉**。脚本随插件发布（`scripts/`），不依赖工作区里那份副本。

顺带解决了一个坑：Windows 11 智能应用控制会拦「资源管理器 → cmd.exe」，所以双击 `.bat` 会被阻止；而 Host 侧是 Node 直接 `execFile('powershell.exe', …)`，不经过这条链路，实测正常。

## 配置

在 profile 的 `cordis.patch.yml` 覆盖本插件那一行的 `config`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `profileDir` | `%USERPROFILE%\.dsh\profiles\desktop` | 要打包/还原的 profile |
| `syncDir` | `%USERPROFILE%\Documents\dsh-sync` | zip 输出目录，也是还原时的候选列表 |
| `pluginsRoot` | `…\Documents\dsh-sync\plugins` | 另一台机器上插件的落点 |
| `scriptDir` | 本插件 `scripts/` | 想用工作区里那份脚本时改这里 |
| `includePresets` | `false` | 打包默认是否带 `.agent-presets` |
| `installDeps` | `true` | 还原默认是否跑 `pnpm install` |
| `forcePluginsRoot` | `false` | 真：总把插件放到 `pluginsRoot`；假：原路径存在就原地更新 |
| `timeoutMs` | `600000` | 单个任务超时 |
| `maxLogChars` | `20000` | 日志回传上限 |

## 工具

`dsh_sync`（给 agent 用，与界面同一套动作）：

| action | 作用 |
|---|---|
| `status` | 目录、现成 zip、是否有任务在跑 |
| `pack` | 生成 zip（可带 `includePresets`） |
| `restore` | 用 `zip` 还原（可带 `installDeps` / `forcePluginsRoot`） |

## 使用顺序（两台机器）

1. 机器 A：设置页 →「开始打包」→ 复制 `syncDir` 里的 zip；
2. 机器 B：把 zip 放进自己的 `syncDir`（或直接在 `dsh_sync restore` 里给绝对路径）→ 选包 →「开始还原」；
3. **重启 DSH**：Host 插件与 profile 配置只在启动时加载；
4. 验证：设置页里能看到「同步与迁移」、`dsh_sync status` 能报出目录与包。

## 限制

- 仅 Windows（依赖 `powershell.exe`）。
- 还原会改 profile：原文件统一备份成 `*.bak-时间戳`，插件目录同理；确认无误后可自行删除。
- 还原后不会自动重启 DSH，也不应该自动重启（会掐断当前会话）。
- 打包不会解决「DSH 本体版本不一致」的问题：版本差太多时插件 `engines.dsh` 会挡住安装。
