# 搜索系统 Evidence Targeting & Provenance Tracing 技术改造方案

> 基准版本：2026-08-27 最新搜索系统  
> 用途：交给 Agent 执行的工程改造说明  
> 核心目标：在现有 Exa + Metaso 双核、Zhihu 低配额、八维评分、preferredSources、Top-6 多样性、Evidence Binding 等机制之上，增加“搜索前证据目标决策层”和“搜索后信源追踪层”。

---

## 1. 改造背景与核心判断

当前系统已经较强地解决：

- 搜索结果获取
- 搜索结果相关性评分
- 来源偏好
- 多样性控制
- 证据绑定
- 不可靠证据硬降级

但近期三个问题具有共同根因：

1. 匿名人物（例如“朱女士”）无法可靠判断其对应的具体事件/实体。
2. 大量媒体报道实际上来自同一个上游来源，系统容易把二手转载误认为多个独立证据。
3. 页面已经提供论文原文链接时，系统仍然重新进行语义搜索，可能找到“相关论文”而不是“被实际引用的论文”。

因此，本次改造的核心不是继续简单增加搜索引擎，而是增加：

> **Evidence Targeting Layer**

使系统在真正搜索之前先回答：

- 当前 Claim 是什么？
- 需要验证的 Entity 是什么？
- Entity 属于哪个 Event？
- 目标证据类型是什么？
- 是否已经存在直接来源？
- 应该优先寻找哪一种来源？

搜索完成后，再通过：

> **Provenance Tracing**

回答：

- 当前来源是不是二手报道？
- 它引用了谁？
- 多个媒体是否共同引用同一个上游来源？
- 是否能够继续找到更上游来源？
- 当前找到的是“最早可追踪来源”还是仅仅“一个相关来源”？

---

# 2. 总体架构

```text
User / Page
    ↓
Context Extraction
    ↓
Claim Extraction
    ↓
Claim Classification
    ↓
Entity / Event Detection
    ↓
Entity–Event Resolution
    ↓
Evidence Target
    ↓
Search Strategy / Search Router
    ↓
Exact Source / Preferred Source / Broad Search
    ↓
Exa + Metaso + Zhihu
    ↓
Candidate Pool
    ↓
8-D Scoring
    ↓
Top-6 Diversity
    ↓
Source Classification
    ↓
Evidence Binding
    ↓
┌───────────────────────────────┐
│ Secondary / Media Source?     │
└──────────────┬────────────────┘
               │ YES
               ↓
       Provenance Extraction
               ↓
       Common Source Detection
               ↓
       Upstream Retrieval
               ↓
       Provenance Graph
               ↓
       Upstream Validation
               ↓
       Evidence Binding
               ↓
       Final Synthesis
```

---

# 3. 必须保留的现有机制

本次改造不是推翻现有搜索系统。

以下机制继续保留：

- Exa + Metaso 双核
- Zhihu 低配额
- 中文关键词
- `keywordsEn`
- 官方域名 Query
- 八维评分
- `relevance = 0.20`
- `directness`
- `entity`
- `scope`
- `temporal`
- `preferredSources +8`
- `firstPartyBonus +5`
- 转载识别
- 三级转载分级
- 改标题识别
- 低价值转载 `-6`
- Top-6 多样性验证池
- 同类型来源 ≤3
- Evidence Binding
- 证据不足时硬降级
- 按发布主体分类
- 微信守卫机制

本次改造的目标是让这些机制获得更准确的输入，而不是替代它们。

---

# 4. 新增模块总览

新增：

```text
1. Context Extraction
2. Claim Extraction
3. Claim Classification
4. Entity / Event Detection
5. Entity–Event Resolution
6. Evidence Targeting
7. Search Strategy Router
8. Explicit Source / Link Extraction
9. Academic Exact-Source Mode
10. Provenance Extraction
11. Common Provenance Detection
12. Upstream Source Retrieval
13. Provenance Graph
14. Provenance Confidence
15. Ambiguity State
```

优先级：

### P0

- Context Extraction
- Claim Extraction
- Evidence Targeting
- Explicit Source / Link Extraction
- Academic Exact-Source Mode

### P1

- Entity–Event Resolution
- Provenance Extraction
- Common Provenance Detection
- Upstream Source Retrieval

### P2

- Provenance 纳入评分
- preferredSources 从单纯评分项扩展为路由依据
- Provenance Confidence
- Ambiguity State

