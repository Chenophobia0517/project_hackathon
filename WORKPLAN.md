# 「求真」交付工作计划（V1 已交付 · V1.5 升级计划待审批）

> 基于 `D:\Project\知乎黑客松2026\PRD` 全部 10 份文档 + 当前仓库现状制定。
> 目标：在黑客松周期内交付可演示的 MVP，完整跑通「选中一句 → 深读 → 求真/求深/求异」闭环。
>
> **2026-08-25 更新**：V1 已全部交付（M0-M4，tags m0~m4，验收 PASS）。新增 `v1.5_UPGRADE.md` 升级要求，计划见文末「V1.5 升级计划」章节，待审批。

---

## 一、PRD 要求提炼（产品必须是什么）

**产品**：Chrome Extension（Manifest V3），暂名「求真」。用户在任意网页选中一句话（Claim）→ 选区旁出现「深读」按钮 → 打开 Side Panel → 三层探索：

| 模式 | 用户问题 | 核心输出 |
|---|---|---|
| 求真 | 这句话靠谱吗？ | 支持程度（充分/部分/不足/不支持）+ 证据链（原始来源→权威→社区）+ **原文↔来源对照** |
| 求深 | 背后是什么？ | 原理解释 + 相关概念知识树 + 继续探索问题 |
| 求异 | 还有别的看法吗？ | 当前观点 + 不同立场卡片 + 认知盲区 |

**不可违背的产品原则**：
1. 不改造网页本身；无操作时插件"几乎不存在"。
2. 用户主动触发：只分析选中的一句，不默认采集整页。
3. 不是聊天机器人：结构化结果，不是对话气泡。
4. 找到来源 ≠ 来源支持原文：求真的差异化核心是"表述是否被夸大"的对照判断。
5. 不制造虚假确定性：支持程度不裸奔百分比数字。

**技术硬性要求**：
- MV3 架构：content script（捕获+按钮）→ background（Active Selection 中转，`chrome.storage.session`）→ side panel（三 Tab 工作台）→ 后端。
- API Key 不进前端 → 必须有 Backend 层承担 AI 分析与搜索。
- 知乎开放能力：知乎搜索 / 全网搜索 / 直答 Agent 是证据与观点的主要数据源。
- API 配额（知乎搜索 1000 次/用户/天、直答 Agent 仅 100 次/天）→ 必须做查询缓存。
- 最小权限：优先 activeTab + scripting，避免 <all_urls>。
- 异常处理：Loading 分步提示、Error 可重试、Empty 有语义化引导、滚动隐藏按钮、context invalidated 提示刷新。

---

## 二、现状分析（当前仓库 vs PRD）

当前仓库是一个已完成的「Web Context Capture」模块（367 行 JS，纯静态零依赖，3 个 commit）：
- content script 在**页面级静默采集**：滚动/resize/MutationObserver 触发，提取全页可见段落上报 background；
- background 存 `chrome.storage.session`，提供 GET_CURRENT_CONTEXT 查询接口；
- README/INSTALL 已写好，manifest 用了 `<all_urls>` host_permissions。

**关键发现——方向性冲突**：
1. **现有代码采集的是"整页上下文"，且是自动触发**；PRD 明确要求"用户主动触发、只读选中的那一句"。这不是小偏差，是产品哲学层面的相反。PRD 的隐私卖点（"我们不读你的网页，只读你主动问的那一句"）会被现有实现直接否定。
2. 现有的 utils（消息类型常量、throttle/debounce）、background 骨架（storage.session 双写、能力检测分支）**可以复用**；paragraph-extractor / visibility-detector 与新方向无关，应移除或封存。
3. manifest 的 `<all_urls>` 需要重新评估：PRD 技术文档明确建议避免。但注意——content script 若要"任何网页都能选中即触发"，声明式注入通常需要 host 匹配；用 activeTab 则只在点击扩展图标后生效，无法自动注入。这是需要权衡的技术决策点（见下文 D3）。

**结论**：保留仓库骨架与工具函数，将"静默整页采集"重构为"主动选区捕获"，在此基础上补齐 Side Panel 与后端。

---

## 三、开工前需要你拍板的决策点

