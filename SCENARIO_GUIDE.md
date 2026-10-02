# 通用互动小说引擎：剧本使用与格式指南

本轮保留 Next.js + TypeScript、SQLite、三家模型适配器、人物履历、原子提交、历史分支和 PWA。软件管理运行与保存；Scenario 管作者设定；Save 管本局实际发生的事。内置剧本只有 `dayao_empress`。测试专用现代侦探剧本位于 `tests/fixtures/scenarios.ts`，不会在正常启动时安装。

## 1. 原有硬编码的位置

人物、玩家、序章和初值集中在 `content/canon.ts`，同时散落在校验器、Mock、提示词、数值规则、日期适配、存档格式和页面中。审计见 [HARDCODE_AUDIT.md](HARDCODE_AUDIT.md)。这些运行逻辑现从存档绑定的剧本快照读取。旧迁移 SQL、兼容适配器、大曜包和大曜回归夹具仍可包含原名字，保留历史数据不等于将其用作其他剧本的默认设定。

## 2. 通用结构与存储

`ScenarioPackage`、`PlayerCharacterDefinition`、`PlayerOwnershipPolicy`、`SeedCharacterDefinition`、`StatDefinition`、`CalendarDefinition`、`RuleDefinition`、`LoreEntry`、地点和势力定义构成作者数据。`Character` 使用稳定 ID；角色状态由来源事件重建。`RoleAssignment` 支持 office / job / rank / title / organization_role / temporary_role。旧 JSON 的 `offices`、`office` 事件名保留兼容，记录内的 `roleType` 指定含义。

人物数值保存在 `state.relationships[characterId].values[statKey]`；世界数值在 `state.worldStats[statKey]`。SQLite 的 `character_stats`、`world_stats` 是逐节点 key/value 索引。客观人物关系另存来源事件，与分数和主观态度分开。临时地点与 `StoryThread` 有稳定 ID 和来源节点，旧分支不继承未来记录。界面关注、分类是 UI 设置，不是剧情关系。

## 3. 标准包与 Schema

完整 JSON Schema 在 [packages/scenario.schema.json](packages/scenario.schema.json)，运行时 Zod 和跨字段校验在 `src/scenario/schema.ts` / `package.ts`。需要 Engine Schema 1、Package Schema 1；未知字段和未支持的版本明确拒绝。

ZIP 必需文件：`manifest.json`、`world.md`（或 `world.json`）、`player.json`、`rules.json`、`opening.md`、`style.md`；种子人物为 `characters/<stableId>.json`。`calendar.json`、`lore/`、`references/`、`assets/` 可选。软件导出还含 `scenario-data.json`，保存地点、势力、UI、候选主角、初始场景等元数据。未提供历法时按无时间处理；manifest 必须与之相符。不能猜测开场已在场的人。

包 ID 不随标题变化；版本使用 `1.0.0` 形式。同一 ID/版本只能对应一种内容。内置 ID 保留，修改内置剧本应复制为新 ID。ZIP 压缩文件上限 4 MiB、展开总量 12 MiB、最多 256 项；单个文本 512 KiB，图片 2 MiB。只接受安全相对路径、UTF-8 文本及有正确签名的 PNG/JPEG/WebP。拒绝代码、SQL、HTML、符号链接、绝对路径、ZIP Slip、损坏目录和 CRC。文件不解压到服务器目录。

## 4. 创建新世界

进入“剧本库 → 创建新剧本”。可以保持空白并安装为待编辑剧本；固定开场为空时不能直接开始游玩。填写世界背景、玩家姓名/人设、初始 NPC、开局、写作风格；开場地点及已在场 NPC 由作者明确选择。自然语言“剧情与关系规则”指导叙事；自动阈值规则需要高级声明式配置。点击“预览剧本”，核对后“确认安装”，再“开始新游戏”。

