# dsh-sidebar-pins

记住你在左侧栏取消了哪些面板入口，下次启动照样是这些，不会被重新塞回一排按钮。

## 它做什么

DSH 左侧栏的面板入口（对话、文件、终端、插件等）每次启动都会回到默认全显示。你手动收起来的那些，重启就没了。

这个插件把「哪些被收起」记进 profile，每次启动重新应用同一个选择。

- 不新增任何界面元素：它只改左侧栏本来的显示状态。
- 不联网，不读写工作区文件，只写 profile 里自己那一段配置。
- 关掉插件后，左侧栏回到 DSH 默认行为，之前的记录不再生效（但不会删掉）。

## 安装

```sh
dsh plugin --profile <profile> add git+https://github.com/yggizz/dsh-plugins.git#<commit>&path:/packages/sidebar-pins
```

或者从本地 checkout：

```sh
dsh plugin --profile <profile> add ./packages/sidebar-pins
```

装完重启 DSH 生效。

## 已知限制

- 它记的是「取消过哪些」，不是「钉住哪些」。如果你想要的是面板排序、分组、搜索、拖拽这类更完整的侧栏管理，这个插件不提供。
- 面板入口集合由 DSH 版本决定；升级 DSH 后如果新增了入口，新入口按默认显示，不在记录里。

## 许可

MIT
