// Freeze an independently runnable weekly delivery. Run only for the current stage.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const stage = Number(process.argv[2]);
const weeks = ['', '', '第六周', '第七周', '第八周', '第九周', '第十周', '第十一周', '第十二周', '第十三周'];
const titles = ['', '', '采样与序列变换', '卷积与 LTI 系统', '差分方程与初始条件', 'DTFT 与频率响应', 'z 变换与第二章结项', 'DFT / FFT 频谱实验', 'FIR / IIR 滤波设计', '离线工作流与本地工具接口'];
if (!weeks[stage]) throw new Error('Delivery must be 2..9');
const pkg = JSON.parse(fs.readFileSync('package.json')); pkg.version = `0.${stage}.0`; pkg.deliveryPath = `self/${weeks[stage]}/index.html`;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/<title>.*?<\/title>/, `<title>DSP 实验台 · ${weeks[stage]}</title>`)
  .replace(/<p class="eyebrow">.*?<\/p>/, `<p class="eyebrow">实验 ${String(stage).padStart(2, '0')} · ${titles[stage]}</p>`)
  .replace(/<h1 id="page-title">.*?<\/h1>/, `<h1 id="page-title">${titles[stage]}</h1>`)
  .replace(/<p class="intro-text">.*?<\/p>/, '<p class="intro-text">从信号输入到处理与解释，每个实验都可以离线复现。</p>')
  .replace(/<div class="version">.*?<\/div>/, `<div class="version"><span>第 ${stage} 次提交 / 第 ${stage + 4} 周</span><strong>v0.${stage}</strong><small>${stage <= 6 ? '第二章 · 信号与系统' : stage === 7 ? '第三、四章 · 频域分析' : stage === 8 ? '第五章 · 数字滤波器' : '综合实验 · 本地工具'}</small></div>`);
fs.writeFileSync('index.html', html);
execFileSync(process.execPath, ['scripts/build-offline.cjs'], {stdio:'inherit'});
