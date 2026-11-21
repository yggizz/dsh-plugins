# dsh-approval-zh — 审批界面中文

把 DSH 审批卡（工具请求越权 / 需要用户确认的调用）的标题翻成中文，同时保留专有名词与“键值”原文。

## 它解决什么

审批卡的文字来自两处：

- **DSH 自带的固定措辞**，例如
  `允许本次操作使用 danger-full-access 权限：plugin_manager {...}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.`
  —— 前半句已由 DSH 本地化，后半句 justification 仍是英文；
- **请求方传入的 `reason`/`displayReason`**，只有英文时在中文界面里原样显示。

插件接管审批卡标题并输出中文，卡片本体（按钮、键盘操作、工具调用详情）仍由 DSH 官方组件渲染。

## 翻译策略（三级，按顺序）

1. **模板**：识别 DSH 自己的固定句式（sandbox 升级、auto-review 拒绝），换成中文框架，只把尾部说明交给后续步骤。
2. **词典**：DSH 内置的英文句子离线精确翻译，不走网络、措辞稳定。
3. **机翻兜底**：仍是英文的句子通过 Host 的 `translator` 服务翻译（默认匿名 Bing 端点）；若返回的译文破坏了占位符，再用 Google 端点重试一次，仍失败则该句保留原文。

翻译前会先把**标识符类文本**替换成 `<0>` 占位符，翻译后原样还原，因此下列内容不会被机翻改写：

- 反引号/代码块、JSON 片段
- URL、文件路径（`/home/node/.dsh/...`、`~/.dsh`）
- CLI 参数（`--profile`）、snake_case 名称（`plugin_manager`、`memory_search`）
- kebab-case 值（`danger-full-access`、`workspace-write`）、带扩展名的文件名

占位符若在返回文本里丢失，该句保留原文，不显示被破坏的译文。

## 生效条件

- **跟随界面语言**：只有当前界面语言是中文（`zh`、`zh-CN`、`zh-Hans` 等）时才翻译；英文界面行为与官方审批卡一致。
- 只接管工具审批（`pendingInteraction.kind === 'approval'`），提问类卡片不动。
- 翻译失败、超时或返回异常时，卡片显示原文，审批照常可用——翻译是装饰，不参与任何审批决策，也不改审计记录里的 `reason`。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `machineTranslate` | `true` | 是否允许剩余英文走机翻；`false` 时只用模板 + 词典，完全离线 |
| `provider` | `''` | 留空沿用 translator 插件自己的默认（当前为 `bing`）；可填 `google` |
| `fallbackProvider` | `'google'` | 首选端点返回的译文占位符损坏时，用第二个端点重试一次；留空关闭重试 |
| `timeoutMs` | `5000` | 单条标题的翻译超时，超时保留原文 |
| `maxChars` | `4000` | 超过该长度的标题不翻译（translator 单请求上限） |
| `cacheSize` | `300` | 进程内缓存条数；浏览器侧另有一份 `sessionStorage` 缓存 |

## 隐私

开启机翻时，**审批标题文本**会发送给所选匿名翻译端点（默认 `edge.microsoft.com`，重试时 `translate.googleapis.com`）。含敏感内容的部署可把 `machineTranslate` 设为 `false`，只保留离线词典与模板翻译。

## 接口（Host）

- `POST /api/dsh-approval-zh/translate`，body `{"text": "..."}`，仅接受同源 JSON 请求，返回
  `{ "ok": true, "text": "...", "changed": true, "source": "dictionary+machine" }`。
- `GET /api/dsh-approval-zh/status` 返回是否启用机翻、translator 是否可用、缓存条数。

## 已知限制

- 机翻质量取决于匿名端点，长句偶有口语化；审计与决策不受影响。
- 只处理审批标题；工具调用的参数详情按原样渲染（参数本来就是键值，不应翻译）。
- 需要 profile 内存在 `translator` 服务（DSH 的 CoT 翻译 bundle 已带）。缺失时自动降级为离线词典。