---

# 5. Context Extraction

## 5.1 目的

不要仅从页面中抽取一个孤立的搜索关键词。

对于当前 Claim，建立上下文。

### 输入

```text
page_content
article_title
publication_time
url
target_paragraph
surrounding_paragraphs
```

### 输出

```json
{
  "context": {
    "title": "...",
    "publicationTime": "...",
    "paragraph": "...",
    "surroundingText": "...",
    "locationHints": [],
    "organizationHints": [],
    "personHints": [],
    "eventHints": [],
    "timeHints": []
  }
}
```

---

# 6. Claim Extraction

每次检索前先把用户要验证的内容拆成明确 Claim。

例如：

```text
原文：
“朱女士表示，该公司已经停止生产某产品。”
```

不要直接搜索：

```text
朱女士
```

而应该生成：

```json
{
  "claim": "朱女士表示该公司已经停止生产某产品",
  "entities": ["朱女士", "某公司", "某产品"],
  "eventHints": ["停止生产"],
  "targetType": "PERSON_EVENT_CLAIM"
}
```

---

# 7. Claim Classification

统一的 Claim 类型至少包括：

```text
PERSON
PERSON_EVENT
EVENT
PRODUCT
COMPANY
POLICY
STATISTICS
ACADEMIC
ORIGINAL_REPORT
OFFICIAL_DOCUMENT
DATASET
```

例如：

```text
朱女士 → PERSON_EVENT
某论文 → ACADEMIC
国际新闻 → ORIGINAL_REPORT
汽车配置 → PRODUCT
政策内容 → OFFICIAL_DOCUMENT
```

Claim 类型直接决定 Evidence Target 与 Search Strategy。

---

# 8. Entity–Event Resolution

## 8.1 核心问题

必须区分：

> “搜索结果中出现朱女士”

和：

> “搜索结果中的朱女士就是原文所指的朱女士”。

不能仅根据字符串匹配完成实体确认。

---

## 8.2 Target Entity

```json
{
  "entity": {
    "surfaceName": "朱女士",
    "normalizedName": null,
    "entityType": "PERSON",
    "context": {
      "eventHints": [],
      "organizationHints": [],
      "locationHints": [],
      "timeHints": [],
      "otherPeople": []
    }
  }
}
```

---

## 8.3 Candidate Event

先建立候选事件，不允许 LLM 在无证据情况下直接指定最终人物身份。

```json
{
  "candidateEvents": [
    {
      "id": "event_A",
      "description": "...",
      "time": "...",
      "location": "...",
      "organizations": [],
      "people": [],
      "evidence": []
    },
    {
      "id": "event_B",
      "description": "...",
      "time": "...",
      "location": "...",
      "organizations": [],
      "people": [],
      "evidence": []
    }
  ]
}
```

---

## 8.4 Resolution 流程

```text
Target Entity
    ↓
Extract context
    ↓
Generate candidate events
    ↓
Search each candidate
    ↓
Collect evidence
    ↓
Compare:
  entity
  event
  scope
  temporal
  organization
  location
  co-occurring people
    ↓
Resolve / Ambiguous
```

---

## 8.5 状态

必须支持：

```text
RESOLVED
AMBIGUOUS
UNRESOLVED
```

### RESOLVED

有充分证据确认实体与事件绑定。

### AMBIGUOUS

存在多个合理候选，无法达到足够置信度。

### UNRESOLVED

现有检索不足以建立可靠绑定。

**禁止为了生成答案而强行选择一个候选。**

---

# 9. 现有八维评分如何适配

不要删除现有评分，而是改变评分输入对象。

过去：

```text
entity score:
结果有没有出现“朱女士”
```

改为：

```text
entity score:
结果中的人物是否与 Target Entity 相符
```

同理：

### entity

判断实体身份一致性。

### scope

判断是否属于目标 Event。

### temporal

判断时间是否一致。

### directness

判断来源是否直接讨论目标 Claim / Event。

因此八维评分继续存在，但它是在：

> **Evidence Target 已经确定之后**

执行。

---

# 10. Evidence Targeting Layer

这是本次改造的核心。

系统必须在 Search 前生成：

```json
{
  "evidenceTarget": {
    "type": "EXACT_PAPER",
    "claim": "...",
    "entity": "...",
    "event": "...",
    "preferredSources": [],
    "requiredEvidence": [],
    "directSourceAvailable": false,
    "ambiguity": false
  }
}
```

