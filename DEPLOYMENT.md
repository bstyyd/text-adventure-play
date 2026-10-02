# 运行与部署

当前分享站按照用户新决定，仅使用 [GitHub Pages](GITHUB_PAGES.md)，玩家自填 Key、浏览器保存主档；下面服务器章节是本机／早期方案，不用于此次发布。

当前公开分享站沿用单实例 Next.js 和持久化 SQLite，新增的玩家隔离、站长密钥、调用额度、GitHub Actions 更新及恢复步骤见 [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md)。此前关于 Sites、PostgreSQL 和持久任务 worker 的方案仍属独立架构评估，不代表此次已经部署。原有个人数据库不迁移、不上传。

2026-10-02 通用引擎更新：主应用增加 Scenario Library、版本快照、导入导出和可配置世界规则，仍使用同一 Next.js／SQLite 本机服务。主库已备份后升级到 v3；数据目录没有迁移、存档没有清空。备份是 `C:\Users\13710\DayaoNovel\before-scenarios-v3-1790944322772-6c420230.sqlite`。实际结果见 [SCENARIO_DELIVERY_REPORT.md](SCENARIO_DELIVERY_REPORT.md)，剧本操作见 [SCENARIO_GUIDE.md](SCENARIO_GUIDE.md)。下面的生产架构评估仍保留当时状态，不将本机通用化当作完成 PostgreSQL 或正式云端部署。

## 新生产规格的当前状态（2026-10-02）

按 [生产架构补充规格](dayao-codex-design/PRODUCTION_ARCHITECTURE_ADDENDUM.md)，目标是个人电脑关闭后，手机通过 HTTPS 登录独立的公网服务。当前尚未部署这样的正式服务。Sites 已实际评估：合成站发布并设为public，云端内部业务／D1与版本保档通过；入口Cloudflare403和45秒任务失败阻止生产验收。本轮选择C：标准Next.js / Node + PostgreSQL。完整生产仓库、认证与持久worker还需实现；不能把下面旧版Node + 持久SQLite说明当成已完成新要求。

隔离兼容性程序在 `D:\文字游戏\spikes\sites-compatibility`，不替换主应用。测试站 <https://dayao-synthetic-spike.bositaya.chatgpt.site>，ID为 `appgprj_6abe6e03eaa481919aafc57962b6e132`，public权限已确认，游戏接口仍检查身份并隔离用户。源码／匹配Worker包按Sites插件workflow保存与发布，更新须保留public模式；测试Secrets只配置在平台。步骤、Windows适配和测试范围见其 [README](spikes/sites-compatibility/README.md)，实际云端证据见 [SITES_COMPATIBILITY_REPORT.md](SITES_COMPATIBILITY_REPORT.md)。测试D1只有合成记录；当前无可确认的完整云端数据库备份恢复，平台受限行读取不是备份。创建付费资源、真实Key、已有历史上传及正式游戏上线仍须相应确认。

生产评估时的 SQLite 主存档位于 `C:\Users\13710\DayaoNovel\dayao.sqlite`，当时没有迁移或清空；该阶段备份为 `C:\Users\13710\DayaoNovel\backups\before-production-architecture-2026-10-01T11-07-26-551Z.sqlite`。现在已做本机 v3 Schema 升级，但未迁至 PostgreSQL 或云端。继续使用 A 节的本机流程和原有备份／恢复。`.env.production.example` 是空的变量清单，生产 `DATABASE_URL` 与 `AUTH_SECRET` 仍需在选择适配器后实现和验证。

## A. 本机和局域网

电脑安装 Node.js 22/24 和 pnpm 11，在项目目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

默认只监听 `127.0.0.1:3000`。开发调试可用 `pnpm dev`；PWA 的资源缓存只在生产构建启用。

浏览器并不会启动 Node 服务。关闭终端、服务退出或电脑休眠都会使网页不能连接；刷新浏览器不能代替启动服务。标准 `pnpm start` 是前台服务，请保留运行它的终端。`APP_DATA_DIR/logs/lifecycle-*.log` 自动记录启动、子进程和可观察到的退出信息，不记密钥、请求正文或供应商原始错误；强制杀进程／断电可能没有最后一条退出记录。

