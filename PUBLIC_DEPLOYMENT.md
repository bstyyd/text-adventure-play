# 分享站部署与运维

2026-10-02 更新：用户明确改为仅使用 GitHub，并接受玩家自填 Key 和浏览器主存档。当前选定方案见 [GITHUB_PAGES.md](GITHUB_PAGES.md)。本文以下保留先前服务器方案记录，不作为当前发布步骤。


本次沿用 Next.js、TypeScript、流式模型适配器和服务端 SQLite，增加可选的玩家隔离模式。没有转换为静态网页，也没有迁移或上传个人主存档。当前尚未上线；实际验证记录见 `PUBLIC_DEPLOYMENT_RESULT.md`。

## 平台选择

- Vercel Hobby 适合个人非商业项目，但函数文件系统不适合作为持久化 SQLite 主存档。本次不强行迁移数据库或重写长任务服务，因此不选择它承载当前版本。[官方说明](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)。
- Render 免费 Web Service 的文件系统会随重启和部署丢失数据；免费数据库也不是永久存储方案，因此不把它作为正式存档服务。[免费限制](https://render.com/docs/free)。
- 推荐已有的、具有持久磁盘的 Linux 服务器，单个 Node 容器加 HTTPS 反向代理。没有现成服务器时可以评估 Oracle Cloud Always Free VM；其容量和账号开通均不保证，本项目没有申请资源或购买套餐。[免费资源规则](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)。

旧补充规格里的 PostgreSQL、多实例和持久任务 worker 尚未实现。本次遵循最新的“沿用现有技术栈，只做部署必要修改”，使用单实例 SQLite。模型任务运行于服务器进程，浏览器断线不重发；服务器崩溃会保留已持久化的草稿并提示恢复，不能承诺进程重启后继续调用模型。

## 密钥、访问与额度

复制 `.env.production.example` 到服务器 `/etc/fiction.env`，填写下列变量。示例文件中的值全部为空。文件权限设为仅管理员可读；不要把真实配置提交到仓库。

| 变量 | 用途 / 推荐配置 |
| --- | --- |
| APP_ACCESS_MODE | `public` |
| APP_PLAYER_MODE | `isolated` |
| APP_ORIGINS | 实际 HTTPS 地址，如 `https://game.example.org` |
| APP_DATA_DIR | 容器内 `/var/lib/fiction`，映射服务器 `/srv/fiction/data` |
| APP_SHARED_PROVIDER | `siliconflow`、`deepseek` 或 `google-gemma` |
| APP_SHARED_MODEL | 已确认可用的模型名；Google 默认 `gemma-4-26b-a4b-it` |
| SILICONFLOW_API_KEY / DEEPSEEK_API_KEY / GOOGLE_AI_API_KEY | 仅填写选定供应商的站长密钥 |
| APP_DEPLOY_TOKEN | 至少 32 字符的随机运维令牌，仅用于暂停新生成和查询任务状态 |
| APP_PASSWORD_HASH | 可选的全站访问口令哈希；空值允许访客直接进入 |
| APP_MAX_PLAYERS | 默认 100 个浏览器身份 |
| APP_PLAYER_DAILY_REQUESTS | 默认每个身份每天 20 次实际模型请求 |
| APP_LLM_DAILY_REQUESTS | 默认全站每天 200 次实际模型请求 |
| APP_MAX_OUTPUT_TOKENS | 默认每次请求 4096 tokens，上限 8192 |
| APP_LLM_DAILY_OUTPUT_TOKENS | 默认每天预留输出额度 409600 tokens |
| APP_LLM_DAILY_INPUT_BYTES | 默认每天输入上限 12000000 UTF-8 字节 |
| APP_MAX_INPUT_BYTES | 默认单次模型请求输入上限 131072 字节 |
| APP_MAX_ACTIVE_MODEL_CALLS | 默认最多 4 个同时进行的实际模型调用 |
| APP_MODEL_TIMEOUT_MS | 默认 180000 毫秒 |

站长模型是生产分享站唯一可选配置，玩家无需输入密钥，不能修改供应商、重试配置或扩大上限。三个现有适配器保留，Google 使用原生适配器和 Gemma。密钥只从服务端环境读取，不进入存档、IndexedDB、Service Worker 或前端构建。

额度按 UTC 日期记账，持久保存于 `access.sqlite`；每次实际网络请求及其重试都在发送之前扣除预算。一次故事输入通常至少包含正文和记忆整理两次模型请求，行动建议也计入额度。失败也保留预算占用，以避免网络恢复或重启绕过限制。对话按身份每分钟限流，另有全站限流；取消、超时和重复点击继续沿用唯一请求 ID。

这些是调用和 token/字节额度控制，不是精确人民币账单。供应商按模型实际计费，须在其控制台另设余额或金额上限。匿名身份可通过换浏览器或清理 Cookie 重新建立，因此全站额度是最终防线；不适合无限量开放。可以配置口令缩小开放范围。

## 存档位置与身份

生产站数据在服务器磁盘，不自动保存在手机。本机旧模式仍使用 `C:\Users\13710\DayaoNovel`，原有数据库保持原位。

分享站按不可猜测的浏览器身份分库：`/srv/fiction/data/access.sqlite` 存放身份、会话与限额，`/srv/fiction/data/players/<UUID>/dayao.sqlite` 存放该玩家的剧情、分支、记忆和剧本快照。接口验证当前身份后只打开对应数据库；其他玩家的存档、任务 ID、导出和图片均不可访问。

身份通过 HttpOnly、Secure、SameSite Cookie 保存，最长 180 天。刷新和在同一浏览器重新打开可以继续。清理 Cookie、更换浏览器、会话过期或换设备不会自动找到原存档；目前没有账号式跨设备同步，请使用完整 JSON 导出和导入。浏览器离线副本只用于已下载的阅读与输入草稿，不覆盖服务器较新的数据。

## 首次上线准备

需要一个已授权的 GitHub 仓库、现成的持久化 Linux 主机及 SSH 权限、可以指向该主机的 HTTPS 域名，以及在服务器配置的模型密钥。不会购买域名、开通付费资源或上传个人历史存档。

服务器安装 Docker Engine、Compose 插件、Python 3 和 Caddy。创建 `/srv/fiction/{bin,data,releases}`；数据目录归容器 UID 1000 所有。将 `deploy/receive.sh` 放到 `/srv/fiction/bin/receive.sh` 并允许部署用户执行。配置 `/etc/fiction.env`，按 `deploy/Caddy-public.conf` 配置真实域名，开放入站 80/443；3000 只绑定回环地址。

只有 `scripts/publish-source.mjs` 白名单中的应用文件进入发布包；`.test-data`、个人存档、日志、环境文件、参考截图和 Sites 探针均不上传。仓库可包含测试及 README；首次建仓也必须按白名单添加，不能直接添加整个工作目录。

GitHub Actions 使用 `.github/workflows/deploy.yml`。配置仓库 Variables `DEPLOY_HOST`、`DEPLOY_USER` 和 Secrets `DEPLOY_SSH_PRIVATE_KEY`、`DEPLOY_KNOWN_HOSTS`；模型密钥只放服务器，不放 Actions。SSH 公钥需授权给部署用户，主机指纹应通过可信渠道核对。推送 `main` 后先 lint、tests、build、typecheck，再发送白名单源码包。没有 `DEPLOY_HOST` 时只运行检查，不能视为完成部署。

Windows 本机构建使用普通 Next 服务，避开 Next 在 Windows 上文件追踪排除规则的路径问题；Linux 镜像使用 standalone。两种构建都运行发布文件审计。Docker 镜像由目标服务器在 Linux 上构建，不能将 Windows 的原生 SQLite 二进制直接上传运行。

## 更新与回滚

正常更新：修改代码，提交并推送 `main`，查看 Actions 日志；发布脚本先构建新镜像，再暂停新生成、等待现有任务结束、备份所有数据库，最后替换容器。健康检查失败时恢复旧容器。数据目录独立于镜像，更新不清空存档。

手动回滚代码：选择已验证提交，使用 `git revert` 后推送 `main`，或在服务器切回 `/srv/fiction/previous-image` 记录的镜像，并通过运维接口等待当前请求结束后切换。先备份数据。不要把旧数据库覆盖进正在运行的服务；如果未来引入不兼容迁移，必须恢复到新数据目录并匹配版本。

在线备份：`docker exec fiction node scripts/site-backup.mjs`。此命令包含身份、限额和各玩家数据库，使用 SQLite 在线备份 API 与 SHA-256 清单。备份仍在同一磁盘，管理员需另存到自己控制的安全位置。

恢复：停止生成、等待任务结束，使用应用镜像内的 `scripts/site-restore.mjs <备份目录> <新目录>` 验证并恢复；目标必须尚不存在。脚本拒绝覆盖现有目录。随后将 Compose 数据挂载改为恢复后的新目录、启动并验证，再保留旧目录用于回退。不要只复制运行中的 `.sqlite` 主文件而遗漏 WAL。

## 最小上线验收

实际 HTTPS 上线后：打开手机和电脑页面，执行一次授权的真实 AI 行动，确认正文和记忆原子保存，刷新读取同一原文，再检查另一浏览器看不到该存档。`scripts/deployed-smoke.mjs` 需真实 URL 与显式 `--authorize-network`，仅发送一次行动并查询原请求，不自动重试生成。

中国境内可达性需要在实际域名上用手机移动网络和宽带分别测试。目前没有生产域名可测。以前的 ChatGPT Sites 合成测试站在电脑和手机均被 Cloudflare 阻止，不能作为当前可用游戏站。海外免费域名没有稳定访问保证；如实际不可达，优先改用已有可达服务器，新增境内服务器和域名涉及费用及可能的备案，必须另行确认。

当前检查通过不等于平台已部署；真实 API、HTTPS、服务器镜像、自动发布和中国网络可达性必须分别记录实际结果。