### D1. 现有"整页静默采集"模块如何处置
- **方案 A（推荐）**：删除 paragraph-extractor / visibility-detector 及其自动采集逻辑，仓库彻底转向 PRD 方向。理由：与 PRD 隐私原则正面冲突，留着会在演示/评审时被质疑；git 历史里永远找得回来。
- **方案 B**：封存为 `src/legacy/` 不注入，仅作参考。
- （影响面小，但方向问题，想听你的意见）

**确定方案A**

### D2. 后端形态
PRD 要求 Key 不进前端、必须有 Backend。两个选项：
- **方案 A（推荐）**：本地 Python（FastAPI）后端，承担 LLM 编排 + 知乎 API 代理 + 缓存。黑客松演示在本机跑完全可行，开发最快。
- **方案 B**：用 Extension 的 background service worker 直连 AI 服务商 + 知乎 API，Key 放在扩展的本地配置里（不入库）。省一个进程，但违背 PRD "Backend 层"要求，且 MV3 SW 里做缓存/编排更别扭。

→ 选 A 的话：知乎开放平台的调用凭证（AppKey/Secret 或手册指定的鉴权方式）和 AI 模型的 API Key 需要你提供/确认获取方式。**这是我目前最大的外部依赖。**

**确定方案B**

### D3. 权限模型
- **方案 A（推荐）**：保留 `<all_urls>` content script 匹配（保证任意网页选中即触发），但收窄 host_permissions、不申请 tabs/history 等。演示效果最顺。
- **方案 B**：严格按 PRD 最小权限走 activeTab——代价是用户必须先点一次扩展图标授权当前页，"选中即出现深读按钮"的核心体验会打折。
- 我倾向 A + 在 README 里说明权限用途；评审若追问隐私，主动触发原则本身就是答案。

**确定方案A**

### D4. AI 能力来源
- **方案 A（推荐）**：你有现成的 LLM API（如 DeepSeek）→ 后端统一封装"求真/求深/求异"三条分析链路。
- **方案 B**：知乎直答 Agent 承担生成（但它限额 100 次/天且形态未必适配结构化输出）。
- 倾向 A 为主、直答 Agent 作为求真证据源之一（如果接口可用）。

**确定方案A，需要用到直答时才用知乎Agent**
---

## 四、分阶段执行计划

> 原则：先打通端到端骨架（哪怕求真结果很糙），再逐层加厚。每阶段结束都有可手动验证的产物。

### M0 · 重构对齐 PRD 方向（半天） ✅ 已交付（tag m0-selection-sidepanel）
- 删除/封存整页采集模块（按 D1 结论）
- 重写 content script：mouseup/keyup/selectionchange 监听 → 选区 ≥2 字符显示「深读」按钮（getBoundingClientRect 定位、滚动隐藏）
- background 改为 Active Selection 中转：CAPTURE_SELECTION → storage.session → 广播 ACTIVE_SELECTION_UPDATED；chrome.sidePanel.open()
- manifest 更新：sidePanel 权限、side_panel 字段、按 D3 调整权限
- 验收：任意网页选中文字 → 按钮出现 → 点击后 Side Panel 打开并显示选中的那句话（E2E PASS）
- **此阶段完成即 git tag**（符合你的回退习惯）

### M1 · 后端最小可用（半天） ✅ 已交付（tag m1-ai-analyzer，按 D2=B 调整为 SW 直连）
- SW 内 AI 分析链路：`ANALYZE`（mode: truth/deep/differ + claim + title + url）
- DeepSeek 接入 + 三模式 prompt 链路（结构化 JSON 输出、缺字段自动重试）
- Key 从 deepseek_api.key 经 gen-config 注入（gitignored，不入库）；简单内存缓存（query → 结果，防配额击穿）
- 验收：Node 直连 API + 真实 SW 运行时，三种模式均返回合法 JSON（PASS）

### M2 · Side Panel 三 Tab 工作台（1 天） ✅ 已交付（tag m2-workbench）
- 布局：当前内容卡（Claim+来源标题）→ 求真/求深/求异 Tab → 结果区
- 三种结果的 UI：求真=支持程度徽章+证据卡列表+原文↔来源对照块；求深=原理段落+知识树节点+继续探索问题；求异=立场卡片（🟢🟡🔴+文字标注）+认知盲区
- Loading 分步提示 / Error 可重试 / Empty 引导态
- 连续深读：Side Panel 开着时新选区自动更新 Claim 并重分析
- 视觉：克制、知识感、轻量可信；Liquid Glass 元素点缀、深色模式支持（prefers-color-scheme）

