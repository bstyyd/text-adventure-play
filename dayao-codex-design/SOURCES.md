# 官方来源与核对边界

核对日期：2026-09-27。来源只用于技术接入与工程事实；游戏人物、世界观与偏好来自用户设定，不需要现实历史背书。

本包没有真实 API Key，未验证任何账号的权限、区域、额度、费用、延迟或模型实际创作品质。模型名与服务能力可能变化，开发时需重查官方文档，并让应用提供显式连接测试。

## [S1] 硅基流动 Chat Completions

官方文档：`https://docs.siliconflow.cn/docs/api/chat-completions-post`

确认 endpoint、Bearer 认证、文本/流式输出及 response_format 文档。具体模型的能力不能只依据平台字段清单推断；保存完整模型 ID。

## [S2] 硅基流动模型列表

官方文档：`https://docs.siliconflow.cn/docs/api/models-get`

确认模型列表与 chat 类型筛选。模型选择留给用户，不自动代选付费型号。

## [S3] DeepSeek 首次调用

官方文档：`https://api-docs.deepseek.com/`

本次页面列出的 OpenAI 兼容 Base URL 为 `https://api.deepseek.com`，模型名为 `deepseek-flash` 与 `deepseek-v4-pro`。它们是当前预设，不是保证永久有效的常量。

## [S4] DeepSeek JSON Output

官方文档：`https://api-docs.deepseek.com/guides/json_mode/`

文档说明 JSON Object 配置、提示词应明确要求 JSON，以及空内容和输出截断的处理注意事项。有效 JSON 不代表符合应用所有业务规则。

## [S5] Google：通过 Gemini API 使用 Gemma

官方文档：`https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api`

确认托管模型 `gemma-4-26b-a4b-it`，以及原生 generateContent、JavaScript SDK、系统指令、多轮对话与该模型思考开关的示例。

没有据此确认严格 JSON Schema 支持；不能把缺少说明写成确定不支持，也不能把 Gemini 的模型能力直接套到 Gemma。流式和结构化高级能力应按具体托管模型另测。

## [S6] Google API Key 安全

官方文档：`https://ai.google.dev/gemini-api/docs/api-key`

官方建议保护 Key、不提交到版本控制、不在生产客户端暴露，并由后端代理真实 API 请求。本项目采用本机服务发请求，默认会话内保存 Key，允许用户选择环境变量。

## [S7] Next.js Node 与 Edge runtime

官方文档：`https://nextjs.org/docs/app/api-reference/edge`

确认 Node.js 与 Edge 的 API 范围有区别。本项目本地文件与 SQLite 路由指定 Node.js runtime；这不是纯静态或默认无持久磁盘的远程部署方案。

## [S8] SQLite 备份

官方文档：`https://sqlite.org/backup.html`

用于安全数据库备份/快照设计。实现时通过数据库库提供的在线备份功能或合适的受控快照方式保存，不在活跃写入/WAL 情况下只复制主文件。

## [S9] SQLite FTS5 trigram

官方文档：`https://sqlite.org/fts5.html`

trigram 支持子串检索，但短于三个 Unicode 字符的全文查询有局限。因此“沈彻”等短名字必须有普通子串查询或人物索引回退。

## [S10] Google Models API

官方文档：`https://ai.google.dev/api/models`

确认模型列表、分页与支持的生成方法字段。能列出模型并不保证所有高级功能可用，也不等于已经通过该账号的生成测试。

## [S11] Codex 的 AGENTS.md

官方入口：`https://developers.openai.com/codex/guides/agents-md`

本次入口跳转到：`https://learn.chatgpt.com/docs/agent-configuration/agents-md`

本包把开发约束放在根目录 AGENTS.md，同时在 CODEX_START.md 明确要求先读各设计文件，避免仅依赖对话历史。

## 不做的推断

不以第三方代理页面的模型 ID 替代官方 ID；不保证 Gemma 的免费额度；不保证任意模型支持全部温度/思考/JSON 参数；不把硅基流动托管的 DeepSeek 与 DeepSeek 官方账号视为同一凭据；不把模型拥有大上下文等同于应用已经实现永久记忆。

## 移动端与 PWA 复核（2026-10-01）

