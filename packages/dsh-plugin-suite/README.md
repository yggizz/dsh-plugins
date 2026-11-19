# 小插件套件（dsh-plugin-suite）

把六个自研小功能装进一个插件包，并在「设置 → 小插件」里逐个开关。开关即时生效，不需要重启。

## 六个功能

| 功能 | 做什么 | 关掉之后 |
|---|---|---|
| 文件右键复制 | 对话里的文件右键可复制路径 / 相对路径 / 内容 / 文件本体 | 右键菜单里那几项消失，Host 的两条路由同时卸载 |
| 深浅色切换 | 标题栏（Windows）或侧栏底部一个按钮切换明暗 | 按钮消失 |
| 每轮花费 | 每条回复的操作行显示这一轮实际花掉的积分或人民币 | 药丸消失，Host 停止记账 |
| 隐藏分支按钮 | 去掉助手消息上的「分支到新会话」 | 按钮回来 |
| 记住取消固定的面板 | 重启后仍保持你取消固定的侧栏面板 | 重启后全部回到固定状态 |
| 右侧栏默认展开 | 会话出现时自动展开右栏（窄于 768px 不展开） | 新会话恢复默认收起 |

## 开关存在哪

`~/.dsh/plugin-suite.json`（尊重 `DSH_HOME`）：

```json
{
  "version": 1,
  "features": {
    "artifact-copy": true,
    "theme-toggle": true,
    "turn-credits": true,
    "hide-branch": true,
    "sidebar-pins": true,
    "rightbar-default-open": true
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
├── index.js                 # Host 半边：开关文件 + /state 路由 + 两个 Host 功能
├── client.js                # 构建产物（勿手改）
├── features/
│   ├── client/*.raw.js      # 六个原始 client 源文件，逐字节保留
│   └── host/*.js            # 两个原始 host 源文件，逐字节保留
├── scripts/build.mjs        # 把 raw 拼成 client.js
├── scripts/harness.mjs      # 假 ctx 断言：挂载/卸载无泄漏
├── locale/{zh,en}.json
├── icon.svg
└── cordis.patch.yml
```

`client.js` 由 `scripts/build.mjs` 生成：它剥掉每个 raw 文件的
`window.__ModuleLoader__.load({ id, factory })` 外壳，把 **factory 主体逐字**放进一个
`(function (require) { … })(require)` IIFE，因此六个功能的代码零改动。

重新构建：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& $env:DSH_NODE_EXECUTABLE scripts\build.mjs
& $env:DSH_NODE_EXECUTABLE --check client.js
& $env:DSH_NODE_EXECUTABLE scripts\harness.mjs
```

## 自测结果（假 ctx + 假 module loader）

```
after apply   effects=10 slots=4 styles=3 menus=1 fibers=6
slots: settings.section, shell.overlay, sidebar.footer.action, conversation.chat.assistant-actions
round 1/2/3   off: effects=9 slots=3   on: effects=10 slots=4     ← 三轮无漂移
all off       mounted=0 slots=1（只剩设置页本身）menus=0
all on        mounted=6 slots=4 effects=10
PASS
```

## 与旧插件的并存

六个旧插件**未移除**。它们的 Loader 行仍在 profile 里，会与本套件重复挂同一批功能
（例如两个主题按钮）。确认套件正常后，在「插件」页把旧的六行关掉或卸载即可；
旧目录留在磁盘上作为回滚点。

## 诊断

控制台里可用：

```js
__dshPluginSuite.enabled()   // 当前开关
__dshPluginSuite.mounted()   // 当前挂着的功能
__dshPluginSuite.set('turn-credits', false)
__dshPluginSuite.setAll(true)
__dshPluginSuite.reload()    // 重新拉 Host 文档
```
