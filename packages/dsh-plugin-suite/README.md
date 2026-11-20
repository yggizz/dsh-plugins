# 小插件套件（dsh-plugin-suite）

把七个自研小功能装进一个插件包，并在「设置 → 小插件」里逐个开关。开关即时生效，不需要重启。

## 七个功能

| 功能 | 做什么 | 关掉之后 |
|---|---|---|
| 文件右键复制 | 对话里的文件右键可复制路径 / 相对路径 / 内容 / 文件本体 | 右键菜单里那几项消失，Host 的两条路由同时卸载 |
| 深浅色切换 | 标题栏（Windows）或侧栏底部一个按钮切换明暗 | 按钮消失 |
| 每轮花费 | 每条回复的操作行显示这一轮实际花掉的积分或人民币 | 药丸消失，Host 停止记账 |
| 隐藏分支按钮 | 去掉助手消息上的「分支到新会话」 | 按钮回来 |
| 记住取消固定的面板 | 重启后仍保持你取消固定的侧栏面板 | 重启后全部回到固定状态 |
| 右侧栏默认展开 | 会话出现时自动展开右栏（窄于 768px 不展开） | 新会话恢复默认收起 |
| 归档筛选一键切换 | 「工作区」标题行搜索图标左侧一个按钮，一键在「隐藏已归档」和「仅显示已归档」间切换 | 按钮消失，归档筛选回到内置菜单 |

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
├── index.js                 # Host 半边：开关文件 + /state 路由 + 两个 Host 功能
├── client.js                # 构建产物（勿手改）
├── features/
│   ├── client/*.raw.js      # 七个原始 client 源文件，逐字节保留
│   └── host/*.js            # 两个原始 host 源文件，逐字节保留
├── scripts/build.mjs        # 把 raw 拼成 client.js
├── scripts/harness.mjs      # 假 ctx 断言：挂载/卸载无泄漏
├── locale/{zh,en}.json
├── icon.svg
└── cordis.patch.yml
```

`client.js` 由 `scripts/build.mjs` 生成：它剥掉每个 raw 文件的
`window.__ModuleLoader__.load({ id, factory })` 外壳，把 **factory 主体逐字**放进一个
`(function (require) { … })(require)` IIFE，因此七个功能的代码零改动。

重新构建：

```powershell
$node = 'C:\Users\11919\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts\build.mjs
& $node --check client.js
& $node scripts\harness.mjs
& $node scripts\host-harness.mjs
& $node scripts\archive-harness.mjs
& $node scripts\pins-harness.mjs
```

## 自测结果（假 ctx + 假 module loader + 假 req/res）

```
after apply   effects=11 slots=5 styles=4 menus=1 fibers=7
round 1/2/3   off: effects=10 slots=4   on: effects=11 slots=5     ← 三轮无漂移
all off       mounted=0 slots=1（只剩设置页本身）menus=0
all on        mounted=7 slots=5 effects=11
PASS: mount/unmount clean over 3 rounds, all-off leaves nothing, all-on restores

host-harness: PASS 被 standalone 插件占住的路由在它关闭后被接管，无需重启
archive-harness: 19/19 checks passed
pins-harness: 9/9 checks
```

## 与旧插件的并存

早先的六个独立插件已从 profile 移除，现在只有本套件在挂这些功能。
旧目录仍留在磁盘上（`default-workspace\plugins\` 下的 `dsh-hide-branch`、`sidebar-pins` 等）作为回滚点。

控制台里可用：

```js
__dshPluginSuite.enabled()   // 当前开关
__dshPluginSuite.mounted()   // 当前挂着的功能
__dshPluginSuite.set('turn-credits', false)
__dshPluginSuite.setAll(true)
__dshPluginSuite.reload()    // 重新拉 Host 文档
```
