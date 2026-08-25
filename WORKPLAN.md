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
- gen-config 支持可选 zhihu_access_secret.key；无凭证自动降级
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
