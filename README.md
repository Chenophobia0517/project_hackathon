# 求真 · 深读

基于 Chrome Extension（Manifest V3）的 AI 深度阅读与信息溯源插件。

> 在你正在阅读的任何网页上，从一句话出发——**验证它、理解它，并发现你可能遗漏的观点。**
>
> **V2.5（来源评价）**：从"找到可靠来源"升级为"系统地发现、识别、比较可靠来源"——不仅告诉用户**找到了什么**，还告诉用户**为什么这个来源值得相信，以及它是不是原始证据**。

```text
阅读网页 → 选中一句话 → 点击「深读」→ Side Panel 打开
                                      ├─ 求真：这句话靠谱吗？（证据溯源+来源评价）
                                      ├─ 求深：背后是什么？（原理与知识树）
                                      └─ 求异：还有别的看法吗？（真实不同观点）

阅读网页 → 点击右上角「求」悬浮球 → 全文声明扫描
                                      └─ 本文概览：发现每句有溯源价值的声明，Hover 即问
```

纯静态扩展，零第三方依赖，无构建步骤。加载即用，详见 [INSTALL.md](INSTALL.md)。

## 产品原则

1. **不改造网页本身**：无操作时插件几乎不存在；打标仅包裹原文文字、不改变内容。
2. **用户主动触发**：只分析用户选中的那一句；悬浮球点击才做全文扫描，不做后台监听。
3. **不是聊天机器人**：结构化结果，围绕 Claim 展开。
4. **诚实溯源**：五态结论严格互斥（无需验证/未找到可靠来源/来源不支持/部分支持/支持）；求异只呈现真实来源的不同观点，找不到就明说，不编造。
5. **职责分离**：LLM 只负责理解信息（声明/来源），排序与结论由确定性引擎完成——拒绝"URL→LLM→可信度93"式的黑盒打分。

## 核心能力

### 1. 选中即问（三 Tab 深读）

- **求真**：完整溯源管线——Query Analyzer 判定问题类型 → 多引擎检索 → 读原文比对 → 五态结论 + 逐字引用证据 + 带理由的来源列表
- **求深**：一句话背后的原理、概念与知识树
- **求异**：从真实来源挖掘不同立场（每条带 URL + 原文片段），不再由 AI 编造乐观派/谨慎派

### 2. 全文声明扫描（悬浮球）

- 右上角「求」悬浮球（84px，可拖动、记忆位置）
- 点击后对全文做一次本地结构化提取 + LLM 批量分析：
  - **信息对象识别**（11 类）：事实陈述/数据/研究报告/论文/政府文件/机构信息/媒体报道/人物事件/观点判断/修辞/普通正文
  - **验证价值过滤**：只有值得溯源的声明进入 Claim Index，修辞与情绪被过滤
  - 声明带上下文、来源需求（sourceRequirement）与网页定位偏移
- 分析完成后悬浮球变为 Ready：页面中声明句以**虚线下划线**呈现，Hover 出提示卡（徽章 + 原文 + 三问入口），点击直达深读

### 3. 本文概览态

- Ready 悬浮球再次点击 → Side Panel 打开「本文概览」：可验证声明统计（按对象类型分组）、逐条声明列表
- 点击任意声明 → 进入该声明的三 Tab 深读；「← 本文概览」返回
- 概览项点击同时**回定位网页**：滚动到该声明句并高亮闪烁

### 4. 信息溯源管线 V2.5（求真）

```text
Claim
  ↓ Query Analyzer          问题类型判定：fact/academic/policy/event/data/open
  │                         → 关键词 / 来源偏好 / 时间窗 / 搜索预算 / 单双引擎
  ↓ 多引擎检索               metaso(广泛召回) + Exa(语义召回) + 知乎双通道
  ↓ URL Normalize & Dedup   tracking 清洗 · fragment 剥离 · 协议/www 归一 · 重复合并
  ↓ Trusted Source Registry verified(95) / candidate(60) / unknown(45) / restricted(15)
  │                         来源先验而非准入；未知来源进候选池获得临时评价
  ↓ Source Analyzer (LLM)   来源类型(8类) · 一手/二手/三手 · 所属机构 · 领域 · 引用线索
  ↓ Evidence Clusters       转载识别：「疑似同一原始来源」聚簇——重复转载不冒充独立证据
  ↓ Scoring Engine          六维评分 Authority·Relevance·Originality·Evidence·Expertise·Freshness
  │                         硬过滤先行 · 同簇转载降权 · whyText 一句话解释
  ↓ Web Reader              Top-3 原文抓取与轻量正文抽取（失败降级 snippet 级判断）
  ↓ Verify Engine           逐源判定 存在≠相关≠支持 → 五态结论 + 逐字引用
```

- **智能选源**：sourceRequirement（gov/media/acad…）映射检索策略；问题类型决定预算与单双引擎
- **权威 ≠ 一手**：Authority 与 Originality 分离计分——高权威媒体转载不算原始证据
- **动态预算**：简单事实单路直达，复杂问题多引擎交叉印证；查询级缓存避免重复搜索
- **诚实展示**：来源卡显示类型徽章（✓verified 政府/科研/论文/媒体…）、一手性标记（一手/疑似转载）、whyText 一句话解释；策略降级（外部引擎未配置）时明示

## 隐私

> 我们不读你的网页，只读你主动问的那一句（或你主动点击扫描的那一篇）。

