# dsh-plugins

DeepSeek Harness（`dsh`）插件合集。每个目录是一个可独立安装的 bundle，`package.json` 里声明了 `dsh.bundle`，因此可以直接 `dsh plugin add`。

> 这里只放插件本身。安装会运行插件代码，且插件代码不受工具审批沙箱约束——请先读源码。

## 插件

| 包 | 做什么 | 分类 |
|---|---|---|
| [`@yggizz/dsh-theme-toggle`](packages/theme-toggle) | 标题栏里加一个深浅色切换按钮 | 主题与外观 |
| [`@yggizz/dsh-sync-panel`](packages/dsh-sync-panel) | 设置页里一键打包/还原插件与 profile 配置，用于换电脑迁移 | 开发与运行时 |
| [`@yggizz/dsh-artifact-copy`](packages/dsh-artifact-copy) | 右键文件，复制相对路径、文本内容，或文件本体（原生剪贴板文件） | UI 增强 |
| [`@yggizz/dsh-sidebar-pins`](packages/sidebar-pins) | 记住你收起了哪些左侧栏面板入口，重启照样生效 | UI 增强 |
| [`@yggizz/dsh-workbuddy-turn-credits`](packages/dsh-workbuddy-turn-credits) | 在每轮回复里显示这一轮实际花了多少（credits 或人民币） | 用量与计费 |

## 安装

单装某一个（把 `#<commit>` 换成你想固定的提交，或直接用 `main`）：

```sh
dsh plugin --profile <profile> add git+https://github.com/yggizz/dsh-plugins.git#<commit>&path:/packages/theme-toggle
```

从本地 checkout 安装：

```sh
dsh plugin --profile <profile> add ./packages/theme-toggle
```

`path:` 前面的 `&` 是 dsh 的写法，用来指向 monorepo 里的子目录。

## 卸载

```sh
dsh plugin --profile <profile> remove @yggizz/dsh-theme-toggle
```

## 要求

- DSH `0.2.1-rc.1` 以上、`0.3.0` 以下的 0.2.x 版本（各包的 `engines.dsh` 里写明）。
- 无需构建步骤：插件直接是原生 ESM / 浏览器模块，仓库里没有 `prepare` 脚本，从 git 安装不需要 `allowBuilds` 授权。

## 许可

MIT，见 [LICENSE](LICENSE)。