Windows 允许 PowerShell 脚本运行的环境，可选使用下面的后台脚本；**当前开发电脑的执行策略拒绝了该脚本，自动审批也拒绝了后台启动尝试，实际使用的是标准 `pnpm start`**。遇到相同限制时使用前台命令，不需要修改系统执行策略：

```powershell
powershell -NoProfile -File .\scripts\start-background.ps1
```

日志在 `%USERPROFILE%\DayaoNovel\logs\`，脚本输出本次 PID 和日志位置。重复启动会因端口占用失败并留日志。此脚本不是开机自启，也不能保证进程永不退出。排障命令：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing
```

更新代码／重建前先用 `pnpm backup` 备份，停止该项目的服务进程，再构建并启动。不要删除 SQLite，也不要随意结束所有 Node 进程。

手机访问步骤：

1. 电脑和手机连接同一可信 Wi-Fi。运行 `ipconfig`，找到电脑的局域网 IPv4（例如 `192.168.1.10`）。不要把示例地址原样当作自己的 IP。
2. 在终端运行 `pnpm password`，交互输入至少 12 字符的个人登录口令；屏幕不回显明文，输出其 scrypt 哈希。
3. 编辑自己的 `.env.local`，保留已有密钥字段，加入下面配置并替换实际 IP、路径、口令哈希。

```dotenv
APP_ACCESS_MODE=lan
APP_HOST=0.0.0.0
APP_PORT=3000
APP_ORIGINS=http://192.168.1.10:3000,http://127.0.0.1:3000
APP_PASSWORD_HASH=scrypt:v1:替换为命令生成的完整哈希
APP_DATA_DIR=C:/Users/你的用户名/DayaoNovel
```

4. 重启服务。手机打开 `http://192.168.1.10:3000` 并登录。**手机不能使用电脑的 localhost**。电脑 IP 变化后，更新来源配置及书签。
5. 如果 Windows 防火墙阻止连接，可由你在管理员 PowerShell 添加仅限私有网络、本地子网的规则（本项目不会自动修改防火墙）：

```powershell
New-NetFirewallRule -DisplayName 'Dayao LAN 3000' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet
```

不要配置路由器端口转发。LAN HTTP 适合可信家庭网络，无法提供传输加密；远程和公共网络使用下述 HTTPS 方式。电脑必须保持运行、服务存活；这不是脱离电脑的线上版本。

普通 LAN HTTP 可以玩核心功能，但 Service Worker 需要安全上下文；手机 PWA 安装及离线启动需要有效、受信任的 HTTPS 证书。不要关闭浏览器安全检查。电脑的 `localhost` 是浏览器安全上下文例外，手机访问电脑 IP 不享受该例外。

## B. 旧版持久化 HTTPS 服务器说明（不是本轮最终方案）

本节保留既有配置用于参考，**没有代你购买服务器、上传历史存档或上线**。本轮正式方案以 Sites 实测后的书面结论为准：若选择标准服务器或外部后端，须使用 PostgreSQL、持续运行的任务处理器及同一套游戏规则。本节当前 SQLite 部署方式不满足新增 PostgreSQL 与可恢复后台任务的生产要求。旧模式应使用长期运行 Node 的单实例服务器及持久磁盘，不能放在临时函数文件系统、多副本共享 SQLite 或会随部署清空的容器层。

服务器上安装 Node.js 22/24、pnpm 11、构建 SQLite 原生模块所需的系统工具，以及 Caddy。代码目录示例 `/opt/dayao`，持久数据目录 `/var/lib/dayao`，运行用户 `dayao`（只赋予该用户数据读写权限）。部署前由管理员创建这些目录和用户。

在服务器目录中安装、构建并生成口令哈希。将环境配置写入 `/etc/dayao.env`，仅管理员和服务用户可读：

```dotenv
NODE_ENV=production
APP_ACCESS_MODE=public
APP_HOST=127.0.0.1
APP_PORT=3000
APP_ORIGINS=https://story.example.com
APP_DATA_DIR=/var/lib/dayao
APP_PASSWORD_HASH=scrypt:v1:替换为生成的完整哈希
# 可选：供应商密钥使用服务端环境变量，或每次启动后在设置中提交
SILICONFLOW_API_KEY=
DEEPSEEK_API_KEY=
GOOGLE_API_KEY=
```

