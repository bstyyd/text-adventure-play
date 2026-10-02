# API 接入规格：硅基流动 / DeepSeek 官方 / Google AI Gemma

核对日期：2026-09-27。以下属于文档核对，不是使用真实密钥完成的连通性测试。账号权限、额度、区域和模型变更以实际连接测试及届时官方文档为准。

## 1. 三个独立预设

| providerId | 通信方式 | Base URL / endpoint | 模型选择 |
|---|---|---|---|
| `siliconflow` | Chat Completions | `https://api.siliconflow.cn/v1`；`POST /chat/completions` | 从模型列表选择完整 ID，也允许手填；不能套用 DeepSeek 官方别名 |
| `deepseek` | Chat Completions | `https://api.deepseek.com`；`POST /chat/completions` | 本次官方首页列出的 `deepseek-flash`、`deepseek-v4-pro`；允许更新和手填 |
| `google-gemma` | Gemini Developer API 原生 | `https://generativelanguage.googleapis.com/v1beta`；`POST /models/{model}:generateContent` | 预设 `gemma-4-26b-a4b-it` |

硅基流动的 Chat Completions 与认证形式依据 [S1]；DeepSeek 的 endpoint 与当前名称依据 [S3]；Google 官方 Gemma 托管页明确列出 `gemma-4-26b-a4b-it`，并给出 `generateContent` 和 `@google/genai` 示例，依据 [S5]。详细链接在 `SOURCES.md`。

Google 的产品入口是 Google AI Studio / Gemini Developer API，但实际选择的是 **Gemma 4 26B A4B**，不是 Gemini。不要改成 Gemini Flash，不要使用 `google/gemma-...` 这类其他平台的模型名字。

本包不固定硅基流动具体模型，因为用户只指定了平台，没有选定该平台模型。设置页应先拉列表，不能自动选择一个昂贵模型替用户消费。

## 2. 认证与模型列表

硅基流动与 DeepSeek 使用 `Authorization: Bearer <key>`。Google 原生 REST 使用 `x-goog-api-key` 请求头，或者官方 SDK 的 `apiKey`；不把 Key 拼进日志可见的 URL。

硅基流动列表：`GET https://api.siliconflow.cn/v1/models?sub_type=chat`，依据 [S2]。保留返回的完整 `id`，不要自行删掉命名空间或 `Pro/` 前缀。

Google 列表：`GET https://generativelanguage.googleapis.com/v1beta/models`，处理 `nextPageToken`，并检查生成方法，依据 [S10]。列表可见只说明可查询，仍需实际文本请求验证当前账号。

DeepSeek 至少保留官方当前预设和手填模型 ID。模型列表刷新只在实现时找到并确认官方对应 API 后启用；不能把一个未验证的猜测接口当作必需依赖。预设可通过有版本的配置更新。

所有 endpoint 拼接要规范化，避免 `/v1/v1`、重复 `models/`、丢失路径或把完整 `/chat/completions` 再拼一次。界面保存标准化后的 Base URL，内部由 adapter 拼资源路径。

## 3. Provider 接口

实现一个服务端接口，最小职责为：

```ts
// 规格示意：实现时补全所有引用类型，并用 Zod 校验外部数据。
interface LLMProvider {
  id: 'siliconflow' | 'deepseek' | 'google-gemma' | 'mock';
  listModels(config: PublicProviderConfig, secret: SecretRef): Promise<ModelInfo[]>;
  testConnection(request: ConnectionTestRequest): Promise<ConnectionTestResult>;
  generateText(request: TextRequest): Promise<TextResult>;
  streamText(request: TextRequest): AsyncIterable<NormalizedStreamEvent>;
  extractJson(request: ExtractionRequest): Promise<ExtractionResult>;
}
```

`listModels` 不支持时返回明确的能力状态，不伪造返回值。所有方法接收 AbortSignal 或等价取消机制。传输统一归一化文本、结束原因、用量、请求追踪 ID 和错误，不把原始 SDK 类型泄漏到游戏规则层。

能力对象示意：

```ts
type Capability = 'supported' | 'unsupported' | 'unknown';
interface ModelCapabilities {
  systemInstruction: Capability;
  streaming: Capability;
  jsonObject: Capability;
  jsonSchema: Capability;
  thinkingControl: Capability;
  acceptedParameters: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  source: 'official-docs' | 'probe' | 'manual';
  checkedAt: string;
}
```