### M3 · 知乎开放能力接入（半天～1 天） ✅ 已交付（tag m3-zhihu-pluggable，降级态验证通过）
- datasource.js：知乎搜索 / 全网搜索 HTTP 客户端（Bearer Access Secret 鉴权）
- gen-config 支持可选 zhihu_api.key（兼容旧名 zhihu_access_secret.key）；无凭证自动降级
- 证据来源分层注入 prompt；UI 显示「已核验/未联网核验」+ 检索来源链接
- ⏳ 待凭证到位：放置 key 文件 → 重跑 gen-config → 重载扩展即启用（零代码改动）

### M4 · 打磨与验收（半天～1 天） ✅ 已交付（tag m4-acceptance）
- 对照 PRD 验收链路全流程自测：网页→选中→深读→求真→求深→求异→点知识树节点继续探索（6/6 PASS）
- 边界：过短选区、滚动隐藏、连续深读（storage.onChanged 双通道修复）、Error 态映射
- 性能：seq 丢弃过期响应（新 Claim 到达时旧响应作废）
- README/INSTALL 重写为「求真」的交付文档；DEMO.md 演示脚本

### M5 · 加分项（有余力才做） 🟡 部分完成
- 声明分类路由 ✅（M1 已在 truth prompt 内置：10 类 Claim 分类，观点类提示无需溯源）
- 求深知识树节点点击→作为新 Claim 重新三连探索 ✅（M4 实现，E2E 验证）
- 求真证据置信度的"AI 评估非真值"免责说明展示 ✅（footer + 对照块降级文案）

### V1.5 · 系统主动发现 Claim（依据 v1.5_UPGRADE.md） ✅ 已交付（tags u0~u4，tag v1.5 收尾）
- U0 正文提取与结构化 ✅（extractor.js：章节/段落/句子+offset，nav/footer 过滤，验证 7/7）
- U1 Claim Detection 管线 ✅（claim-detector.js：三分类+类型子类，缓存，双层验证 PASS）
- U2 悬浮球状态机 ✅（orb.js：Idle→Analyzing→Ready/Error，隐私：点击才读正文，缓存秒回 329ms）
- U3 Hover 声明交互 ✅（hover.js：打标+Shadow DOM 提示卡+复用 CAPTURE_SELECTION，验证 5/5）
- U4 本文概览态 ✅（panel.js：声明/观点统计+列表+已核实徽章+返回入口，验证 7/7）
- U5 回归验收 ✅（V1 全链路 8 项 + V1.5 链路 5 项 = 13/13 PASS；DEMO/README 更新）
- 修复：悬浮球入口清空旧 ActiveSelection（本文模式应显示概览而非旧选区，VD3）

### V1.6 · 交互细节优化（2026-08-26 用户反馈） ✅ 已交付（tag v1.6）
- O1 Hover 提示卡体验 ✅（用户反馈：鼠标从句子移到卡片时卡片已消失，无法点击按钮）
  - 根因：mouseleave 立即隐藏 + `host.contains` 不穿透 Shadow DOM（卡片内部 hover 被误判为"离开"）
  - 修复：延迟隐藏 timer 300ms + shadowRoot.contains 卡片保护 + opacity 淡入/淡出动画 + 同句内不跟随定位
- O2 悬浮球尺寸/位置 ✅（用户反馈：按钮过小）：42px→84px（box-sizing 修正精确尺寸），字号 16→30，徽标同步放大，移至左上角
- 验证 9/9 PASS：移动途中卡片不消失 / 进入卡片保持显示 / 按钮可点击 / 离开淡出 / orb 84x84 左上角

### 知乎接入 · 凭证到位正式启用（2026-08-26） ✅
- `zhihu_api.key`（40 chars）配置并生成 generated-config；gen-config 兼容新文件名
- Node 层真实 API 冒烟 7/7：zhihu_search/global_search 鉴权通过、归一化字段完整、坏凭证 20001 正确拒绝
- SW 运行时 E2E 4/4：选区深读 → 求真「已核验」徽章 + 8 条知乎来源链接
- 文档同步（README/DEMO/WORKPLAN）；datasource.js 零改动——M3 可插拔设计直接生效

