# Web Context Capture（网页阅读上下文捕获模块）

基于 Chrome Extension Manifest V3 的网页阅读上下文捕获模块，作为未来 AI 信息验证系统的基础数据入口。

## 1. 环境安装

- **Node 环境**（必需，仅用于构建脚本）：Node.js ≥ 16.7
  - 验证：\`node -v\`
- **Python 环境**（可选，仅用于本地测试页面静态服务）：Python 3.x
  - 验证：\`python --version\`
- **依赖安装**：本项目零第三方依赖，无需 npm install。

## 2. 构建

\`\`\`bash
node scripts/build.js dev    # 开发版：Core + Debug + Test → build/dev/
node scripts/build.js prod   # 生产版：仅 Core → build/prod/
\`\`\`

## 3. Chrome Extension 加载方式

1. 打开 Chrome 扩展页面：地址栏输入 \`chrome://extensions\`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压扩展**
4. 选择 **开发版本目录 \`build/dev\`**（生产则选 \`build/prod\`）

## 4. Debug 启动方式

1. 加载 \`build/dev\` 后，点击浏览器工具栏中的扩展图标 → 自动打开 **Debug Side Panel**
2. Panel 中可查看：
   - Extension / Content Script / Background 状态
   - 当前页面 Title、URL、Captured Time
   - Total / Visible Paragraph Count
   - 当前 viewport 中的实时文本（含 top/bottom）
   - 数据通信日志（Content Script → Background → Storage 链路）

## 5. 测试页面启动方式

\`\`\`bash
# 在项目根目录执行
python -m http.server 8000
\`\`\`

浏览器访问：**http://localhost:8000/src/test/test-page/test-page.html**

测试页面包含：页面标题、55+ 段落长文、多个数字声明、可滚动内容、点击按钮动态加载、3 秒后自动追加内容。

打开页面后按 F12 → Console 可查看 \`[WCC Test Runner]\` 自检结果。

## 6. 验收标准对照

| 测试 | 操作 | 预期 |
|---|---|---|
| 测试1 | 打开测试页面 | Debug Panel 显示标题、URL、文本数量 |
| 测试2 | 滚动页面 | Visible Paragraph 实时变化 |
| 测试3 | 查看通信日志 | Content Script → Background → Storage 完整链路 |
| 测试4 | 删除 \`src/debug/\` \`src/test/\` 后重新 \`node scripts/build.js prod\` | Core 仍正常运行 |

## 7. 目录结构

\`\`\`
web-context-capture/
├── manifest/            # dev/prod 双 manifest
├── src/
│   ├── core/            # 核心（可独立运行）
│   │   ├── content-script/
│   │   ├── background/
│   │   ├── context-parser/
│   │   └── utils/
│   ├── debug/           # 仅 dev：Side Panel / logger / inspector
│   └── test/            # 仅 dev：测试页面 / mock / 自检脚本
├── scripts/build.js     # 构建脚本
├── build/               # 构建产物（加载扩展选这里）
└── README.md
\`\`\`

**依赖方向**：Test → Debug → Core（单向）。Core 不感知 Debug / Test 的存在。

## 8. 数据流

\`\`\`
Browser Page → Content Script → chrome.runtime.sendMessage(PAGE_CONTEXT_UPDATED)
→ Background Service Worker → chrome.storage.session + 内存变量
→ Debug Side Panel（dev） / 未来 AI 模块
\`\`\`

查询接口：向 Background 发送 \`{ type: "GET_CURRENT_CONTEXT" }\`，返回最近一次页面上下文。
