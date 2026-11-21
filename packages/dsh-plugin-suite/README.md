# 小插件套件（dsh-plugin-suite）

把九个自研小功能装进一个插件包，并在「设置 → 小插件」里逐个开关。开关即时生效，不需要重启。

## 九个功能

| 功能 | 做什么 | 关掉之后 |
|---|---|---|
| 文件右键复制 | 对话里的文件右键可复制路径 / 相对路径 / 内容 / 文件本体 | 右键菜单里那几项消失，Host 的两条路由同时卸载 |
| 深浅色切换 | 侧栏底部一个按钮切换明暗，浏览器与桌面客户端一致 | 按钮消失 |
| 每轮花费 | 每条回复的操作行显示这一轮实际花掉的积分或人民币 | 药丸消失，Host 停止记账 |
| 隐藏分支按钮 | 去掉助手消息上的「分支到新会话」 | 按钮回来 |
| 记住取消固定的面板 | 重启后仍保持你取消固定的侧栏面板 | 重启后全部回到固定状态 |
| 右侧栏默认展开 | 会话出现时自动展开右栏（窄于 768px 不展开） | 新会话恢复默认收起 |
| 归档筛选一键切换 | 「工作区」标题行搜索图标左侧一个按钮，一键在「隐藏已归档」和「仅显示已归档」间切换 | 按钮消失，归档筛选回到内置菜单 |
| 审批界面中文 | 审批卡标题显示中文：DSH 自带措辞离线词典翻译，剩余英文走内置翻译服务，工具名 / 路径 / JSON / 沙箱模式保留原文；跟随界面语言，翻译失败保留原文 | 卡片回到原样（官方英文/中文模板），翻译与状态路由同时卸载 |
| 重启按钮 | 侧栏底部一个按钮，点两下结束 Host 进程、由容器重启策略拉回，页面自动刷新 | 按钮消失，两条路由同时卸载 |

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
    "archive-filter-toggle": true,
    "approval-zh": true,
    "restart-button": true
  }
}
```

Host 通过 `/plugins/plugin-suite/state` 提供读写（GET 读、POST 写单个或 `{ "all": true|false }` 写全部）。
浏览器侧另存一份 localStorage 镜像（`dsh.plugin-suite.v1`），
只为刷新后的第一帧不闪；权威永远是上面那个文件。

### 路由信任口径（1.1.3 起）

两条通路都算可信：

1. **回环 Host**——桌面客户端从 `127.0.0.1:xxxxx` 打开时走这条；
2. **DSH 自己的浏览器信任栅栏**——`ctx.connection.requestRejection(request)` 返回 `undefined`
   才放行，和每个 `/api` 调用过的是同一道检查，因此监听绑定 IP 与 `--trusted-host`
   都算数。

第二条是为 Docker 部署加的：端口映射之后浏览器发的是 `Host: 192.168.0.103:3080`，
而 socket 的 `localAddress` 是容器网桥（如 `172.19.0.2`），两者永不相等，
旧版「只认回环」的规则会把每次开关保存都拒成 `403 host-not-trusted`，
设置页于是只能读到 localStorage 镜像、点开关没反应。

`features/host/*.js` 仍然保留原有守卫（新增的 `approval-zh.js` / `restart-button.js` 直接按套件的信任口径写），它们自带的回环守卫由 `index.js`
包一层：栅栏已放行的请求会拿到一份 `socket.localAddress` 等于 Host 主机名的请求视图，
被拒的请求保持原样交给它们自己拒。


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
├── index.js                 # Host 半边：开关文件 + /state 路由 + 四个 Host 功能
├── client.js                # 构建产物（勿手改）
├── features/
│   ├── client/*.raw.js      # 九个原始 client 源文件，逐字节保留
│   └── host/*.js            # 四个 host 源文件（两个逐字节保留 + 两个套件内实现）
├── scripts/build.mjs        # 把 raw 拼成 client.js
├── scripts/harness.mjs      # 假 ctx 断言：挂载/卸载无泄漏
├── scripts/host-harness.mjs # 假 ctx 断言：被占住的路由会被接管
├── scripts/trust-harness.mjs# 假 req/res 断言：回环 + 信任栅栏两条通路
├── locale/{zh,en}.json
├── icon.svg
└── cordis.patch.yml
```

`client.js` 由 `scripts/build.mjs` 生成：它剥掉每个 raw 文件的
`window.__ModuleLoader__.load({ id, factory })` 外壳，把 **factory 主体逐字**放进一个
`(function (require) { … })(require)` IIFE，因此九个功能的代码零改动。

重新构建：

```powershell
$node = 'C:\Users\11919\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
& $node scripts\build.mjs
& $node --check client.js
& $node scripts\harness.mjs
& $node scripts\host-harness.mjs
& $node scripts\archive-harness.mjs
& $node scripts\pins-harness.mjs
& $node scripts\trust-harness.mjs
```

## 自测结果（假 ctx + 假 module loader + 假 req/res）

```
after apply   effects=13 slots=7 styles=5 menus=1 fibers=9
round 1/2/3   off: effects=12 slots=6   on: effects=13 slots=7     ← 三轮无漂移
all off       mounted=0 slots=1（只剩设置页本身）menus=0
all on        mounted=9 slots=7 effects=13
PASS: mount/unmount clean over 3 rounds, all-off leaves nothing, all-on restores

host-harness: PASS 被 standalone 插件占住的路由在它关闭后被接管，无需重启
archive-harness: 19/19 checks passed
pins-harness: 9/9 checks
trust-harness: 28/28 trust checks（回环放行、栅栏放行/拒绝/401、包过的原样守卫）
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
