# dsh-theme-toggle

一个 DeepSeek Harness 插件：一键在浅色和深色之间切换，按钮放在两处最顺手的位置。

- **Windows / macOS 桌面客户端**：窗口标题栏里，侧栏标志右侧。
- **浏览器（Web）**：左侧栏底部。侧栏展开时是一整行带文字，收起成 56px 图标条时变成居中的图标，跟着侧栏走，不用绝对坐标。

插件本身不保存任何状态，也不联网。当前用哪种外观由 DSH 自己的外观设置决定；当外观是「跟随系统」时，第一次点击会把外观固定成与当前相反的那一种（这是 DSH 主题服务的既有行为，插件只是调用它）。

## 安装

```sh
dsh plugin --profile <profile> add git+https://github.com/yggizz/dsh-plugins.git#<commit>&path:/packages/theme-toggle
```

或者在本仓库根目录：

```sh
dsh plugin --profile <profile> add ./packages/theme-toggle
```

装完重启 DSH 就能看到按钮。

## 它做什么

- 两个位置同时注册，靠 `html[data-windows-titlebar]` 互斥显示：桌面客户端只画标题栏那个，Web 只画侧栏那个。preload 标记什么时候写入都不会出现两个按钮或零个按钮。
- 标题栏那个按钮自己用 `-webkit-app-region: no-drag` 排除在拖拽区外，点它不会变成拖窗口。
- 侧栏那个按钮没有任何绝对坐标：展开时占满整行（`width:100%`），收起时是 36px 图标，位置由 DSH 自己的侧栏布局决定。
- 图标随当前外观变化：深色时显示太阳（点了变浅色），浅色时显示月亮。
- 提示文字跟随 DSH 界面语言：中文界面显示「切换到浅色 / 切换到深色」，其它语言显示英文。
- 关闭插件后两处按钮都消失，外观仍然可以在 DSH 设置里改。

## 已知限制

- 侧栏收起成 56px 图标条时只显示图标，没有文字（宽度不够）。
- 不提供「跟随系统」这个状态的选择——需要的话用 DSH 自己的外观设置。

## 文件

| 文件 | 作用 |
|---|---|
| `client.js` | 客户端半：渲染两处按钮、订阅主题与语言变化 |
| `index.js` | 宿主半：空实现，只为了让这个包成为可安装的 bundle |
| `cordis.patch.yml` | 插入插件行 |
| `locale/*.json` | 插件页显示用的标题与简介 |

## 许可

MIT
