'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = process.argv[2] || require('../package.json').deliveryPath;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}\n</style>`);
for (const file of ['src/dsp.js', 'src/capabilities.js', 'src/assistant.js', 'src/lab.js', 'src/app.js', 'src/cloud.js']) {
  html = html.replace(`  <script defer src="${file}"></script>\n`, '');
}
// Inline scripts execute after the DOM, including when opened using file://.
const scripts = ['src/dsp.js', 'src/capabilities.js', 'src/assistant.js', 'src/lab.js', 'src/app.js', 'src/cloud.js'].map(file => `<script>\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
html = html.replace('</body>', () => `${scripts}\n</body>`);
if (destination.includes('第十四周')) html=html.replace('data-course-week="15"','data-course-week="14"').replaceAll('第 11 次提交 / 第 15 周','第 10 次提交 / 第 14 周').replaceAll('双模型综合实验','OpenAI 模型实验').replace('实验 11','实验 10');
const output = path.resolve(root, destination);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(`Offline HTML written: ${path.relative(root, output)}`);