复制/编辑会保留完整人设、秘密、规则、历法、Lore 和 ID；普通编辑逐行修改 NPC，不按名字合并。更改列表顺序或细化人物时使用高级配置核对稳定 ID。编辑安装新版本，不直接修改旧存档。

## 5. 导入背景设定

用“导入背景 TXT／MD”选择文件，或在向导粘贴原始文本。标题可写“世界 / 玩家 / 人物 / 规则 / 开局 / 文风”，也可使用 Markdown 标题。“按标题直接整理”不会调用网络；“AI 帮我整理设定”使用当前供应商并可能计费，Mock 不调用网络。转换保留原文，展示可编辑结果，规则与文风分别填写；未知事实留空并提示。真实模型转换要求字符串内容有原文依据，不能自动补秘密、年龄或规则。整理和预览均不安装，只有确认后加入库。

## 6. 导入角色

普通向导每行写“姓名｜身份｜描述”，同名人物分别占行并得到不同 ID。高级模式在 `characters` 数组加入完整卡，或在 ZIP 的 `characters/` 放人物 JSON。必须在剧本预览中确认；不会自动塞进已进行的存档。首版没有独立单卡导入按钮。

运行时的配角仍由事实整理登记，默认没有恋爱路线，也不强行拥有数值。人物簿可明确提升为主要人物、开放本剧本允许的数值；这些操作留配置来源，保留 ID 和记忆。成年且剧本允许时才能明确开放路线。

## 7. 开局与玩家控制权

`fixed` 原样显示作者开场，无模型调用；作者写定的玩家行为只在开场获得授权。`generated_from_seed` 把 `opening.md` 作为条件，先保存待生成的新档，点击“生成第一幕”才运行生成任务。失败保留草稿，成功经过整理和校验原子保存。`interactive_setup` 先填写自定义主角或选择候选，再显示作者开场；需配合 customizable / selectable，不能混用锁定主角模式。

玩家模式为 fixed / customizable / selectable。每局自定义人设写入该局快照，不改模板。固定开场后执行当前玩家的所有权策略，安全默认禁止模型补对白、决定、主动行为和内心。正文措辞提示由玩家判断；任命和其他结构化决定仍须有玩家明确原文或先前授权。

## 8. 关闭关系和恋爱

关闭 `manifest.romanceSystem` 并将人物 `romancePolicy` 设为 disabled，不配置需要恋爱的触发器。关闭 `manifest.relationshipSystem.enabled` 并清空人物数值定义。关闭关系数值后不会显示两个空的零；客观亲属、上下级或敌对履历仍可记录。

## 9. 自定义人物数值

向导启用人物数值，每行如 `respect｜尊重｜-10｜10｜0`。高级定义包括 `key`、`displayName`、`min`、`max`、`initial`、单次 `step`、单场 `sceneLimit` 和 `dynamicDefault`。每个人可设 `initialStats`；`statPolicy` 为 scenario_default / explicit / disabled，允许只初始化部分数值或完全没有数值。动态人物默认不自动开放条目；明确配置后采用声明的初值，不重置已存在的值。

## 10. 自定义世界数值与触发

向导每行如 `clues｜线索进度｜0｜100｜10`、`risk｜风险｜0｜10｜2`。世界初值从包读取，新档可在高级设置中改为范围内的值。模型只提交来源建议，程序按定义限制幅度和场景总量。

安全触发器例子：

```json
{"id":"cooperation","eventType":"cooperate","scope":"each","trigger":{"source":"character_stat","key":"respect","operator":">","value":3},"reason":"合作条件达到","priority":2}
```

支持 `all` / `any`、人物数值、世界数值和内置 neglect / exceptions 计数器，及比较操作、场景与冷却约束。不会执行 JS、SQL 或文件/网络工具。条件成立是事件候选，不等于模型可以自动决定玩家行为。数字变更还需要合法原文证据，不能靠普通一句话随意加分。

## 11. 时间配置

