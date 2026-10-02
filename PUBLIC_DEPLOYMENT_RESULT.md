# GitHub Pages 发布与实际验证

交付记录：2026-10-03（北京时间）。用户已明确选择仅用 GitHub、玩家自填 Key、浏览器主档。Vercel / Neon 方案停止，未创建任何相关云资源；未采用的适配代码保留于本地 .test-data，发布源码和依赖已移除。

## 发布状态

**已实际发布并通过公开网址浏览器验证。**

- 游戏：[https://bstyyd.github.io/text-adventure-play/](https://bstyyd.github.io/text-adventure-play/)。无需登录即可打开；真实续写需玩家自己的 Key，默认 Mock 是明确标注的演练。
- 独立公开仓库：[bstyyd/text-adventure-play](https://github.com/bstyyd/text-adventure-play)。咒术回战仓库没有改动。
- 首个成功版本：`299cf49f30ad5506498839a126d2677f1890c1fb`；[GitHub Actions 构建及发布](https://github.com/bstyyd/text-adventure-play/actions/runs/37030420718) 的 build / deploy 成功，UTC 2026-10-02 15:57:39 报告发布成功。
- 实际 HTTPS 检查：游戏 HTML、Manifest、SQLite WASM 均为 200，资源 MIME 正确。真实地址的四项 Edge 浏览器检查全部通过，详见下表。
- main 后续推送继续自动检查和发布，最新状态以仓库 Actions 为准。无需模型环境变量、GitHub Secrets、Linux 服务器、Vercel、Neon、购买域名或付费套餐。

## 当前实际验证

| 命令／检查 | 已运行结果 |
| --- | --- |
| pnpm lint | 通过，退出码 0 |
| pnpm typecheck | 本机和 GitHub Ubuntu 通过；最后测试配置调整后本机再次通过 |
| pnpm test | 当前发布源码 17 个文件、277 项通过；包含新增 8 项 SQLite WASM / IndexedDB 存储集成 |
| pnpm build | 本机生产构建通过；7 个 NFT 清单、1464 项允许引用，敏感／运行时数据文件 0 |
| pnpm build:pages | 本机静态生产构建通过，47 个文件；GitHub 干净 Ubuntu 构建通过，45 个文件，发布压缩包 896582 字节；不包含服务器 API 或原存档 |
| pnpm test:pages | 9/9 通过：360、390、430、768、1440px 中文多行、Mock 自动提交、刷新／导出／回看；Key 不落盘、刷新重填；离线打开；文件导入创建新档、浏览器隔离；空间不足保留旧正式历史并允许导出 |
| 公开 HTTPS 浏览器验证 | `PAGES_TEST_URL=https://bstyyd.github.io/text-adventure-play/`，Playwright Pages 配置选择 `390px\|player key\|downloaded resources\|file import`：4/4 通过；自由输入与 Mock 正式保存、刷新读档、导出／回看、Key 不落盘与刷新清除、离线重新打开、JSON 文件恢复及另一浏览器隔离 |
| pnpm exec playwright test --config=playwright.public.config.ts | 保留的本机 Node 公网模式回归 3/3 通过，Mock 与受控配置 |
| pnpm test:access | 保留的本机 Node 登录与访问保护回归 1/1 通过 |
| 发布白名单 | 209 个文件；个人数据库、真实 Key、环境文件、测试数据、参考素材、旧 Sites 探针 0 |
| 原主库只读核对 | SQLite Schema 3；2 存档、3 分支、5 正文节点，保持不变 |
| 本机服务 | 已重新运行 pnpm start，127.0.0.1:3000 就绪；主库位置未改变 |

GitHub 的成功构建实际执行 lint、277 项 tests、静态 production build 与 typecheck。首次云端安装因 pnpm 11 严格依赖脚本策略失败；已审阅 `@google/genai` 的提示脚本和 `protobufjs` 的版本提示脚本，显式禁用这两个不需要的安装脚本后，干净安装及整个工作流通过。

开发检查还出现取消信号异步时序问题、静态 Manifest 导出配置错误和预览根路径校验错误，已修复并重跑。浏览器空间不足用异常模拟，不声称真实手机磁盘已满测试。所有模型链路使用 Mock 或受控 HTTP 返回，未发起真实 AI 请求、未消耗 API 额度。

## 待真实验证

用户在 2026-10-03 明确选择“先交付网页，真实 AI 我自行测试”。因此真实模型对话、正文／记忆双请求的实际费用与三家实际账号权限均未验证，不把 Mock 当成真实对话通过。Google 无 Key OPTIONS 检查在本机超时，硅基流动和 DeepSeek 预检成功；这些结果不等于真实模型调用通过。

当前电脑网络能打开实际 Pages HTTPS 并完成四项浏览器检查；这不代表所有中国境内网络稳定。iOS Safari / Android Chrome 真机、软键盘、安装、锁屏与中国移动网络仍需人工验证。

操作说明见 GITHUB_PAGES.md；Pages 不需要模型环境变量或 GitHub Secrets。完整 JSON 文件用于备份和换设备恢复，浏览器没有自动跨设备同步。