### 全网搜索接入修复（2026-08-26 用户反馈） ✅
- 诊断：global_search 接口层本已接通，但 ContentType 只是内容形态枚举（全网结果也是 'Answer'），
  UI 按 ContentType 标注导致全网条目全部被误标为「知乎回答」——用户看到"没有全网搜索"
- 修复：datasource 归一化加 origin 字段（zhihu/global）；panel 来源卡按 origin 标注
  （全网 · 回答/文章/网页 vs 知乎回答/知乎文章），卡片标题分组计数「检索来源（知乎站内 N · 全网 M）」
- 验证：mock 层 12/12 PASS（origin 标记/端点/去 em/标注分支防回归）；
  新 key 到位后真实 E2E 7/7 PASS——来源卡「知乎站内 5 · 全网 5」，8 条来源含 3 条全网标注
- 注：期间遭遇平台 30001 频率限制窗口（无 Retry-After 头），用户更换 key 后恢复

---

## 五、风险与应对

| 风险 | 应对 |
|---|---|
| 知乎 API 凭证拿不到/接口不符 | M3 设计为可插拔数据源；降级为纯 LLM 分析并在 UI 明示 |
| 直答 Agent 100 次/天太紧 | 只在演示路径用，其余走缓存 |
| Claim↔Evidence 对照质量差 | prompt 里强制"引用原文片段 vs 来源片段"双槽输出，宁缺毋滥 |
| 48h 内功能范围过大 | M3/M4 可压缩，M5 全砍；M2 结束就已具备完整可演示闭环 |

---

## 六、需要你提供的输入

1. 四个决策点（D1-D4）的结论 //已在原文中答复
2. 知乎开放平台凭证 + 获取方式（或确认暂无，走降级路线）//已在\zhihu-skill中注明
3. LLM API Key（沿用 DeepSeek 项目惯例：项目根 api_key.key + .gitignore）//`deepseek_api.key` // 有缺失的先放占位符，再向我申请。
4. 交付截止时间点（影响 M3/M5 取舍）//自行判断

---

## 七、一句话总结

> 现有仓库是"自动采集整页"的旧方向，PRD 是"用户主动选一句"的新方向——M0 先完成这次转向，M1-M2 搭起后端与 Side Panel 形成最小闭环（此时已可演示），M3 接知乎生态、M4 打磨验收，M5 视余力加亮点。

**请审批：**
- [√] 四个决策点 D1-D4 的选择
- [√] 里程碑顺序与范围取舍是否认可
- [√] 提供第六节所列输入

V1 批准记录：已批准并执行完毕（M0-M4 全部交付）。

---

# V1.5 升级计划（待审批）

> 依据 `v1.5_UPGRADE.md`。核心变化：**从"用户指定 Claim"升级为"系统主动发现 Claim"**。
> 原则：保留现有「选中一句 → 深读 → 三 Tab」闭环不推翻，新增「全文理解 → 声明识别 → 声明级交互」能力。

## V-0 · 升级要点解读（与 V1 的关系）

| 维度 | V1（已交付） | V1.5（新增） |
|---|---|---|
| Claim 来源 | 用户选中一句 | 系统全文分析主动发现 + 用户选中（并存） |
| 触发方式 | 选区「深读」按钮 | 新增「求真」悬浮球（Idle→Analyzing→Ready） |
| AI 调用时机 | 查看即分析 | 全文阶段**只做发现+分类+定位**；用户查看某 Claim 时才走现有三模式链路 |
| 网页读取 | 只读选区文本 | 用户点击悬浮球后读取正文（一次性、显式授权语义，不做后台监听） |
| Side Panel | 三 Tab | 新增「本文概览」态（声明统计列表）→ 点击 Claim 进入现有三 Tab |

**关键架构判断（复用优先）**：
- 现有 `analyzer.js` 三模式链路、缓存、`datasource.js`、Side Panel 三 Tab 状态机**全部复用**；
- 新增的是一条独立管线：正文提取 → 结构化 → 句子切分 → Claim 识别（一次 LLM 调用）→ Claim 索引（storage.session）→ Hover 交互层；
- V1 的 ActiveSelection 流程原样保留（升级要求 §6：不得删除或破坏）。

## V-1 · 里程碑

