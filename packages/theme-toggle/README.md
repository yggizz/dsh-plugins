# dsh-theme-toggle

一个 DeepSeek Harness 插件：在窗口标题栏（侧栏 DeepSeek 标志右侧）放一个按钮，点一下就在浅色和深色之间切换。

插件本身不保存任何状态，也不联网。当前用哪种外观由 DSH 自己的外观设置决定；当外观是「跟随系统」时，第一次点击会把外观固定成与当前相反的那一种（这是 DSH 主题服务的既有行为，插件只是调用它）。

## 安装

```sh
dsh plugin --profile <profile> add git+https://github.com/yggizz/dsh-plugins.git#<commit>&path:/packages/theme-toggle
```

或者在本仓库根目录：

```sh
dsh plugin --profile <profile> add ./packages/theme-toggle
```

装完重启 DSH，标题栏右上角就会出现这个按钮。

## 它做什么

- 按钮位置在 Windows 标题栏的可拖拽区域里，插件自己用 `-webkit-app-region: no-drag` 把它排除在拖拽区外，所以点它不会变成拖窗口。
- 图标随当前外观变化：深色时显示太阳（点了变浅色），浅色时显示月亮。
- 提示文字跟随 DSH 界面语言：中文界面显示「切换到浅色 / 切换到深色」，其它语言显示英文。
- 关闭插件后，标题栏的这个按钮消失，外观仍然可以在 DSH 设置里改。

## 已知限制

- 只在 DSH Web / Desktop 的窗口标题栏布局下有意义。浏览器里没有标题栏，按钮会贴在侧栏顶部同样的位置。
- 不提供「跟随系统」这个状态的选择——需要的话用 DSH 自己的外观设置。

## 文件

| 文件 | 作用 |
|---|---|
| `client.js` | 客户端半：渲染按钮、订阅主题与语言变化 |
| `index.js` | 宿主半：空实现，只为了让这个包成为可安装的 bundle |
| `cordis.patch.yml` | 插入插件行 |
| `locale/*.json` | 插件页显示用的标题与简介 |

## 许可

MIT
