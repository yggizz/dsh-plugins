# 小插件套件（dsh-plugin-suite）

把八个自研小功能装进一个插件包，并在「设置 → 小插件」里逐个开关。开关即时生效，不需要重启。

## 八个功能

| 功能 | 做什么 | 关掉之后 |
|---|---|---|
| 文件右键复制 | 对话里的文件右键可复制路径 / 相对路径 / 内容 / 文件本体 | 右键菜单里那几项消失，Host 的两条路由同时卸载 |
| 深浅色切换 | 标题栏（Windows）或侧栏底部一个按钮切换明暗 | 按钮消失 |
| 刷新 / 重启 | 深浅色按钮左边一个按钮，点开选「刷新」或「重启 DSH」 | 按钮消失，Host 的 `/restart` 路由同时卸载 |
| 每轮花费 | 每条回复的操作行显示这一轮实际花掉的积分或人民币 | 药丸消失，Host 停止记账 |
| 隐藏分支按钮 | 去掉助手消息上的「分支到新会话」 | 按钮回来 |
| 记住取消固定的面板 | 重启后仍保持你取消固定的侧栏面板 | 重启后全部回到固定状态 |
| 右侧栏默认展开 | 会话出现时自动展开右栏（窄于 768px 不展开） | 新会话恢复默认收起 |
| 归档筛选一键切换 | 「工作区」标题行搜索图标左侧一个按钮，一键在「隐藏已归档」和「仅显示已归档」间切换 | 按钮消失，归档筛选回到内置菜单 |

### 刷新和重启不是一回事

- **刷新**：`location.reload()`，只重建页面。Host 与正在跑的会话都不受影响。
- **重启 DSH**：关掉桌面端再自动打开。这是**唯一**能让改过的 Host 半（`index.js`、`features/host/*.js`）
  或 profile 补丁生效的办法——Host 是 Electron 的子进程，它没有替换自己的能力。
  - 桌面端以外（浏览器 / 手机）没有可重启的进程，菜单里「重启」置灰。
  - 刚启用这个功能时 Host 路由还没挂上，会显示「重启接口未加载，手动重启一次后可用」。
  - 日志：`%TEMP%\dsh-plugin-suite-restart.log`。重启没成功就看这里。
  - 安全边界：helper 动手前先核对父进程镜像确实是 `DeepSeek Harness.exe`；核对不通过就什么都不做，
    并在日志里写「refusing to act」——**宁可什么都不做，也不留两个实例抢同一个 profile 锁**。

## 开关存在哪

`~/.dsh/plugin-suite.json`（尊重 `DSH_HOME`）：

```json
{
  "version": 1,
  "features": {
    "artifact-copy": true,
    "theme-toggle": true,
    "refresh-restart": true,
    "turn-credits": true,
    "hide-branch": true,
    "sidebar-pins": true,
    "rightbar-default-open": true,
    "archive-filter-toggle": true
  }
}
```

Host 通过 `/plugins/plugin-suite/state` 提供读写（GET 读、POST 写单个或 `{ "all": true|false }` 写全部），
只应答 loopback Host 头。浏览器侧另存一份 localStorage 镜像（`dsh.plugin-suite.v1`），
只为刷新后的第一帧不闪；权威永远是上面那个文件。

## 开关为什么是真的卸载

每个功能原来是一个独立插件，有自己的 `apply(ctx)`。套件把它挂到 `ctx.plugin()` 建出的**子 fiber** 上：

```
ctx.plugin({ inject, apply: ctx => feature.apply(ctx) })  →  fiber
fiber.dispose()                                            →  该功能注册的一切全部释放
```

于是 `ctx.effect` / `ctx.slots.inject` / `ctx.on` / `ctx.locale.register` / 路由注册
都随 fiber 一起走，不是用 CSS 藏起来。Host 侧同样：`features/host/*.js` 原样挂成独立 fiber，
关掉就注销路由、摘掉 `session/event` 监听。

## 目录

```
dsh-plugin-suite/
├── index.js                 # Host 半边：开关文件 + /state 路由 + 三个 Host 功能
├── client.js                # 构建产物（勿手改）
├── features/
│   ├── client/*.raw.js      # 八个原始 client 源文件，逐字节保留
│   └── host/*.js            # 三个原始 host 源文件，逐字节保留
├── scripts/build.mjs        # 把 raw 拼成 client.js
├── scripts/harness.mjs      # 假 ctx 断言：挂载/卸载无泄漏
├── scripts/restart-harness.mjs  # 假 req/res 断言：/restart 的安全边界
├── locale/{zh,en}.json
├── icon.svg
└── cordis.patch.yml
```

`client.js` 由 `scripts/build.mjs` 生成：它剥掉每个 raw 文件的
`window.__ModuleLoader__.load({ id, factory })` 外壳，把 **factory 主体逐字**放进一个
`(function (require) { … })(require)` IIFE，因此八个功能的代码零改动。

重新构建：

```powershell
$node = 'C:\Users\11919\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts\build.mjs
& $node --check client.js
& $node scripts\harness.mjs
& $node scripts\restart-harness.mjs
```

## 自测结果（假 ctx + 假 module loader + 假 req/res）

```
after apply   effects=14 slots=8 styles=5 menus=1 fibers=8
round 1/2/3   off: effects=13 slots=7   on: effects=14 slots=8     ← 三轮无漂移
all off       mounted=0 slots=1（只剩设置页本身）menus=0
all on        mounted=8 slots=8 effects=14
PASS: mount/unmount clean over 3 rounds, all-off leaves nothing, all-on restores

restart-harness: 30 passed, 0 failed
  · 桌面端 GET 报告 desktop:true 与真实 exe；无桌面时 desktop:false 并说明原因
  · 跨站 Origin / 非 loopback Host / 无 Origin 的 POST 全部 403
  · 找不到 exe 时 409，且**没有启动任何 helper**
  · helper 脚本核对父进程镜像、读不到镜像就拒绝、镜像不匹配就拒绝、
    应用没停下就不启动第二个实例、清掉 ELECTRON_RUN_AS_NODE
  · 真跑一次 helper：面对不匹配的 pid 确实拒绝动手，且从未 relaunch
```

## 与旧插件的并存

六个旧插件**未移除**。它们的 Loader 行仍在 profile 里，会与本套件重复挂同一批功能
（例如两个主题按钮）。确认套件正常后，在「插件」页把旧的六行关掉或卸载即可；
旧目录留在磁盘上作为回滚点。

控制台里可用：

```js
__dshPluginSuite.enabled()   // 当前开关
__dshPluginSuite.mounted()   // 当前挂着的功能
__dshPluginSuite.set('turn-credits', false)
__dshPluginSuite.setAll(true)
__dshPluginSuite.reload()    // 重新拉 Host 文档

__dshRefreshRestart.probe()  // { desktop, exe, routeMissing } — 重启当前是否可用、会重启哪个 exe
__dshRefreshRestart.close()  // 关掉弹出的菜单
```