---

# 11. Evidence Target 类型

至少支持：

```text
EXACT_ENTITY
ENTITY_EVENT
EXACT_PAPER
ORIGINAL_REPORT
OFFICIAL_DOCUMENT
OFFICIAL_PRODUCT
PRIMARY_DATA
DATASET
SECONDARY_CORROBORATION
```

---

# 12. Evidence Target 与来源类型映射

| Evidence Target | 优先来源 |
|---|---|
| EXACT_ENTITY | 能唯一确定身份的原始/权威来源 |
| ENTITY_EVENT | 直接涉及该事件的来源 |
| EXACT_PAPER | DOI / 出版商 / 原论文 |
| ORIGINAL_REPORT | 首发媒体 / 通讯社 / 原始报道 |
| OFFICIAL_DOCUMENT | 政府/监管机构/官方文件 |
| OFFICIAL_PRODUCT | 官方产品页/官方技术资料 |
| PRIMARY_DATA | 原始数据库/统计机构 |
| DATASET | 原始数据发布方 |

`preferredSources` 不再只是评分加分项，也作为 Search Router 的输入。

---

# 13. Search Strategy Router

搜索不再只有：

```text
query → search engine
```

而改为：

```text
Evidence Target
    ↓
Search Strategy
```

策略至少分成：

```text
EXACT_SOURCE
PREFERRED_SOURCE
IDENTIFIER_SEARCH
SEMANTIC_SEARCH
BROAD_CORROBORATION
PROVENANCE_SEARCH
```

---

# 14. Explicit Source / Link Extraction

## 14.1 原则

如果页面正文已经提供目标来源：

> **优先使用页面中的显式来源，而不是重新进行宽泛语义搜索。**

例如：

```text
文章
 ↓
“原论文：DOI / URL”
 ↓
提取
 ↓
验证
 ↓
原论文
```

---

## 14.2 Link Extraction 应识别

至少包括：

```text
http / https URL
DOI
arXiv
PubMed ID
论文标题
作者
期刊
会议
官方文件链接
原始报道链接
```

---

## 14.3 Source Priority

统一采用：

```text
Level 0
页面已经直接提供目标原文链接

Level 1
页面明确指出原始来源，但没有直接链接

Level 2
存在 DOI / Paper ID / 唯一标识，可以精确定位

Level 3
Exact Title + Author / Publisher 检索

Level 4
语义搜索

Level 5
寻找相关二手资料
```

在存在 Level 0–2 证据时，不应无理由直接跳到 Level 4/5。

---

# 15. Academic Exact-Source Mode

当：

```text
claimType = ACADEMIC
```

进入 Academic Verification Mode。

## 15.1 搜索优先级

```text
Explicit Paper URL
        >
DOI / Paper Identifier
        >
Exact Title + Author
        >
Publisher
        >
Institutional Repository
        >
Semantic Related Papers
```

## 15.2 禁止的错误路径

不能：

```text
文章提到论文 A
 ↓
搜索“论文主题”
 ↓
找到论文 B
 ↓
认为 B 是原文引用的论文
```

必须证明：

```text
Candidate Paper B
      ↓
Title / Author / DOI / Identifier
      ↓
与目标 Paper A 一致
```

否则只能标记：

```text
RELATED_PAPER
```

而不能标记：

```text
TARGET_PAPER
```

---

# 16. Academic Source Validation

论文匹配至少检查：

```text
DOI
Title
Authors
Journal / Conference
Publication year
Publisher
Identifier
```

匹配优先级：

```text
DOI exact match
>
Unique paper identifier exact match
>
Title + author exact / near-exact
>
Title + journal + year
>
Semantic similarity
```

语义相似只能用于候选发现，不能单独证明“就是目标论文”。

---

# 17. Provenance Tracing

## 17.1 核心原则

搜索结果不是证据链终点。

尤其当来源属于：

```text
MEDIA
SECONDARY_REPORT
AGGREGATOR
REPOST
```

需要判断：

> 它是否存在更上游来源？

---

# 18. Source Classification

候选来源分类：

```text
PRIMARY
SECONDARY
REPOST
AGGREGATOR
OFFICIAL
ACADEMIC_PRIMARY
UNKNOWN
```

---

# 19. Provenance Extraction

读取媒体正文，提取：

