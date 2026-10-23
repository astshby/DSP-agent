'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = process.argv[2] || require('../package.json').deliveryPath;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}\n</style>`);
for (const file of ['src/dsp.js', 'src/assistant.js', 'src/lab.js', 'src/app.js']) {
  html = html.replace(`  <script defer src="${file}"></script>\n`, '');
}
// Inline scripts execute after the DOM, including when opened using file://.
const scripts = ['src/dsp.js', 'src/assistant.js', 'src/lab.js', 'src/app.js'].map(file => `<script>\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
html = html.replace('</body>', () => `${scripts}\n</body>`);
const output = path.resolve(root, destination);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(`Offline HTML written: ${path.relative(root, output)}`);
