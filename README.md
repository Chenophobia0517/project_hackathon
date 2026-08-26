# 求真 · 深读

基于 Chrome Extension（Manifest V3）的 AI 深度阅读插件：

> 在你正在阅读的任何网页上，从一句话出发——**验证它、理解它，并发现你可能遗漏的观点。**
>
> **V1.5**：点击右下角「求」悬浮球，插件还会主动理解全文、发现文中每一句值得验证的声明，Hover 即问。

```text
阅读网页 → 选中一句话 → 点击「深读」→ Side Panel 打开
                                      ├─ 求真：这句话靠谱吗？（证据核对）
                                      ├─ 求深：背后是什么？（原理与知识树）
                                      └─ 求异：还有别的看法吗？（观点与盲区）
```

纯静态扩展，零第三方依赖，无构建步骤。加载即用，详见 [INSTALL.md](INSTALL.md)。

## 产品原则

1. **不改造网页本身**：无操作时插件几乎不存在。
2. **用户主动触发**：只分析用户选中的那一句，不默认采集整页内容。
3. **不是聊天机器人**：结构化结果，围绕 Claim 展开。

## 隐私

> 我们不读你的网页，只读你主动问的那一句。

仅当用户选中文本并点击「深读」后，才会把该句文本、页面标题与 URL 提交给分析服务；不采集整页内容，不上报浏览历史。

## 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 会话级保存当前 Active Selection（`chrome.storage.session`） |
| `sidePanel` | 打开深读侧栏 |
| `<all_urls>`（content_scripts） | 让「深读」按钮在任意网页可用；脚本只监听选择事件，不读取页面内容 |

## 知乎开放能力（可选）

在项目根放置 `zhihu_api.key`（developer.zhihu.com/profile 生成）并重跑 `node scripts/gen-config.js` 后：

- 求真分析前会经知乎开放平台检索站内外相关讨论，注入分析上下文
- 结果底部显示「已核验」标记与可点击的检索来源列表
- 无凭证时自动降级：仅基于模型知识分析，UI 明示「未联网核验」

## 目录结构

```
project_hackathon/
├── manifest.json            # MV3 manifest（位于扩展根 = 仓库根，Chrome 要求）
├── src/core/
│   ├── content-script/      # 页面注入：选区捕获、「深读」按钮
│   ├── background/          # Service Worker：Active Selection 中转、Side Panel 控制
│   ├── ai/                  # 分析链路（DeepSeek 三模式）+ 知乎数据源（可插拔）
│   └── utils/               # 消息类型常量
├── src/sidepanel/           # 深读工作台（三 Tab：求真 / 求深 / 求异）
├── .e2e/                    # 本地端到端验证脚本（开发用，见目录内注释）
└── zhihu-skill/             # 知乎开放平台 Skill 资源包（黑客松提供，非扩展运行依赖）
```

## 数据流

```
Web Page ──选区──▶ Content Script ──CAPTURE_SELECTION──▶ Background Service Worker
                                                            │ chrome.storage.session
                                                            ▼
                                              ACTIVE_SELECTION_UPDATED / GET_ACTIVE_SELECTION
                                                            ▼
                                                      Side Panel 工作台
```