### 直接链接

```text
原文链接
Source:
Original:
Read more:
```

### 引用表达

```text
据 Reuters 报道
据 AP 报道
据警方表示
according to ...
reported by ...
```

### 编译/转载表达

```text
本文编译自
综合报道
转载自
翻译自
```

### 原始采访

```text
接受 BBC 采访时
在接受某媒体采访时
```

这些信息进入 Provenance Node。

---

# 20. Provenance Node

```json
{
  "source": {
    "url": "...",
    "publisher": "...",
    "publishedAt": "...",
    "sourceType": "SECONDARY"
  },
  "provenance": {
    "upstreamCandidates": [
      {
        "publisher": "Reuters",
        "relation": "EXPLICIT_CITATION",
        "evidence": "...",
        "url": "..."
      }
    ]
  }
}
```

---

# 21. Provenance Relation 类型

至少支持：

```text
EXPLICIT_LINK
EXPLICIT_CITATION
QUOTED_SOURCE
REPOST
TRANSLATION
COMPILATION
INTERVIEW
OFFICIAL_STATEMENT
INFERRED_COMMON_SOURCE
```

其中：

- `EXPLICIT_LINK` 最高价值
- `EXPLICIT_CITATION` 高价值
- `QUOTED_SOURCE` 高价值
- `REPOST` 高价值
- `INFERRED_COMMON_SOURCE` 必须明确标记为推断

---

# 22. Provenance Graph

```text
Claim
 │
 ├── Media A
 │      │
 │      └── cites → Media D
 │
 ├── Media B
 │      │
 │      └── cites → Media D
 │
 └── Media C
        │
        └── cites → Media D
```

系统应识别：

```text
A ─┐
B ─┼──→ D
C ─┘
```

即：

> 多个看似独立的报道实际上共享同一个上游来源。

---

# 23. Common Provenance Detection

不要简单统计：

```text
A/B/C 三家媒体都报道
```

而应进一步判断：

```text
A → D
B → D
C → D
```

如果成立：

```json
{
  "provenanceCluster": {
    "root": "D",
    "members": ["A", "B", "C"],
    "independence": "SHARED_UPSTREAM"
  }
}
```

A/B/C 不应被计为三个完全独立的一手证据。

---

# 24. Upstream Source Retrieval

发现上游线索后：

```text
Secondary Source
      ↓
Extract upstream clue
      ↓
Search exact upstream
      ↓
Open candidate
      ↓
Verify
      ↓
Add to graph
```

继续追踪直到：

```text
没有新的上游线索
```

或：

```text
达到搜索深度限制
```

或：

```text
已到达 Primary / Official source
```

---

# 25. “最先报道”判定原则

禁止简单使用：

```text
publishedAt 最早 = first reporter
```

因为可能存在：

- 时区差异
- 页面更新时间
- 快讯与正式稿时间差
- 后修改时间
- 社交媒体早于正式文章
- 官方声明早于媒体报道
- 通讯社被其他媒体引用
- 网站时间元数据不一致

因此使用：

> **Earliest Traceable Source**

即：

> 当前证据链中能够被可靠追踪到的最早上游来源。

如果无法证明绝对首发，不得声称“全世界第一个报道”。

---

# 26. Provenance Confidence

建议：

```text
HIGH
MEDIUM
LOW
```

### HIGH

```text
明确原始链接
+
正文明确引用
+
时间关系合理
+
内容一致
```

### MEDIUM

例如：

```text
多个媒体明确指向同一来源
```

但缺少直接原始链接。

### LOW

例如：

```text
仅根据发布时间
仅根据标题相似度
仅根据语义推断
```

LOW 不得被表述为确定的首发来源。

---

# 27. Provenance 与八维评分

不要直接破坏原八维评分结构。

建议：

```text
Base Score
=
现有八维评分
```

新增：

```text
Provenance Adjustment
```

概念上：

```text
Final Evidence Score
=
Base Score
+
Preferred Source Bonus
+
First Party Bonus
+
Provenance Bonus
-
Repost Penalty
```

具体数值保持可配置。

注意：

> Provenance Bonus 不能把二手来源变成一手来源。

---

# 28. 转载来源的独立性修正

如果：

```text
A → D
B → D
C → D
```

则 A/B/C 不能被当成三个完全独立的证据。

记录：

