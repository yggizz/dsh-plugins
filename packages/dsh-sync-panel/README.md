# dsh-sync-panel

在 **设置 → 同步与迁移** 里一键打包 / 一键还原「本地插件 + DSH 配置」，用于两台电脑之间保持同一套环境。打包时可以只挑需要的部分。

## 可勾选的类别

| 类别 | 打包内容 | 还原时做什么 |
|---|---|---|
| **本地插件** `local-plugins` | profile `package.json` 里所有 `link:` 指向的插件源码 | 解到落点、按本机路径改写 `link:`、补进 `bundles` |
| **插件市场插件** `market-plugins` | `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` | 覆盖清单与锁文件，靠 `pnpm install` 按锁定版本重装 |
| **插件配置** `plugin-configs` | 各条目在 `cordis.patch.yml` 里的 `config` 段（不含开关） | 只替换同 id 条目的 `config`，**开关保持本机值** |
| **DSH 配置** `dsh-config` | 整份 `cordis.patch.yml` | **整份覆盖**（含模型、UI、开关、参数），原文件先备份 |
| **插件开关** `plugin-switches` | 只导出每条目的 `disabled` 到 `switch-state.json` | **合并**：只改 `disabled`，其它配置一字不动 |
| **Agent 预设** `presets` | `~/.dsh/.agent-presets` | 复制到目标机同名目录 |

默认勾选前五项（预设需手动勾）。

> `dsh-config` 与 `plugin-configs` / `plugin-switches` 同时勾选时，整份覆盖优先——按整份写入，不再做增量合并。

## 为什么调用 ps1 而不是重写一套

两个 PowerShell 脚本已经实测过，设置页只是把它们接到按钮上——**同一份逻辑，不会出现「命令行能跑、界面不能跑」的分叉**。脚本随插件发布（`scripts/`），不依赖工作区里那份副本。

顺带解决了一个坑：Windows 11 智能应用控制会拦「资源管理器 → cmd.exe」，所以双击 `.bat` 会被阻止；而 Host 侧是 Node 直接 `execFile('powershell.exe', …)`，不经过这条链路。

## 配置

在 profile 的 `cordis.patch.yml` 覆盖本插件那一行的 `config`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `profileDir` | `%USERPROFILE%\.dsh\profiles\desktop` | 要打包/还原的 profile |
| `syncDir` | `%USERPROFILE%\Documents\dsh-sync` | zip 输出目录，也是还原时的候选列表 |
| `pluginsRoot` | `…\Documents\dsh-sync\plugins` | 另一台机器上插件的落点 |
| `scriptDir` | 本插件 `scripts/` | 想用工作区里那份脚本时改这里 |
| `include` | 前五项 | 默认勾选的打包类别 |
| `installDeps` | `true` | 还原默认是否跑 `pnpm install` |
| `forcePluginsRoot` | `false` | 真：总把插件放到 `pluginsRoot`；假：原路径存在就原地更新 |
| `timeoutMs` | `600000` | 单个任务超时 |
| `maxLogChars` | `20000` | 日志回传上限 |

## 工具

`dsh_sync`（与界面同一套动作）：

| action | 参数 | 作用 |
|---|---|---|
| `status` | — | 目录、默认类别、现成 zip、是否有任务在跑 |
| `pack` | `include: string[]` | 按类别生成 zip |
| `restore` | `zip`、`apply: string[]`、`installDeps` | 还原；`apply` 为空表示按包内全部内容 |

## 使用顺序（两台机器）

1. 机器 A：勾选类别 →「开始打包」→ 复制 `syncDir` 里的 zip；
2. 机器 B：把 zip 放进自己的 `syncDir`（或直接给绝对路径）→ 选包 →（可选）勾选只应用哪些类别 →「开始还原」；
3. **重启 DSH**：Host 插件与 profile 配置只在启动时加载；
4. 验证：设置页能看到「同步与迁移」、`dsh_sync status` 报出目录与包。

## 限制

- 仅 Windows（依赖 `powershell.exe`）。
- 还原会改 profile：原文件统一备份成 `*.bak-时间戳`，插件目录同理；确认无误后可删除。
- 还原后不会自动重启 DSH。
- 打包不会解决「DSH 本体版本不一致」：版本差太多时插件 `engines.dsh` 会挡住安装。
- 凭据（`.credentials.yaml`、`imap_config.json`）**始终不打包**，需单独传输。