### U0 · 正文提取与结构化（content script 侧，纯本地，无 LLM）（半天）
- 新增 `src/core/content-script/extractor.js`：DOM → 正文提取（main/article 优先，剔除 nav/aside/footer/script）→ 章节（h1-h4 分组）→ 段落 → 句子切分（中英文句边界）
- 数据模型：`Document{title,url} → Section → Paragraph → Sentence{id, text, sectionPath, charOffset}`（升级要求 §5）
- 句子级 offset 记录，为 Claim↔网页映射（§2.4）打底
- 验收：对测试页与一篇真实文章提取出正确结构（章节数/段落数/句子数合理，offset 可回定位）
- **完成即 git tag**（回退点）

### U1 · Claim Detection 管线（SW 内一次 LLM 调用）（半天～1 天）
- 新增 `src/core/ai/claim-detector.js`：句子数组 → 一次 DeepSeek 调用 → 每句分类：可验证声明/主观观点/非声明；可验证声明再分：事实/数字/因果/比较/预测/定义/其他
- 输出即 Claim Index：`{id, text, type, verifiable, sentenceId, position}`（§5 数据模型）
- prompt 要求：宁缺毋滥（拿不准归为非声明）；批量结构化 JSON 输出 + 现有 extractJson/校验重试机制复用
- Document Analysis 缓存：`storage.session` 按 url+正文哈希缓存（§7：同一页面重复打开优先读缓存）；SW 内存 Map 加速
- **明确不做**：全文阶段不验证任何 Claim、不调用知乎搜索（§4/§7/§10）
- 验收：Node 层直连测试（长文分类结果稳定、JSON 合法）+ 真实 SW 运行时验证

### U2 · 悬浮球 + 状态机（content script）（半天）
- 新增悬浮球 UI（页面右下角，低干扰半透明，Liquid Glass 风格延续）：Idle（求真 logo）→ Analyzing（旋转+进度语义）→ Ready（声明数徽标）→ Error（可重试）
- 点击 → `EXTRACT_DOCUMENT`（本地提取）→ 发 SW `DETECT_CLAIMS` → Ready 后存 Claim Index
- 已分析页面再次点击直接进入 Ready（读缓存，不重复调用 LLM）
- 不影响原网页阅读：fixed 定位、z-index 控制、不拦截页面事件
- 验收：悬浮球三状态切换正确；重复点击走缓存（网络面板无第二次 LLM 请求）

### U3 · Hover 声明交互（content script）（1 天）
- Claim Index 回传 content script 后，按 sentenceId/offset 给对应句子元素打标（`<mark>` 语义或 data 属性 + 轻量下划线样式，**不修改原文文字**，§10）
- mouseover 委托：Hover 命中 Claim 句 → 轻微高亮 + 浮动提示卡（声明类型徽章 + 原句 + [求真][求深][求异] 三按钮）
- 非 Claim 文本 Hover：零处理（§2.5）
- 提示卡按钮 → 复用现有 CAPTURE_SELECTION 消息路径（把该 Claim 文本作为 ActiveSelection payload）→ Side Panel 打开进入三 Tab——**最大化复用，不新建分析入口**
- 性能：mouseover 用 delegation + rAF 节流；提示卡复用深读按钮的定位/隐藏逻辑
- 验收：Hover 命中/不命中两分支正确；点击[求真]进入现有求真流程且结果正确

### U4 · Side Panel「本文概览」态（半天）
- 新增第四状态（在 Empty 与 Claim 工作台之间）：「本文」标题 + 声明统计（🟢充分支持/🟡部分支持/🔴证据不足/⚪主观观点 计数）+ Claim 列表（类型徽章+原句摘要）
- 统计口径：全文阶段只有分类，没有验证结论——列表初始为「待验证」；用户查看过的 Claim 才显示其求真徽章（复用 state.results）
- 点击列表项 → 进入现有 Claim 工作台（等价于 Hover 点击）
- 验收：悬浮球 Ready 后打开面板显示概览；点击 Claim 进入三 Tab 正常

### U5 · 回归 + 验收 + 文档（半天）
- 回归（升级要求 §9.D）：选中→深读、三 Tab、连续深读、Error 态全部不回退（现有 E2E 脚本直接重跑）
- 新链路验收（§9.A/B/C）：悬浮球三态、正文提取结构化、Claim 识别三分类、Hover 映射与触发
- 隐私自查（§8）：仅在点击悬浮球后读取正文；无后台自动分析；无持续监听上传
- DEMO.md 增补 V1.5 演示段（§11 完成标志的 Demo 流程）；README 更新
- **完成即 git tag v1.5**