`deploy/dayao.service` 和 `deploy/Caddyfile` 提供示例。替换实际域名、可执行文件位置；DNS 指向服务器，开放 443 和证书签发所需的 80，3000 仅监听回环地址。检查配置后由管理员启用：

```sh
sudo cp deploy/dayao.service /etc/systemd/system/dayao.service
sudo systemctl daemon-reload
sudo systemctl enable --now dayao
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status dayao
sudo journalctl -u dayao -n 100 --no-pager
```

线上服务运行在服务器，与个人电脑开关无关。密码通过 HTTPS 发送给服务端进行 scrypt 校验；会话为 HttpOnly、SameSite=Strict，公网加 Secure，24 小时过期、进程重启失效。登录旋转令牌。所有模型、存档、导出、备份、人物接口都要求会话认证，写入还校验 CSRF 和准确 Host/Origin。

个人单进程限流：登录全局每15分钟8次，已登录每分钟300次接口、80次写入、全局12次模型操作；离线完整下载每分钟4次。服务端不信任任意 `X-Forwarded-For`。生产反向代理可再配置连接／请求限制；不要运行多个独立进程绕过 SQLite 和进程内限流。登录口令限制访问，不是多租户隔离；允许登录的人共享同一书库。

## 存储、离线与恢复

- 主存档：`APP_DATA_DIR/dayao.sqlite`，在服务所在的电脑或服务器；不会自动保存在手机。
- 浏览器 IndexedDB：`dayao-browser-v1`。保存输入草稿、当前卷册分支、阅读位置、请求 ID、已收到草稿，以及主动下载的完整副本。离线下载由版本号、服务标识、SHA-256 版本指纹和同步时间标记。更新副本使用原子替换，空间不足保留旧副本。
- 完整离线下载包括全部分支及恢复用的隐藏状态；界面始终读取服务端提前生成的可见投影，不把隐藏资料放进人物卡。仅在自己的设备下载；退出登录不删除已下载副本。可在设置中移除此设备副本，主存档不变。
- 未发送输入和收到的草稿独立保留。联网／重新打开时只查询原请求；服务未收到时，用户可手动重发同一个请求 ID。没有后台同步队列，也不自动重放收费请求。
- 下载后可离线阅读、查状态、保存未发输入、导出完整 JSON／TXT／MD；离线不能调用模型、提交正式剧情或修改服务器主档。联网后的正式提交继续检查分支头版本，冲突时保留草稿并提示刷新或另开分支。
- 安装更新只替换应用资源，不删 IndexedDB 或 SQLite。新版本等待用户确认；有输入或生成时不允许刷新。浏览器可能回收存储，离线副本不能替代外部备份。
- 安装入口在设置页；如果浏览器在读故事时提供安装事件，进入设置仍能使用。生成请求结果未知、下载副本时同样暂不更新。应用更新不强制刷新其他打开的标签页，前一版静态资源会保留供旧页面使用。
- 副本缺少分支／原文／人物簿时拒绝替换，较早下载晚到也不会覆盖较新副本。若迁移服务器后服务标识改变，先导出原离线JSON，显式移除此设备副本，再从目标服务器下载。这个操作不改服务器主存档。来源保护与并发检查不提供自动双向同步。

备份时在与服务相同的 `APP_DATA_DIR` 环境下运行 `pnpm backup`，使用 SQLite 在线备份，不单独复制正在写入的主文件。备份在数据目录 `backups/`。如需跨设备另存，通过手机文件选择器导出 JSON；不要求填写服务器路径。

恢复数据库：停止服务，`pnpm restore /备份完整路径.sqlite /新的数据目录`，成功后把服务的 `APP_DATA_DIR` 指向新目录再启动。已有目标数据库会被拒绝，原库保留。恢复 JSON 会创建新卷册并重映射引用，不覆盖主存档。主档过大超出20MB JSON导入上限时使用数据库备份。迁移、更新和恢复后都应检查完整性与故事数量。

## 依据与验证范围

- [Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Service Worker 安全上下文](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [VisualViewport 与屏幕键盘](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API)
- [安装事件能力与生命周期](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)
- [浏览器配额与清理](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

真实部署、受信任 HTTPS 证书、iOS Safari 主屏幕启动／软键盘、Android Chrome 安装及真实弱网均需目标设备验收。自动化浏览器视口与离线模拟不冒充真机结果。实跑记录见 VERIFICATION.md。
