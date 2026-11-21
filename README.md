# dsh-plugins

DeepSeek Harness（`dsh`）插件合集。每个目录是一个可独立安装的 bundle，`package.json` 里声明了 `dsh.bundle`，因此可以直接 `dsh plugin add`。

> 这里只放插件本身。安装会运行插件代码，且插件代码不受工具审批沙箱约束——请先读源码。

## 插件

| 包 | 做什么 | 分类 |
|---|---|---|
| [`dsh-plugin-suite`](packages/dsh-plugin-suite) | 七个自研小功能合成一个包，设置页里逐个开关、即时生效：文件右键复制、深浅色切换、每轮花费、隐藏分支按钮、记住取消固定的面板、右侧栏默认展开、归档筛选一键切换 | UI 增强 |
| [`@yggizz/dsh-sync-panel`](packages/dsh-sync-panel) | 设置页里一键打包/还原插件与 profile 配置，用于换电脑迁移 | 开发与运行时 |
| [`dsh-restart-button`](packages/dsh-restart-button) | 侧栏底部一个「重启」按钮，点两下真正重启这个 DSH 容器（OpenCLI `docker restart`，未配 token 时用进程退出 + 容器重启策略），页面自动刷新 | UI 增强 |
| [`dsh-approval-zh`](packages/dsh-approval-zh) | 审批卡标题显示中文：DSH 自带措辞离线词典翻译，剩余英文交给 Host 翻译服务，工具名/路径/JSON/命令与沙箱模式保留原文；跟随界面语言，翻译失败保留原文，不影响审批决策 | UI 增强 |

早先的 `theme-toggle`、`dsh-artifact-copy`、`sidebar-pins`、`dsh-workbuddy-turn-credits` 四个独立包已并入 `dsh-plugin-suite`，从 `6da0def` 起不再单独发布（需要旧包可 `git checkout 3ffb8f7 -- packages/<名字>` 取回）。

## 插件市场

这个仓库自带一份 format-1 索引，可以直接加进 DSH 的 **插件 → 发现 → 索引源**：

```
https://yggizz.github.io/dsh-plugins/index.json
```

同一份文件在 `https://cdn.jsdelivr.net/gh/yggizz/dsh-plugins@main/index.json` 也有一份，GitHub Pages 慢的时候换这个。

## 安装

单装某一个（把 `#<commit>` 换成你想固定的提交，或直接用 `main`）：

```sh
dsh plugin --profile <profile> add git+https://github.com/yggizz/dsh-plugins.git#<commit>&path:/packages/dsh-plugin-suite
```

从本地 checkout 安装：

```sh
dsh plugin --profile <profile> add ./packages/dsh-plugin-suite
```

`path:` 前面的 `&` 是 dsh 的写法，用来指向 monorepo 里的子目录。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-plugin-suite
```

## 要求

- DSH `0.2.1-rc.1` 以上、`0.3.0` 以下的 0.2.x 版本（各包的 `engines.dsh` 里写明）。
- 无需构建步骤：插件直接是原生 ESM / 浏览器模块，仓库里没有 `prepare` 脚本，从 git 安装不需要 `allowBuilds` 授权。

## 许可

MIT，见 [LICENSE](LICENSE)。
