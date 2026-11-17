# 每轮花费（积分 / 金额）

在每一轮回复的动作行里，紧挨着 DSH 自己的「用量 54.6M tok」读数，显示**这一轮实际花掉的钱**，按会话所用线路决定单位：

| 会话所用线路 | 显示 | 余额从哪来 |
|---|---|---|
| WorkBuddy（国内版 / 国际版） | `WorkBuddy · 0.42 积分` | `dsh-connect-workbuddy` 的 `/plugins/dsh-connect-workbuddy/account-credits` |
| DeepSeek 账号登录（`deepseek-account`） | `DeepSeek · ¥0.078` | 本机账号服务 `ctx.deepseekAccount.getBalance`（与「账号与余额」页同一个来源） |
| DeepSeek API Key（`deepseek-official`） | `DeepSeek · ¥0.012` | DeepSeek 文档中的 `GET https://api.deepseek.com/user/balance`，用同一把 Key |

用其它线路（route.one、pi-ai 自定义 provider 等）的会话**整行不出现**。

## 它怎么知道花了多少

这些线路都不把「这一笔扣了多少」交给 DSH：WorkBuddy 适配器在探针路径读到 `usage.credit` 就丢了，DSH 自己的 `TokenUsage` 只有 token。所以本插件不估算，而是**余额差实测**：

1. 每轮开始时（`turn/start`，模型还没被调用）读一次对应余额；
2. 这一轮结束后再读一次，两次的差就是这一轮的扣费。

读余额是只读且免费的，只花时间、不花额度。

## 两种结算节奏

- **WorkBuddy**：约 1 秒内结算完，`turn/end` 后 1.2 秒读一次即可。
- **DeepSeek**：平台钱包是**批量结算**，实测同一轮在 1.2 秒后读到差值为 0，15 秒后才变成 `¥0.078052`。所以 CNY 线路会在 `turn/end` 后按 1.2s / 15s / 45s / 90s / 180s 依次重读，**第一次读到变动就定下这一轮的数字**并停止。

前端对应地会重试约 4 分钟；数字晚到时行会自动补上，不需要刷新。

## 什么时候显示「—」

账号切换、并发请求、读余额失败，或这一轮确实没有可比的余额变动（免费模型 / 未结算）。这些都属于「没测到」：不写数字，只画 —，也绝不写 0。

## 代价

- 每轮两次余额查询（CNY 线路最多 5 次，读到变动即停）；
- 一轮结束后多等约 1.2 秒（CNY 可能要几十秒才落数）；
- 首 token 不受影响：第一次读是后台进行的，不阻塞模型流。

## 数据落在哪

`%USERPROFILE%\.dsh\turn-spend.json`（或 `DSH_HOME` 下同名文件），只存会话 → 单位 → 轮次 → 金额，以及哪个 assistant 消息属于哪一轮。上限：200 个会话、每会话 300 轮。

## 已知限制

同一时间从另一个会话或子代理花的钱，如果落在同一对读数之间，会被算到这一轮头上——余额差法的固有限制，也是「显示 —」规则存在的原因。