```json
{
  "independence": {
    "status": "SHARED_UPSTREAM",
    "rootSource": "D"
  }
}
```

---

# 29. Top-6 多样性机制升级

现有：

```text
同类型来源 ≤ 3
```

继续保留。

新增：

```text
同一 Provenance Cluster 不应被当作多个独立来源。
```

例如：

```text
A
B
C
D
```

若：

```text
A/B/C → D
```

验证池应尽量：

```text
D
+
其他独立来源
```

而不是：

```text
A
B
C
```

占满验证池。

---

# 30. Evidence Binding 升级

最终绑定：

```text
Claim
 ↓
Target Entity
 ↓
Target Event
 ↓
Evidence
 ↓
Source Type
 ↓
Provenance
 ↓
Confidence
```

推荐：

```json
{
  "claim": "...",
  "target": {
    "entity": "...",
    "event": "..."
  },
  "evidence": {
    "source": "...",
    "sourceType": "PRIMARY",
    "provenance": [],
    "confidence": "HIGH"
  },
  "bindingStatus": "BOUND"
}
```

---

# 31. Hard Validation

最终输出前必须检查：

```text
1. Claim 是否明确？
2. Entity 是否明确？
3. Event 是否明确？
4. Entity–Event 是否已经绑定？
5. Evidence 是否真正支持 Claim？
6. 来源是否一手/二手？
7. 是否存在更上游来源？
8. 多个来源是否其实共享上游？
9. 如果是论文，是否确认是目标论文？
10. 如果有显式原文链接，是否已经优先验证？
```

任意关键项失败时，不应通过语言生成掩盖证据缺口。

---

# 32. Ambiguity Policy

必须允许：

```text
AMBIGUOUS
```

例如：

```text
候选 A：0.61
候选 B：0.58
```

即使 A 略高，也不能直接断言 A。

应继续寻找能够区分二者的证据。

如果达到搜索预算仍无法区分：

```text
AMBIGUOUS
```

并保留候选集合。

---

# 33. Search Budget / Stop Conditions

避免 Provenance Tracing 无限搜索。

建议设置：

```text
maxProvenanceDepth
maxUpstreamCandidates
maxAdditionalSearches
maxPageReads
```

停止条件：

```text
1. 已找到 Primary / Official source
2. 没有新的上游线索
3. 新来源与已有来源重复
4. 连续若干轮没有提高证据质量
5. 达到搜索预算
6. 已达到足够高的 Evidence Confidence
```

---

# 34. 三个问题的目标流程

## 34.1 “朱女士”

```text
原文
 ↓
Claim Extraction
 ↓
Entity = 朱女士
 ↓
Event Hints
 ↓
Candidate Events
 ↓
Search
 ↓
Entity–Event Resolution
 ↓
RESOLVED / AMBIGUOUS / UNRESOLVED
 ↓
八维评分
 ↓
Evidence Binding
```

## 34.2 国际新闻

```text
Claim
 ↓
Search
 ↓
Media A/B/C
 ↓
Source Classification
 ↓
Read body
 ↓
Provenance Extraction
 ↓
A → D
B → D
C → D
 ↓
Common Provenance
 ↓
Retrieve D
 ↓
Validate D
 ↓
Provenance Graph
 ↓
Evidence Binding
```

## 34.3 论文

```text
Article
 ↓
Claim Extraction
 ↓
Academic Target
 ↓
Explicit Link Extraction
 ↓
Found DOI / URL
 ↓
Exact Source Retrieval
 ↓
Paper Validation
 ↓
TARGET_PAPER
```

只有：

```text
Explicit Link = NONE
```

才进入：

```text
DOI / Identifier
 ↓
Exact Title + Author
 ↓
Publisher
 ↓
Semantic Search
```

---

# 35. 新增状态字段建议

```json
{
  "claimType": "...",
  "evidenceTargetType": "...",
  "entityResolutionStatus": "RESOLVED",
  "sourceType": "PRIMARY",
  "provenanceStatus": "TRACED",
  "provenanceConfidence": "HIGH",
  "provenanceClusterId": "...",
  "sourceIndependence": "INDEPENDENT",
  "directSourceAvailable": true,
  "directSourceUsed": true,
  "bindingStatus": "BOUND"
}
```

---

# 36. Source Independence

支持：

```text
INDEPENDENT
SHARED_UPSTREAM
DERIVED
UNKNOWN
```

定义：

