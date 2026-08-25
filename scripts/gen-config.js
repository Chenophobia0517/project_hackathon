// 从仓库根的 deepseek_api.key 生成扩展可加载的配置文件（gitignored，绝不入库）。
// 用法：node scripts/gen-config.js   （key 变更后重跑 + 扩展管理页刷新）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const keyFile = path.join(root, 'deepseek_api.key');
const outFile = path.join(root, 'src', 'core', 'generated-config.js');

if (!fs.existsSync(keyFile)) {
  console.error('[gen-config] 未找到 deepseek_api.key —— 请在项目根创建该文件后重试。');
  process.exit(1);
}

const key = fs.readFileSync(keyFile, 'utf8').trim();
if (key.length < 20) {
  console.error('[gen-config] key 文件内容过短，疑似不是有效 API Key。');
  process.exit(1);
}

const content = `// 本文件由 scripts/gen-config.js 自动生成，已被 .gitignore 忽略，绝不提交。
// 凭证来源：项目根 deepseek_api.key
globalThis.QIUZHEN_CONFIG = Object.freeze({
  DEEPSEEK_API_KEY: ${JSON.stringify(key)},
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_MODEL: 'deepseek-chat'
});
`;

fs.writeFileSync(outFile, content, 'utf8');
console.log('[gen-config] 已生成', path.relative(root, outFile), '(key 长度:', key.length + ')');