- [Next.js PWA 指南](https://nextjs.org/docs/app/guides/progressive-web-apps)：Manifest、安装及HTTPS部署依据，未据此更换现有Next.js版本。
- [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)：可视视口高度、偏移和缩放监听；仍需真机键盘确认。
- [MDN beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)：事件并非所有浏览器都有；应用根部保留安装事件，并提供手动入口说明。
- [MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)：应用资源缓存与更新生命周期，缓存不代替主存档或模型请求恢复。
- [Playwright 网络拦截](https://playwright.dev/docs/network#missing-network-events-and-service-workers)：有Service Worker时页面路由拦截可能不可见，故障夹具显式禁用SW；PWA测试另行启用。
- [Playwright WebKit离线模拟问题 #42775](https://github.com/microsoft/playwright/issues/42775)：当前工具setOffline会使SW导航内部报错。复测WebKit时停用独立测试源站，验证实际缓存降级；此方法仍是桌面引擎模拟，不冒充iOS Safari真机。


## 生产架构评估（2026-10-01）

- 用户 PRODUCTION_ARCHITECTURE_ADDENDUM.md：本轮生产目标与 A／B／C 选择规则；复制自用户粘贴附件。
- Sites 插件技能及官方 starter 的实际代码：portable Vinext／Cloudflare Worker、D1 绑定／Drizzle migration、平台身份／Secrets。来源为本机 sites/0.1.75 插件，云端能力仍需实际验证。
- https://developers.cloudflare.com/workers/platform/limits/ ：请求及 waitUntil 生命周期、CPU／内存限制，仅作为实测的边界提示。
- https://developers.cloudflare.com/d1/platform/limits/ ：D1 查询／行大小／容量限制；Sites 账号实际额度未知。
- https://developers.cloudflare.com/d1/reference/time-travel/ ：D1 平台恢复方式，不代表 Sites 已向用户提供该操作。
- https://github.com/cloudflare/workers-sdk/issues/14641 ：官方仓库的本地开发代理 POST 503 问题报告，与本轮观察相符但未证明根因完全相同。

本地 Miniflare / Mock／协议响应注入均不当作远程 Sites、真实 API 或真机验证。

## Sites 合成云端发布复核（2026-10-01 至 2026-10-02）

- Sites 原生发布、权限及只读数据库工具：测试站实际发布 4 个版本，用户明确要求后将访问范围设为 public（权限 revision=2）。平台内部检查完成 D1 保存／版本冲突／原子回滚、160000 字符合成正文、原规则关系 70→72、动态人物及更新保留。工具读取有截断标记，不能代替完整数据库备份。证据见项目根目录 SITES_COMPATIBILITY_REPORT.md 与 `.test-data/sites-cloud-native-1790870733198.json`。
- 当前电脑外部 HTTP／内置浏览器实际收到 Cloudflare 403；用户手机在改公开前也反馈被拦截。改公开后电脑仍受阻，尚不能确认具体规则或宣称外部访问已通过。平台公开权限与应用接口的身份／owner 校验分别保留。
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)：响应完成／断连后的 waitUntil 延长时间最多 30 秒。本轮云端独立 45 秒任务没有完成，稍后查询原 ID 安全标记失败且未重放，与文档边界一致；没有精确取消日志，不能据此断言完整根因。
- [Cloudflare Request API](https://developers.cloudflare.com/workers/runtime-apis/request/)：文档列出 redirect 模式；本轮实际 Sites runtime 却拒绝 redirect:error。仅在隔离程序无密钥出站检查中改为 manual、不跟随重定向后，三家域名返回 401／401／403。该结果证明收到 HTTP 响应，不证明模型生成或账号可用；原游戏核心没有为此改写。

当前生产方向选择 C（标准 Next.js / Node + PostgreSQL），依据是本轮入口拦截和长任务未通过。PostgreSQL 正式仓库、持久任务处理器、迁移／恢复及手机独立游玩尚未实现或验收。没有真实模型调用、真实 Key 上传或旧存档上传；Secrets 只使用随机测试哨兵。

## Scenario Package 与安全解码（2026-10-02）

- 用户 `SCENARIO_ENGINE_ADDENDUM.md`：Engine／Scenario／Save 边界、数据格式和 MVP 验收依据；测试示例不进入正式开局。
- [fflate 官方代码与文档](https://github.com/101arrowz/fflate)：使用已锁定的 0.8.3 版本的流式 Unzip／UnzipInflate 接口；本应用另做路径、中央目录／本地头、CRC、文件类型和解压配额检查，不将第三方解压等同于安全校验。
- 本地已安装 Zod 4 的类型和 `z.toJSONSchema` 实现：生成 packages/scenario.schema.json，导入仍执行严格运行时和跨引用验证。此处依据锁定依赖和实际代码，不据最新线上版本猜测兼容性。
- `tests/fixtures/scenarios.ts`：仅自动测试用现代侦探包，两个 NPC、三个自定义世界状态，关闭关系和恋爱。不是新正式世界观或默认故事。