能力以供应商、endpoint、模型和验证时间为键。模型列表不一定能提供所有能力，不得假造。普通文本能跑通，不等于 JSON Schema、所有采样参数或多轮协议也都跑通。

## 4. 正文优先与结构化降级

正文生成使用文本，不向玩家展示 JSON。记忆整理的能力路径为：

```text
已确认支持的原生 JSON Schema
  -> 已确认支持的 JSON Object
  -> 普通文本中明确要求单个 JSON 对象
  -> 本地解析与 Zod 校验
  -> 至多一次格式修复
  -> 仍失败：保留未提交草稿，不更新本局事实
```

降级只改变输出协议，不悄悄换供应商或模型。对未知能力可以直接走保守文本模式；探测需要明确小额测试，不在每轮重新探测。

硅基流动文档提供 `response_format` 的 `json_schema` 和 `json_object`，但具体模型支持情况仍需区别，依据 [S1]。

DeepSeek 的 JSON Output 要设置 `response_format: {"type":"json_object"}`，并在提示中明确要求 JSON 与给出结构；文档还提醒可能出现空内容和截断问题，依据 [S4]。因此不能仅有一次 `JSON.parse` 而无失败恢复。

Google 的 Gemma 专页确认该托管模型与系统指令等示例，但本次没有从该专页获得严格 JSON Schema 支持的明确依据。**不据此断言它不支持，也不把 Gemini 模型的功能表直接套到 Gemma。** Gemma 默认可用纯文本提取 JSON 的通用路径；原生 schema 和流式能力另行验证。结构合法也不等于故事事实正确。

## 5. 消息和参数映射

| 内部语义 | 硅基流动/DeepSeek | Google 原生 |
|---|---|---|
| 永久叙事规则 | system 消息 | `config.systemInstruction` |
| 玩家输入 | user 消息 | user content |
| 已采用正文 | assistant 消息 | model content |
| 输出文本 | choices/message/content 或流式 delta | response text / 文本 parts |

Google Gemma 专页提供系统指令和多轮示例，依据 [S5]。不能把 OpenAI `messages` 原样发送给 Google，也不能把 Google `model` role 原样发送给 Chat Completions。

采样、思考和长度字段按 adapter 映射。硅基流动的 `enable_thinking` 等参数是模型相关能力；DeepSeek 的 `thinking`/`reasoning_effort` 与之不同；Google 的 `thinkingConfig` 也不同。默认先省略未经确认的可选参数，不为了“设置统一”把不支持的字段全部发出去。

若实现 Google Gemma 思考开关，只使用该模型官方说明或实测支持的取值；当前专页说明启用/关闭对应 high/minimal，依据 [S5]。不沿用其他模型的任意 thinkingBudget 数值。

服务器只持久化正式输出、归一化用量和必要错误元数据。不显示、记录或注入 `reasoning_content` / thought 等推理内容作为人物心理或记忆。

## 6. 流式与错误

硅基流动/DeepSeek 的流式必须正确处理任意网络分片、空 delta、结束标识、usage 和错误帧。Google 优先使用官方 SDK 的流式方法（确认当前 Gemma 支持后）；不可用时以非流式响应工作，并在界面显示等待状态，不假装逐字流式。

设置独立的连接超时、首字等待、整次请求超时；允许取消。429/短暂 5xx 可有限退避重试，尊重 Retry-After；401/403 不自动反复重试；404 告知模型或 endpoint 可能无效。400 参数不支持要更新能力状态并给出可理解错误，不能无限删参数重试。

最多一次正文自动网络重试是建议上限，超过后由用户选择；任何重试可能产生额外费用，UI 记录实际请求次数。请求中断不能证明上游未计费。

空输出、长度截断、内容阻止或模型拒绝都视为非正式结果，不拼接成小说台词，也不为了绕过服务限制自动转发到另一供应商。自动跨供应商 fallback 默认关闭。

## 7. 设置页与连接测试

设置页保存多个非敏感 profile，允许选择正文模型和可选整理模型，默认同一个。一次请求开始后固定 profile 版本；生成中改变设置不影响已经在途的请求，只作用于下一轮。

“测试连接”发一个不包含真实剧情的小请求并显示模型、延迟、实际返回、失败类型；“测试结构化能力”单独显式触发。不把失败测试写入游戏历史。

没有真实 Key 时运行 Mock 契约测试；有 Key 时只在明确同意后运行低量 smoke tests。文档列出可调用名称不保证该账号权限、免费额度或创作质量，也不等于已经联调完成。