none 关闭时间，relative 用“第 N 天”，gregorian 用真实公历，fictional 可改月长、年号和时段。`calendar.start` 指定起点；架空 `months` 可有 1–24 个不同长度的月，公历检查闰日。relative / none 使用 year=1、month=1、day=天数；无时间不允许推进。向导的普通架空默认是 12 个 30 天月，现代默认 2026-01-01 09:00，这是可编辑产品默认值，不是引擎世界设定。日期检索支持 `年-月-日`。

## 12. 导出、Lore、参考和安全主题

剧本卡“导出剧本 ZIP”导出作者模板；存档菜单的恢复 JSON 导出实际正文、记忆、动态人物、数值、履历、分支及各版本快照，二者不混用。完整恢复包可能含后台秘密，应保存在自己的设备。TXT / MD 是已展示原文的阅读版。

Lore 有标签、人物、地点、势力、优先级和可见性；每回合按当前场景、任务和输入检索，不发送整个库。提示词分五层：引擎、作者设定、已提交存档、当前场景、玩家原文。作者设定不能获得引擎权限。references 默认不是事实历史，当前不会把参考聊天原文直接发送给叙事模型。

封面在 `assets/`，`ui.theme.coverImage` 指向包内图片；安全主题仅允许颜色、背景/字体预设等白名单。没有封面时显示标题占位。手机和桌面用同一份逻辑；主存档在电脑/服务器，IndexedDB 是下载副本。旧版离线包以只读映射继续阅读并保留原恢复包，联网后重新下载新版本；不会回写主库。

## 13. 旧大曜存档迁移、快照和升级

数据库 v2 → v3 前做 SQLite 完整备份，事务中增加剧本表、快照表和数值索引，将旧 state.court 与双轨字段转换成通用 key/value。保留六位原 ID、已有数值、正文、分支、记忆和来源。v1/v2 JSON 先校验原 checksum，再走兼容迁移，导入仍创建新档。

每局绑定 `scenarioPackageId / scenarioVersion / scenarioSnapshotHash`，每个节点继承自己的版本来源。安装新版本不会更改旧局。“存档 → 升级此存档的剧本版本”先预览，只有元数据、文风和 Lore 等可安全变化能确认迁移；人物、玩家、规则、日历或开场变化会拒绝并继续使用旧快照。新存档可使用新版本。升级配置节点不推进时间或数值；旧节点和旧分支仍使用旧版本。

主存档继续位于 `C:\Users\13710\DayaoNovel`，开发目录为 `D:\文字游戏`。现已实际升级到 v3，迁移前自动备份为 `before-scenarios-v3-1790944322772-6c420230.sqlite`；原始在线备份在 `backups/manual-1790936954046-5ecae873.sqlite`。主库只读核对见 `.test-data/scenario-migration-ymvrdx/verification.json`，原文、ID、数值、分支与记忆来源一致。备份和恢复命令见 README，不覆盖原库。

## 14. 哪些规则仍是大曜专属

玄天华人设、六人、信任/好感初值、御书房原序章、凌月历法、五项朝局状态、慢热写法、严格情感阈值、三次冷落/破例条件、远方人物的旅行和书信限制都留在 `packages/dayao_empress/`。其他世界不会自动继承这些字段或触发器。旧 `content/canon.ts` 是大曜兼容/回归入口，通用引擎不从这里补缺设定。

## 15. 后续新增字段

先定义数据和权限边界，更新 Schema、格式说明、校验器、公开投影、快照/导入导出、UI 和测试。已有版本快照不得因新默认值而改变哈希；不兼容变动应提升 Schema/Engine Version，并保留旧版本解析或提供显式迁移，不原地改作者包同一版本。新增规则只能扩展声明式白名单，不能引入 eval、动态模块、网络或数据库工具。

运行 `pnpm exec tsx scripts/scenario-schema.ts` 可重新生成 Schema 和大曜的公共离线兼容投影；不会打开数据库。不要把完整作者包作为前端模块导入，以免泄露未揭示背景。
