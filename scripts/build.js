// 组装可加载扩展目录：node scripts/build.js dev | prod
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = process.argv[2] || 'dev';

if (['dev', 'prod'].indexOf(env) === -1) {
  console.error('Usage: node scripts/build.js <dev|prod>');
  process.exit(1);
}

const dist = path.join(ROOT, 'build', env);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copy(rel) {
  const src = path.join(ROOT, rel);
  const dest = path.join(dist, rel);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log('  copied ' + rel);
  }
}

copy('src/core');
if (env === 'dev') {
  copy('src/debug');
  copy('src/test');
}

const manifestSrc = path.join(ROOT, 'manifest', 'manifest.' + env + '.json');
fs.copyFileSync(manifestSrc, path.join(dist, 'manifest.json'));

console.log('Built [' + env + '] -> ' + dist);
console.log(env === 'prod' ? 'Production build: Debug/Test excluded.' : 'Development build: Core + Debug + Test.');