## V-2 · 技术决策点（需要你确认）

### VD1. Claim 识别的 LLM 用量与截断策略
全文句子可能上百句。建议：**正文截断到前 N 句（N≈120，超出部分提示"仅分析前部"）+ 单次调用**。备选：分批多次调用（慢、贵，但覆盖全）。倾向前者（黑客松演示场景够用）。

### VD2. Hover 高亮的视觉强度
升级要求只说"轻微高亮"。建议：**虚线下划线 + Hover 时浅色底**，不做整句变色块（避免"改造网页"的观感，贴近 PRD 原则 1）。备选：右侧页边距小圆点标记。

### VD3. 「本文概览」的入口优先级
悬浮球 Ready 后打开面板：默认显示「本文概览」还是保持现有 Empty/Claim 逻辑？建议：**有 Claim Index 时默认概览态，点 Claim 或重新选中文字后进入工作台**（概览是 V1.5 的门面，演示价值高）。

## V-3 · 风险与应对

| 风险 | 应对 |
|---|---|
| 正文提取在真实网站质量差（SPA/懒加载/反爬结构） | U0 先在 3~5 个代表性站点人工校验；提取失败时悬浮球 Error 态明示"此页面暂不支持"，不硬塞 |
| 长文 LLM 分类截断丢失后半文 Claim | VD1 截断策略明示边界；演示选文章长度可控 |
| Hover 打标与页面自身样式/脚本冲突 | data 属性 + 非侵入样式；Shadow DOM 提示卡隔离；打标前检测元素可改性 |
| 全文分析被误解为"后台采集"（隐私观感） | 仅点击悬浮球触发 + README/DEMO 明示；悬浮球 Idle 态不读任何内容 |
| 与现有选区流程互相干扰（按钮/悬浮球同屏） | 视觉分区（右下悬浮球 vs 选区旁按钮）；事件处理独立，互不阻塞 |

## V-4 · 工作量与顺序

U0 → U1 → U2 → U3 → U4 → U5，总计约 **3～4 天**。U0/U1 完成即有内部可验证产物；U2 结束可演示"点击悬浮球→发现声明列表"；U3 是体验核心；U4/U5 收尾。若时间紧：U4 可并入 U3 简化（概览只做统计行），U3 的 Hover 提示卡可先只做「求真」单按钮。

## V-5 · 需要你提供的输入

1. VD1-VD3 三个决策点的选择（或"按建议"）//按建议
2. 无新增外部依赖（仍只用 DeepSeek key；知乎凭证到位与否不影响 V1.5）

**请审批：**
- [√] V-0 架构判断（复用现有链路，新增独立 Claim 管线）
- [√] V-1 里程碑拆分与顺序
- [√] V-2 三个决策点
- [√] V-3 风险应对是否认可

批准后我从 U0 开始执行。

---

# V2.0 升级计划（待审批）

> 依据 `v2.0_UPGRADE.md`。核心变化：**从「AI 判断文本是否需要验证」升级为「信息对象识别 → 信源发现 → 证据验证」的信息溯源系统。**
> 产品定位随之升级：不是"AI 帮你判断真假"，而是"AI 帮你从信息中找到可追溯的证据"。
> 原则：保留现有 Chrome Extension、悬浮球、全文扫描、Side Panel、求真/求深/求异及搜索能力，不推翻已有产品闭环。

## T-0 · 升级要点解读（与 V1.6 的关系）