- 选中深读：仅把该句文本、页面标题与 URL 提交给分析服务
- 悬浮球全文扫描：只在**用户点击后**触发；识别结果本地/会话级保存，不批量外发
- 不采集浏览历史、不后台监听、不上报整页内容
- 请求均经 Service Worker 中转（密钥不出前端）；来源分析与会话缓存在本地进行

## 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 会话级保存 Active Selection 与悬浮球位置（`chrome.storage.session`） |
| `sidePanel` | 打开深读侧栏 |
| `tabs` | 概览项点击时定位回当前标签页 |
| `<all_urls>`（host_permissions） | Web Reader 读取来源原文页面 |
| `<all_urls>`（content_scripts） | 让「深读」按钮/悬浮球在任意网页可用 |

## 数据源（可插拔）

| 数据源 | 角色 | 凭证（项目根，已 gitignore） |
|---|---|---|
| DeepSeek（LLM） | 三 Tab 分析、Claim 识别、Query 策略、来源理解、证据判定 | `deepseek_api.key` |
| metaso | 广泛召回引擎 | `metaso_api.key`（端点可经 `metaso_endpoint.txt` 覆盖） |
| Exa | 语义召回引擎 | `exa_api.key` |
| 知乎开放平台 | 站内讨论通道 | `zhihu_api.key`（兼容旧名 `zhihu_access_secret.key`） |

- DeepSeek 为必需；三个检索源均为可选增强，全部缺席时自动降级为知乎通道或纯模型知识分析，UI 明示
- 配置由 `scripts/gen-config.js` 生成到 gitignored 的 `src/core/generated-config.js`

## 目录结构

```
project_hackathon/
├── manifest.json            # MV3 manifest（位于扩展根 = 仓库根，Chrome 要求）
├── src/core/
│   ├── content-script/      # 页面注入：extractor(结构化提取) / orb(悬浮球) / hover(打标+提示卡) / content(选区+深读按钮)
│   ├── background/          # Service Worker：消息路由、Active Selection 持久化、Side Panel 控制
│   ├── ai/                  # 分析链路：
│   │                        #   analyzer(三模式) / claim-detector(v2 对象识别)
│   │                        #   query-analyzer(问题类型→搜索策略) / url-utils(URL规范化去重)
│   │                        #   source-registry(三层可信先验) / source-analyzer(LLM来源理解)
│   │                        #   evidence-graph(转载识别聚簇) / scoring-engine(六维评分排序)
│   │                        #   v25-pipeline(溯源编排) / web-reader(原文抽取)
│   │                        #   verify-engine(五态验证+求异) / search-controller(V2.0选源,兼容路径)
│   │                        #   datasource(metaso/Exa/知乎多引擎可插拔)
│   └── utils/               # 消息类型常量
├── src/sidepanel/           # 深读工作台（三 Tab + 本文概览态 + V2.5 溯源卡）
├── .e2e/                    # 本地端到端验证脚本（开发用，见目录内注释）
├── scripts/gen-config.js    # 凭证 → generated-config.js 生成器
├── v1.5_UPGRADE.md / v2.0_UPGRADE.md / v2.5_UPGRADE.md   # 各版本升级要求
└── WORKPLAN.md              # 迭代计划与交付记录（git tag 对应各里程碑）
```

## 消息流（简化）

```text
[Web Page]
  选区 → content.js ──CAPTURE_SELECTION──▶ background ──storage.session──▶ side panel
  悬浮球点击 → orb.js ──DETECT_CLAIMS────▶ background ──LLM+缓存───────▶ Ready
  声明句 Hover → hover.js 提示卡 ──点击──▶ CAPTURE_SELECTION（复用深读链路）
  概览项点击 → panel.js ──QIUZHEN_LOCATE_CLAIM──▶ hover.js 滚动+高亮
  求真 Tab → panel.js ──ANALYZE(truth)───▶ analyzer ──verifyClaimV25──▶ Query Analyzer
                                            → 多引擎检索 → URL去重 → Registry → 来源分析
                                            → 证据聚簇 → Scoring → Web Reader → verify-engine
                                            ──▶ 五态结论 + 排序来源 + verification
  求异 Tab → panel.js ──DISCOVER_DIFFER─▶ background ──真实对立观点(URL+引用)
```

## 版本历史

| 版本 | 里程碑（git tag） | 内容 |
|---|---|---|
| v1.0 | `m0`~`m4` | 选区捕获 + Side Panel 三 Tab 深读 |
| v1.5 | `u0`~`u4`, `v1.5` | 悬浮球全文扫描、Claim 识别定位、Hover 交互、本文概览 |
| v1.6 | `v1.6` | 交互细节：hover 延迟隐藏+淡入淡出、悬浮球 84px 右上角 |
| v2.0 | `v2.0`（含 hover 修复 `47a6ef9`） | 信息溯源系统：对象识别、智能选源、读原文比对、五态结论、求异真实来源化、悬浮球拖动/定位回网页 |
| v2.5 | `v2.5`（含枚举混用修复 `86f37bf`） | 来源评价系统：Query Analyzer、metaso/Exa 双引擎、Trusted Source Registry、来源分析与一手性识别、证据独立性、六维评分排序 |

## 开发

- 无构建、无依赖；改代码后在 `chrome://extensions` 点扩展刷新 + 刷新测试页即可
- 验证脚本见 `.e2e/`（Node 直连真实 API 的断言套件）；各里程碑行为级验证用 `hermes-verify-*` 脚本（Temp 目录，可复跑）
- 里程碑规划与决策记录见 `WORKPLAN.md`
