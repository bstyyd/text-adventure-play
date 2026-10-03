# 仅使用 GitHub 的发布计划

2026-10-02：用户明确停用 Vercel，并确认接受玩家自填 API Key、浏览器主存档与文件备份。此前 Vercel / Neon 方案停止，没有创建对应云资源。现有电脑主存档不迁移、不上传。

1. 保留统一 Next.js / TypeScript、原有小说页面、三个供应商适配器、剧本和规则引擎。新增独立静态构建入口，GitHub Pages 发布完整浏览器版；本机 Node 入口继续存在。
2. 浏览器以 SQLite WASM 复用 Repository 的 SQL 和原子剧情事务，完整数据库快照写入 IndexedDB。每次写入检查版本与写入租约，重试沿用请求 ID；不把存储失败显示成已保存。跨设备使用完整 JSON 导入导出，没有自动服务器同步。
3. 2026-10-03 按用户新要求，加入“在此设备记住 API Key”，默认启用；密钥保存到独立的浏览器 IndexedDB 密钥库，可取消记住或单独清除。密钥不进故事数据库、localStorage、Service Worker、导出、仓库或构建环境，不自动跨设备同步。浏览器直接调用固定的供应商 HTTPS 地址，不发布站长共享密钥。真实模型测试需玩家填入密钥后进行。
4. 修复 `/text-adventure-play/` 子路径、图片、Manifest、Service Worker 和刷新；保留手机阅读、人物、历史、存档分支及剧本管理。
5. 使用独立仓库 `bstyyd/text-adventure-play`，白名单上传代码；免费 GitHub Pages 需要公开代码仓库。Actions 执行检查、静态构建和发布，推送 main 自动更新。
6. 验证 lint、typecheck、单元 / 集成、生产构建与浏览器闭环，再发布并检查真实 HTTPS 地址。真实 API 对话、真机与中国移动网络分别记录，未测试不声称通过。

跨域预检（无 Key、不调用模型）：硅基流动 OPTIONS 204、DeepSeek OPTIONS 200，允许 GitHub Pages 来源；Google 本机网络超时，不能写成已验证。预检通过不等同于真实模型对话通过。

依据：[GitHub Pages 自定义构建](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[SQLite WASM sql.js](https://sql.js.org/documentation/)、[Google 原生 Gemma](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)。