| 维度 | V1.6（已交付） | V2.0（新增） |
|---|---|---|
| 分析起点 | 判断句子"主观/客观" | 先识别**信息对象**（研究报告/数据/政府文件/媒体/观点/修辞…），对象决定处理方式 |
| Claim | 单句孤立判断 | 句子+前后文+段落+章节联合判断；数据模型加 `context/objectType/sourceRequirement` |
| 搜索 | query 直接丢给 searchBoth | **Search Controller**：声明→所需来源类型→关键词→白名单→优先级→API |
| 来源 | 搜索返回即用 | 统一 Source Type 分类（11 类）+ 权威性/相关性/时间/**原始程度**排序 |
| 验证 | AI 单次生成结论（snippet 注入） | **Web Reader 读原文** → 判断支持性 → 提取具体证据；严格区分 存在≠相关≠支持 |
| 结论状态 | 支持/较充分/不足等模糊分级 | **五态严格互斥**：无需验证 / 未找到可靠来源 / 不支持 / 部分支持 / 支持 |
| 求异 | AI 自拟三派立场卡 ❌ | 必须搜真实不同立场资料→读原文→提取观点+URL；找不到就明说，**禁止编造** |
| 双模式 | 扫描/询问共用判断逻辑 | 自动扫描重"可追溯信息"、过滤观点修辞；主动询问才做深入语义判断 |

**关键架构判断（复用优先）**：
- `extractor.js`（结构化+offset）、`datasource.js`（zhihu/global 双通道）、Side Panel 三 Tab 状态机、Hover 层、缓存机制**全部复用**；
- 新增四块：①claim-detector v2（对象识别+上下文 Claim）②`search-controller.js`（白名单/优先级/关键词）③`web-reader.js`（原文抓取+正文抽取）④验证引擎（五态结论+来源排序 prompt）；
- 求真是改造最大的一环：从"一次 LLM 生成"变为"检索→排序→读原文→逐源判定"的多步管线；
- 红线延续：仅用户触发、不做后台监听、不改网页原文。

## T-1 · 里程碑

### N0 · Claim Detection v2：信息对象识别 + 上下文 Claim（1 天）
- claim-detector 改造：输出从「三分类」升级为「信息对象识别（11 类）+ 验证价值判断（有溯源价值/无）+ 核心 Claim 提取」
- Claim 上下文化：当前句 ± 前后句 + 所属段落注入 prompt；数据模型补 `context / objectType / sourceRequirement`
- 过滤规则落地：夸张修辞、情绪表达、无事实意义数字 → 不进 Claim Index（扫描模式不展示普通观点）
- 缓存 key 升级（含 prompt 版本号，避免旧缓存污染）；Node 层直连验证 + SW 运行时验证

### N1 · Search Controller + Source Type 分类器（1～1.5 天）
- 新增 `src/core/ai/search-controller.js`：Claim(+sourceRequirement) → 所需来源类型 → 关键词生成（主查询+补充查询）→ 白名单过滤 → 优先级排序 → 调 datasource（zhihu_search/global_search）
- Source Type 统一分类：11 类枚举（政府机构/科研机构/学术论文/官方组织/权威媒体/专业媒体/商业机构/证券机构/企业官方来源/知乎/其他）
- 来源白名单：四级（优先/允许/低优先级/禁止），V2.0 内置默认表（域名规则种子），预留 storage 覆盖
- 分类策略：域名规则优先（gov/edu/arxiv/知名机构表），不确定的走 LLM 批量兜底（省配额）
- 验收：给定典型 Claim（如"某证券报告称 X"），Controller 能产出正确类型的候选来源列表

### N2 · Web Reader + 来源排序（1～1.5 天）
- 新增 `src/core/content-script/../ai/web-reader.js`（SW 侧）：URL → fetch 原文（扩展已有 `<all_urls>` host permission）→ HTML 转正文文本（轻量抽取：去 nav/script/style，取主体块）→ 截断注入
- 失败降级：反爬/超时 → 明示「未能读取原文」，退回 snippet 级判断并在结果中标注（诚实原则）
- 来源排序：DeepSeek 对候选做综合评分（来源类型+机构权威性+与 Claim 相关性+时间+原始程度），**优先原始来源而非搜索排名**
- Top-N 截断（N≈3）控制后续读原文成本
- 验收：对真实 URL 完成抓取→抽取→排序；不可达 URL 正确降级

### N3 · 证据验证引擎 + 求真改造（1～1.5 天）
- 逐源判定：原文内容 + Claim → 是否支持 + 具体证据引用（区分：存在≠相关≠支持）
- 五态结论严格落库：`not_needed / no_source / unsupported / partial / supported`（不得混用）
- 最终结果结构：{结论, 证据[], 原始URL[], 来源类型[]}；多源综合（多数/权威加权）
- panel 求真 Tab 渲染改造：五态徽章 + 证据卡（引用片段+出处链接）+ 来源可信度展示；所有来源 URL 可点击
- 验收：构造 支持/部分支持/不支持 三类真实案例各一，端到端结论正确

### N4 · 求异真实来源化（半天～1 天）
- 移除 AI 自拟立场卡：改为 搜不同立场资料 → Web Reader 读取 → 提取真实观点（观点+来源 URL+核心依据）
- 找不到可靠不同观点 → 明确空态文案「暂未找到可靠的不同观点」（禁止编造兜底）
- 验收：争议性 Claim 出带 URL 的对立观点；非争议 Claim 出诚实空态

### N5 · 扫描/询问双模式分离（半天）
- 自动扫描（悬浮球）：只做发现+对象分类+定位（维持"不批量验证"红线），列表偏重可追溯信息
- 主动询问（选中/Hover 点击）：完整语义判断 + 溯源链路
- 两条 prompt 分开维护，不复用同一判断逻辑

### N6 · UI/UX：悬浮球 + Claim 定位（半天）
- 悬浮球：自由拖动 + 限制视口内 + storage 记忆位置 + 缩小尺寸/降阴影/调透明度（降视觉侵入）
- Claim ↔ 网页定位闭环：面板点 Claim → scrollIntoView + 高亮对应句段（复用 hover 标记层）
- 概览态适配新数据模型（objectType 徽章、验证价值筛选开关）

### N7 · 回归 + 验收 + 文档（半天）
- 回归（§13）：知乎 API、联网搜索、选区深读、三 Tab、悬浮球全部不回退（现有 E2E 重跑 + 补新断言）
- 验收清单（§13）逐项核对；DEMO 按 §14 完成标志重写；README 更新
- **完成即 git tag v2.0**

## T-2 · 技术决策点（需要你确认）

### TD1. Web Reader 正文抽取的实现方式 ✅ 按建议：自研轻量抽取
### TD2. 来源类型分类的策略 ✅ 按建议：域名规则优先 + LLM 兜底
### TD3. 来源白名单的配置形态 ✅ 按建议：内置默认四级白名单，不做设置 UI
### TD4. 自动扫描是否自动溯源 ✅ 按建议：扫描=发现+分类+定位，溯源由点击触发
### TD5. 悬浮球尺寸 ✅ 用户拍板：**保持 84px 不缩小，位置下移一点**（N6 执行）

## T-3 · 风险与应对

| 风险 | 应对 |
|---|---|
| Web Reader 被反爬/登录墙拦截 | 失败明示降级为 snippet 判断并标注；演示选可抓取站点 |
| 配额消耗激增（每 Claim 多次 LLM+抓取） | 按需触发（TD4）+ 排序后 Top-N 截断 + 全链路缓存复用 |
| 30001 频率限制窗口 | Search Controller 内置节流队列 + 失败退避；演示前预热缓存 |
| 溯源链路延迟长（多步串行） | 分步进度 UI（检索中→读取原文→比对证据）；单步超时上限 |
| 求异常见"找不到不同观点" | 诚实空态即产品行为（升级要求明示），不算缺陷 |
| 改造范围大、周期长 | 里程碑顺序 N0→N7 可裁剪：N5/N6 可压缩，N3 完成即有核心演示价值 |

## T-4 · 工作量与顺序

N0 → N1 → N2 → N3 → N4 → N5 → N6 → N7，总计约 **5～7 天**。
价值释放点：N1 结束即可演示"智能选源"；N3 结束即达成 §14 Demo 主干（识别→提取→选源→读原文→判定→展示）；N4/N5/N6 为完整性与体验收尾。若时间紧：N4 可并入 N3 简化（先只做"求异出真实来源链接"），N6 的拖动可砍。

## T-5 · 需要你提供的输入

1. TD1-TD5 五个决策点的选择（或"按建议"）
2. 无新增外部依赖（仍只用现有 deepseek_api.key + zhihu_api.key；Web Reader 用扩展自身权限抓取）

**请审批：**
- [√] T-0 架构判断（复用现有链路 + 四块新增）
- [√] T-1 里程碑拆分与顺序
- [√] T-2 五个决策点（TD1-TD4 按建议；TD5=保持 84px、下移一点）
- [√] T-3 风险应对
- [√] T-4 工作量预期

V2.0 批准记录：已批准（2026-08-26），开始执行 N0。