### INDEPENDENT

当前来源与其他候选来源没有发现共同上游。

### SHARED_UPSTREAM

多个来源明确指向同一个上游。

### DERIVED

明显改写、翻译、转载或基于另一来源。

### UNKNOWN

没有足够信息判断。

---

# 37. preferredSources 的角色升级

当前：

```text
preferredSources +8
```

继续保留。

同时：

```text
preferredSources
        ↓
Search Routing
```

例如：

```text
ACADEMIC
→ DOI / Publisher

POLICY
→ Government / Regulator

PRODUCT
→ Official Product Page

NEWS
→ Primary Report / Wire Service

STATISTICS
→ Original Dataset
```

因此：

> preferredSources 不再只是评分机制，而是“检索策略的一部分”。

---

# 38. Agent 实现要求

不要一次性重写整个搜索系统。

按照以下顺序增量实现：

### Phase 1

实现：

```text
Context Extraction
Claim Extraction
Evidence Target
Explicit Source Extraction
Search Router
```

先解决“搜索什么”。

### Phase 2

实现：

```text
Academic Exact-Source Mode
```

先解决论文原文遗漏。

### Phase 3

实现：

```text
Entity–Event Resolution
Ambiguity State
```

解决匿名人物。

### Phase 4

实现：

```text
Provenance Extraction
Common Provenance
Upstream Retrieval
Provenance Graph
```

解决媒体共同溯源。

### Phase 5

接入：

```text
Top-6 Diversity
Evidence Binding
8-D Scoring
Hard Validation
```

让新增信息真正进入最终证据选择。

---

# 39. 回归测试要求

## Test A：匿名人物

输入：

```text
一篇包含“朱女士”的文章/网页。
```

要求：

- 不能只搜索“朱女士”
- 必须提取上下文
- 必须生成候选事件
- 必须验证 Entity–Event
- 无法区分时输出 AMBIGUOUS
- 不得强行绑定

## Test B：共同转载

输入：

```text
多个媒体报道同一国际新闻。
```

要求：

- 找到媒体来源
- 读取正文
- 提取引用来源
- 建立 Provenance Graph
- 判断是否共同引用同一上游
- 尽可能追踪到更上游来源
- 不把同一 Provenance Cluster 当作多个独立证据

## Test C：论文原文

输入：

```text
文章正文中已经提供 DOI / 论文 URL。
```

要求：

- 必须先提取链接/DOI
- 必须优先验证目标论文
- 不得先用语义搜索替代
- 找到相关但非目标论文时必须标记 RELATED_PAPER
- 只有确认身份后才能标记 TARGET_PAPER

---

# 40. 验收标准

## Entity–Event

通过条件：

```text
target entity + target event
```

能够被证据明确绑定。

失败时：

```text
AMBIGUOUS / UNRESOLVED
```

而不是错误确定。

## Provenance

通过条件：

```text
secondary source
→ upstream clue
→ upstream source
→ validation
```

能够形成可解释链路。

## Academic

通过条件：

```text
explicit link / DOI
→ exact paper
→ validation
```

成功。

---

# 41. 最终设计原则

## 原则一：先确定“找什么”，再搜索

```text
Context
→ Claim
→ Entity/Event
→ Evidence Target
→ Search
```

## 原则二：搜索结果不是终点

```text
Search
→ Source Classification
→ Provenance
→ Upstream
→ Validation
```

## 原则三：证据不足时允许“不知道”

系统不能为了生成完整答案而：

- 强行绑定匿名人物
- 把相关论文当目标论文
- 把转载媒体当独立一手证据
- 把最早显示时间当成绝对首发
- 用语义相似替代身份确认

---

# 42. 核心闭环

```text
                    ┌──────────────────────┐
                    │   Context / Claim    │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │  Evidence Targeting  │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │   Search Strategy    │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Exa + Metaso + Zhihu │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │  8-D Scoring / Top6  │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Source Classification│
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Provenance Tracing   │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Upstream Validation  │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │  Evidence Binding    │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Hard Validation      │
                    └──────────┬───────────┘
                               ↓
                         Final Synthesis
```

最终目标：

> **前置层解决“应该寻找什么证据”，搜索层解决“有哪些候选证据”，评分层解决“哪个候选更符合目标”，溯源层解决“这些证据究竟来自哪里”，绑定与硬校验解决“最终结论是否真的被证据支持”。**
