# GitHub Pages 浏览器版

用户于 2026-10-02 明确选择：仅用 GitHub，玩家自填 API Key，浏览器主存档与文件备份。Vercel / Neon 方案停止，没有创建对应云资源。电脑主库不上传。

独立仓库：[bstyyd/text-adventure-play](https://github.com/bstyyd/text-adventure-play)。已发布网页：[文字冒险](https://bstyyd.github.io/text-adventure-play/)。2026-10-03 已通过实际 HTTPS 地址的保存、刷新、密钥不落盘、离线和文件恢复检查；实测范围见 [发布记录](PUBLIC_DEPLOYMENT_RESULT.md)。咒术回战仓库和网页没有改动。

## 游玩与 API

打开页面即可阅读序章、使用明确标注的 Mock 演练、创建／导入剧本、查看人物、日期回看和分支。真实自由续写需要玩家自己的供应商 Key。

“设置 → 供应商配置”：选择硅基流动、DeepSeek 官方或 Google AI Gemma，填写完整模型 ID 和 Key，点击“用于游戏续写”，保存配置并将下一轮正文与记忆整理切换到此模型。也可在“正文配置”选择该项并保存选择。保存密钥或测试连接本身不会切换游戏模型；测试结果会显示当前游戏模型，并提供“用于游戏续写”按钮。旧段落保留生成当时的模型标记。Google 默认 `gemma-4-26b-a4b-it`，使用原生 Google 适配器，无需 OpenAI Key。通常每轮一次正文、一次记忆整理，最多一次格式修复；手动重试和测试连接可能另外计费。

浏览器直接访问供应商官方 HTTPS API。硅基流动与 DeepSeek 无 Key 的跨域 OPTIONS 检查通过，Google 本机检查超时；预检不等于真实模型测试。Google 能否连接还取决于设备网络。

Key 默认可在此设备记住，存于独立 IndexedDB `interactive-fiction-provider-keys-v1` 的 `keys` 表，按模型配置与供应商匹配恢复。保存后清空输入框，刷新／关页后自动使用。取消“在此设备记住 API Key”并保存会删除持久密钥，仅本次页面可用；“清除这项密钥”同时清除本页与本机保存的这项密钥。密钥库使用浏览器本地存储，并非带密码保护的保险箱；共用设备可取消记住。它不进入主存档数据库、localStorage、缓存、导出、日志或构建产物，不自动同步到其他设备。清除网站数据会删除密钥。**Pages 不需要配置模型环境变量或 GitHub Secrets，不能发布站长共享 Key。** 根目录空的 `.env.example` 用于保留的本机 Node 版本。

## 存档、备份与恢复

主存档在当前浏览器 IndexedDB `interactive-fiction-pages-v1` 的 `snapshots` 表；SQLite WASM 复用原规则、记忆整理与原子剧情事务，以完整数据库快照持久保存。只有持久写入成功才返回正式保存状态。保留上一版本及最近自动／手动备份；版本比较和 45 秒写入租约阻止其他标签覆盖，生成中每 2 秒保存草稿并续租。刷新先查询原请求，不自动重复调用模型；中断后可能需等旧租约到期再手动恢复。

不同浏览器／设备各自保存，没有账号和自动跨设备同步；共用同一浏览器配置文件的人共用书库。无痕模式、浏览器数据清理或存储回收可能丢失数据。

外部备份：在“存档”导出“可恢复 JSON”，保存在自己控制的位置。恢复／换设备时用手机或电脑文件选择器“导入可恢复 JSON”，创建新卷册，原档不覆盖。JSON 保留完整正文、记忆、人物履历、状态、来源与分支；TXT / Markdown 仅为阅读版。剧本可另导出 ZIP。更新／回滚不会删除 IndexedDB，不要以清除网站数据代替更新。

电脑原主库仍在原来的 `DayaoNovel` 数据目录；没有迁移或上传。想继续原故事时，先在本机版导出 JSON，再自行选择是否导入网页。内置剧本和规则随网页分发，人物簿仍按知情范围展示；纯浏览器版不阻止用户查看源码中的剧本设定。

## 手机、PWA 与离线

同一套小说页面支持单栏手机布局、中文多行输入、人物簿、日期检索、存档分支和导入导出。Manifest 和 Service Worker 限定 `/text-adventure-play/`，不干扰同账号的其他 Pages 游戏。缓存资源完成后可以离线打开已保存故事、查看人物及导出，离线不会调用模型；更新由玩家操作，输入或生成时不强制刷新。

安装不是游玩的前提。Safari 使用“分享 → 添加到主屏幕”；Chrome 使用实际提供的安装入口。真机键盘、iOS 主屏幕启动与 Android 安装须人工验证，自动化视口结果不能替代。

## 构建与自动发布

```powershell
cd D:\文字游戏
pnpm install --frozen-lockfile
pnpm build:pages
node scripts/serve-pages.mjs
```

模拟地址：`http://127.0.0.1:3230/text-adventure-play/`；产物为 `pages-site/out`。本机 Node / SQLite 版仍用 `pnpm build`、`pnpm start`。

完整本地浏览器检查用 `pnpm test:pages`。仅检查已发布网页可在 PowerShell 设置 `$env:PAGES_TEST_URL='https://bstyyd.github.io/text-adventure-play/'`，再运行 `pnpm exec playwright test --config=playwright.pages.config.ts --grep '390px|player key|downloaded resources|file import'`；这些案例不调用真实模型。

GitHub Settings → Pages 使用 GitHub Actions。main 推送触发 `.github/workflows/deploy.yml`，检查 lint、tests、静态生产构建和 typecheck，再发布 `pages-site/out`。仓库只上传白名单代码、测试和文档，原存档、密钥、环境文件、日志、截图与测试数据不进入仓库或网页。

更新：修改代码、提交并推送 main，在 Actions 确认 build 和 deploy 都成功，再检查网页。回滚：`git revert <有问题的提交号>` 并推送 main，等同一流程重新发布；不覆盖或回退浏览器数据库。未来不兼容 Schema 升级须先导出 JSON。改变仓库名时同步修改 Pages 配置、构建和预览脚本的子路径。

## 免费额度与费用

GitHub Free 支持公开仓库的 Pages；不购买域名或付费套餐。官方限制包括站点大小 1GB、每月软带宽上限 100GB。免费托管不包含模型额度；AI 费用来自各玩家的供应商账户，输出上限和超时由模型配置控制，没有站长共享 Key。

当前电脑网络已在真实网址通过 HTTP 和浏览器检查，其他中国境内网络仍需实际测试，GitHub Pages 和海外模型不保证所有网络稳定；请求失败保留输入与已收草稿，不自动重发。用户选择自行测试真实模型，交付不把 Mock 写成真实 API 通过。

依据：[Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Pages 限额](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[原生 Gemma](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)。
