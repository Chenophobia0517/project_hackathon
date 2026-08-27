// 从仓库根的 key 文件生成扩展可加载的配置文件（gitignored，绝不入库）。
// 用法：node scripts/gen-config.js   （key 变更后重跑 + 扩展管理页刷新）
// 凭证文件（均可选，存在才启用对应能力）：
//   deepseek_api.key  —— DeepSeek 分析（必需）
//   zhihu_api.key     —— 知乎开放平台搜索（可选；兼容旧名 zhihu_access_secret.key）
//   metaso_api.key    —— metaso 广泛召回（V2.5 可选；metaso_endpoint.env 可覆盖端点，TQ2）
//   exa_api.key       —— Exa 语义召回（V2.5 可选）
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
var zhihuSecret = fs.existsSync(path.join(root, 'zhihu_api.key'))
  ? readKey('zhihu_api.key', 16)
  : readKey('zhihu_access_secret.key', 16); // 可选（旧文件名兼容）
var metasoKey = fs.existsSync(path.join(root, 'metaso_api.key'))
  ? readKey('metaso_api.key', 8) : null;
var exaKey = fs.existsSync(path.join(root, 'exa_api.key'))
  ? readKey('exa_api.key', 8) : null;

// TQ2：metaso 端点允许用 metaso_endpoint.txt 覆盖（单行 URL），默认用文档中的 playground 地址
var metasoEndpoint = null;
var epFile = path.join(root, 'metaso_endpoint.txt');
if (fs.existsSync(epFile)) {
  var v = fs.readFileSync(epFile, 'utf8').trim();
  if (/^https?:\/\//.test(v)) metasoEndpoint = v;
}

function jstr(v) { return JSON.stringify(v); }

var lines = [
  '// 本文件由 scripts/gen-config.js 自动生成，已被 .gitignore 忽略，绝不提交。',
  '// 凭证来源：项目根 deepseek_api.key' +
    (zhihuSecret ? ' + zhihu_api.key' : '') +
    (metasoKey ? ' + metaso_api.key' : '') +
    (exaKey ? ' + exa_api.key' : ''),
  'globalThis.QIUZHEN_CONFIG = Object.freeze({',
  '  DEEPSEEK_API_KEY: ' + jstr(deepseekKey) + ',',
  '  DEEPSEEK_BASE_URL: \'https://api.deepseek.com\',',
  '  DEEPSEEK_MODEL: \'deepseek-chat\',',
  '  ZHIHU_ACCESS_SECRET: ' + jstr(zhihuSecret) + ',',
  '  ZHIHU_API_BASE: \'https://developer.zhihu.com/api/v1/content\',',
  // V2.5 M1：外部搜索引擎
  '  METASO_API_KEY: ' + jstr(metasoKey) + ',',
  '  METASO_ENDPOINT: ' + jstr(metasoEndpoint || 'https://metaso.cn/search-api/playground') + ',',
  '  EXA_API_KEY: ' + jstr(exaKey) + ',',
  '});',
  ''
];

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log('[gen-config] 已生成', path.relative(root, outFile),
  '(deepseek key:', deepseekKey.length,
  zhihuSecret ? '; zhihu secret: ' + zhihuSecret.length : '; zhihu: 未配置',
  metasoKey ? '; metaso key: ' + metasoKey.length : '; metaso: 未配置',
  exaKey ? '; exa key: ' + exaKey.length : '; exa: 未配置' + ')');
