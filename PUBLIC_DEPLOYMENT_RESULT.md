# GitHub Pages 发布与实际验证

当前阶段：2026-10-02（北京时间）。用户已明确选择仅用 GitHub、玩家自填 Key、浏览器主档。Vercel / Neon 方案停止，未创建任何相关云资源；未采用的适配代码保留于本地 .test-data，发布源码和依赖已移除。

## 发布状态

独立仓库 https://github.com/bstyyd/text-adventure-play 已创建，即将推送白名单代码并开启 Pages；目前尚不能宣称公网发布已完成。目标网址 https://bstyyd.github.io/text-adventure-play/ 尚待 Actions 与实际 HTTP／浏览器验证。咒术回战仓库没有改动。

## 当前实际验证

| 命令／检查 | 已运行结果 |
| --- | --- |
| pnpm lint | 通过，退出码 0 |
| pnpm typecheck | 通过；清理未采用依赖后再次运行中，最终结果待补 |
| pnpm test | 当前发布源码 17 个文件、277 项通过；包含新增 8 项 SQLite WASM / IndexedDB 存储集成 |
| pnpm build | 本机生产构建通过；7 个 NFT 清单、1464 项允许引用，敏感／运行时数据文件 0 |
| pnpm build:pages | 静态生产构建通过，47 个文件；不包含服务器 API 或原存档 |
| pnpm test:pages | 9/9 通过：360、390、430、768、1440px 中文多行、Mock 自动提交、刷新／导出／回看；Key 不落盘、刷新重填；离线打开；文件导入创建新档、浏览器隔离；空间不足保留旧正式历史并允许导出 |
| 发布白名单 | 209 个文件；个人数据库、真实 Key、环境文件、测试数据、参考素材、旧 Sites 探针 0 |
| 原主库只读核对 | SQLite Schema 3；2 存档、3 分支、5 正文节点，保持不变 |
| 本机服务 | 已重新运行 pnpm start，127.0.0.1:3000 就绪；主库位置未改变 |

首次检查出现取消信号异步时序问题、静态 Manifest 导出配置错误和预览根路径校验错误，已修复并重跑。浏览器空间不足用异常模拟，不声称真实手机磁盘已满测试。所有模型链路使用 Mock 或受控 HTTP 返回，未发起真实 AI 请求、未消耗 API 额度。

## 待真实验证

公网 Actions／Pages 发布、生产 HTTPS 打开及浏览器保存刷新待本次实际发布后记录。真实模型需要玩家在页面填写自己的 Key；目前未提供任何真实 Key，不把 Mock 当成真实对话通过。Google 无 Key OPTIONS 检查在本机超时，硅基流动和 DeepSeek 预检成功；这些结果不等于真实模型调用通过。iOS Safari / Android Chrome 真机、软键盘、安装、锁屏与中国移动网络仍需人工验证。

操作说明见 GITHUB_PAGES.md；Pages 不需要模型环境变量或 GitHub Secrets。完整 JSON 文件用于备份和换设备恢复，浏览器没有自动跨设备同步。
