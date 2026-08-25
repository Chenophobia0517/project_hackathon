// 从仓库根的 key 文件生成扩展可加载的配置文件（gitignored，绝不入库）。
// 用法：node scripts/gen-config.js   （key 变更后重跑 + 扩展管理页刷新）
// 凭证文件（均可选，存在才启用对应能力）：
//   deepseek_api.key        —— DeepSeek 分析（必需）
//   zhihu_access_secret.key —— 知乎开放平台搜索/直答（可选，M3）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outFile = path.join(root, 'src', 'core', 'generated-config.js');

function readKey(file, minLen) {
  var p = path.join(root, file);
  if (!fs.existsSync(p)) return null;
  var v = fs.readFileSync(p, 'utf8').trim();
  if (v.length < minLen) {
    console.error('[gen-config] ' + file + ' 内容过短，疑似无效。');
    process.exit(1);
  }
  return v;
}

var deepseekKey = readKey('deepseek_api.key', 20);
if (!deepseekKey) {
  console.error('[gen-config] 未找到 deepseek_api.key —— 请在项目根创建该文件后重试。');
  process.exit(1);
}
var zhihuSecret = readKey('zhihu_access_secret.key', 16); // 可选

var lines = [
  '// 本文件由 scripts/gen-config.js 自动生成，已被 .gitignore 忽略，绝不提交。',
  '// 凭证来源：项目根 deepseek_api.key' + (zhihuSecret ? ' + zhihu_access_secret.key' : '（zhihu_access_secret.key 未配置，知乎数据源禁用）'),
  'globalThis.QIUZHEN_CONFIG = Object.freeze({',
  '  DEEPSEEK_API_KEY: ' + JSON.stringify(deepseekKey) + ',',
  '  DEEPSEEK_BASE_URL: \'https://api.deepseek.com\',',
  '  DEEPSEEK_MODEL: \'deepseek-chat\',',
  '  ZHIHU_ACCESS_SECRET: ' + JSON.stringify(zhihuSecret) + ',',
  '  ZHIHU_API_BASE: \'https://developer.zhihu.com/api/v1/content\'',
  '});',
  ''
];

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log('[gen-config] 已生成', path.relative(root, outFile),
  '(deepseek key:', deepseekKey.length,
  zhihuSecret ? '; zhihu secret: ' + zhihuSecret.length : '; zhihu: 未配置' + ')');
