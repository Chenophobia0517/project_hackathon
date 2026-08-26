# 求真 · 深读

基于 Chrome Extension（Manifest V3）的 AI 深度阅读与信息溯源插件。

> 在你正在阅读的任何网页上，从一句话出发——**验证它、理解它，并发现你可能遗漏的观点。**
>
> **V2.0（信息溯源）**：不再是"AI 帮你判断真假"，而是"AI 帮你从信息中找到可追溯的证据"——识别信息对象、按声明需求智能选源、读取来源原文做证据比对，输出五态结论与可点击的原始证据链接。

```text
阅读网页 → 选中一句话 → 点击「深读」→ Side Panel 打开
                                      ├─ 求真：这句话靠谱吗？（证据溯源）
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

## 核心能力（V2.0）

### 1. 选中即问（三 Tab 深读）

- **求真**：信息溯源——对象识别 → 智能选源 → 读原文比对 → 五态结论 + 逐字引用证据 + 可点击来源
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

### 4. 信息溯源管线（求真）

```text
Claim ─▶ Search Controller ─▶ Web Reader ─▶ 证据验证引擎 ─▶ 五态结论
         ├ 来源类型识别(11类)   ├ fetch 原文      ├ 逐源判定       ├ 支持
         ├ 四级白名单          ├ 轻量正文抽取     ├ full/partial/  ├ 部分支持
         ├ 权威性+相关性+       └ 失败降级         │ irrelevant/    ├ 来源不支持
         │  新近度综合评分                        │ insufficient/  ├ 未找到可靠来源
         └ 双通道检索(知乎站内+全网)               └ contradict     └ 无需验证
```

- **智能选源**：按声明类型（sourceRequirement）生成针对性关键词；白名单优先级 gov/acad/paper > 普通 > 百科/社区；banned 直接出局
- **读原文做证据比对**：只读 Top-3 候选原文，逐源判定支持程度；引用必须是原文逐字片段（防编造）
- **五态诚实结论**：找不到就说找不到，部分支持不夸大为完全支持

## 隐私

> 我们不读你的网页，只读你主动问的那一句（或你主动点击扫描的那一篇）。

- 选中深读：仅把该句文本、页面标题与 URL 提交给分析服务
- 悬浮球全文扫描：只在**用户点击后**触发；识别结果本地/会话级保存，不批量外发
- 不采集浏览历史、不后台监听、不上报整页内容
- 请求均经 Service Worker 中转（密钥不出前端）

## 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 会话级保存 Active Selection 与悬浮球位置（`chrome.storage.session`） |
| `sidePanel` | 打开深读侧栏 |
| `tabs` | 概览项点击时定位回当前标签页 |
| `<all_urls>`（host_permissions） | Web Reader 读取来源原文页面 |
| `<all_urls>`（content_scripts） | 让「深读」按钮/悬浮球在任意网页可用 |

## 数据源（可插拔）

| 数据源 | 用途 | 凭证 |
|---|---|---|
| DeepSeek（LLM） | 三 Tab 分析、Claim 识别、证据判定 | `deepseek_api.key`（项目根，已 gitignore） |
| 知乎开放平台（可选） | 求真检索（站内+全网双通道） | `zhihu_api.key`（项目根，已 gitignore） |

- 无知乎凭证时自动降级：仅基于模型知识分析，UI 明示「未联网核验」
- 密钥不进前端，仅 Service Worker 内使用；配置由 `scripts/gen-config.js` 生成到 gitignored 的 `src/core/generated-config.js`

## 目录结构

```
project_hackathon/
├── manifest.json            # MV3 manifest（位于扩展根 = 仓库根，Chrome 要求）
├── src/core/
│   ├── content-script/      # 页面注入：extractor(结构化提取) / orb(悬浮球) / hover(打标+提示卡) / content(选区+深读按钮)
│   ├── background/          # Service Worker：消息路由、Active Selection 持久化、Side Panel 控制
│   ├── ai/                  # 分析链路：analyzer(三模式) / claim-detector(v2 对象识别)
│   │                        #          search-controller(选源排序) / web-reader(原文抽取)
│   │                        #          verify-engine(五态验证+求异) / datasource(知乎可插拔)
│   └── utils/               # 消息类型常量
├── src/sidepanel/           # 深读工作台（三 Tab + 本文概览态）
├── .e2e/                    # 本地端到端验证脚本（开发用，见目录内注释）
├── scripts/gen-config.js    # 凭证 → generated-config.js 生成器
├── v1.5_UPGRADE.md          # V1.5 升级要求
├── v2.0_UPGRADE.md          # V2.0 升级要求（信息溯源）
└── WORKPLAN.md              # 迭代计划与交付记录（git tag 对应各里程碑）
```

## 消息流（简化）

```text
[Web Page]
  选区 → content.js ──CAPTURE_SELECTION──▶ background ──storage.session──▶ side panel
  悬浮球点击 → orb.js ──DETECT_CLAIMS────▶ background ──LLM+缓存───────▶ Ready
  声明句 Hover → hover.js 提示卡 ──点击──▶ CAPTURE_SELECTION（复用深读链路）
  概览项点击 → panel.js ──QIUZHEN_LOCATE_CLAIM──▶ hover.js 滚动+高亮
  求真 Tab → panel.js ──VERIFY_CLAIM────▶ background ──search-controller
                                            → web-reader → verify-engine ──▶ 五态结论
  求异 Tab → panel.js ──DISCOVER_DIFFER─▶ background ──真实对立观点(URL+引用)
```

## 版本历史

| 版本 | 里程碑（git tag） | 内容 |
|---|---|---|
| v1.0 | `m0`~`m4` | 选区捕获 + Side Panel 三 Tab 深读 |
| v1.5 | `u0`~`u4`, `v1.5` | 悬浮球全文扫描、Claim 识别定位、Hover 交互、本文概览 |
| v1.6 | `v1.6` | 交互细节：hover 延迟隐藏+淡入淡出、悬浮球 84px 右上角 |
| v2.0 | `v2.0`（含 hover 修复 `47a6ef9`） | 信息溯源系统：对象识别、智能选源、读原文比对、五态结论、求异真实来源化、悬浮球拖动/定位回网页 |

## 开发

- 无构建、无依赖；改代码后在 `chrome://extensions` 点扩展刷新 + 刷新测试页即可
- 验证脚本见 `.e2e/`（Node 直连真实 API 的断言套件）；临时行为级验证用 `hermes-verify-*` 脚本（Temp 目录）
- 里程碑规划与决策记录见 `WORKPLAN.md`
