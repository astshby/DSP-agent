/* UI extensions; every experiment ultimately calls DSP.runAnalysis(task). */
const Workbench = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let api, operations = [];
  const number = id => $(id).value;
  const node = (tag, text, className) => {
    const e = document.createElement(tag); e.textContent = text;
    if (className) e.className = className; return e;
  };
  const controls = document.createElement('section');
  controls.className = 'card workbench-controls';
  controls.innerHTML = `<h2>处理与实验</h2><p class="field-help">操作按加入顺序执行。清空后恢复原始信号。</p>
    <details open><summary>序列变换</summary><div class="field-pair"><label>增益<input id="op-gain" type="number" value="1" step="any"></label><label>移位 k<input id="op-shift" type="number" value="0" step="1"></label></div>
    <label class="check-label"><input id="op-reverse" type="checkbox"> 先反折，再移位</label><button type="button" id="add-transform">加入变换</button></details>
    <details><summary>线性卷积 / FIR 系统</summary><label>冲激响应 h[n]<input id="conv-kernel" value="1, 1, 1"></label><label>h 的首项下标<input id="conv-n0" type="number" value="0" step="1"></label><button type="button" id="add-convolve">加入线性卷积</button><p class="field-help">观察单位脉冲与阶跃输入的输出；卷积保留完整尾部。有限窗口外按零处理。</p></details>
    <details><summary>差分方程与初始条件</summary><label>分子 b₀, b₁, …<input id="diff-b" value="1"></label><label>分母 a₀, a₁, …<input id="diff-a" value="1, -0.5"></label><label>输入历史 x[n₀−1], x[n₀−2], …<input id="diff-x" placeholder="留空表示零"></label><label>输出历史 y[n₀−1], y[n₀−2], …<input id="diff-y" placeholder="留空表示零"></label><label>末尾补零项数<input id="diff-tail" type="number" min="0" value="0"></label><button type="button" id="add-difference">加入差分系统</button><p class="field-help">系数按延迟 z⁻¹ 升幂排列；这是按历史值向前递推的因果实现。零输入响应包含窗口前输入历史的贡献。</p></details>
    <details><summary>DTFT 与系统频率响应</summary><button type="button" id="add-dtft">分析当前序列 DTFT</button><label>系统分子 b<input id="response-b" value="0.5, 0.5"></label><label>系统分母 a<input id="response-a" value="1"></label><button type="button" id="add-response">查看 H(eʲω)</button><p class="field-help">在 −π 到 π 的 257 个点求和。零幅度附近相位留空；相位为主值，未展开。</p></details>
    <details><summary>z 变换 / ROC / 零极点</summary><label>系统分子 b（最高二阶）<input id="z-b" value="1"></label><label>系统分母 a<input id="z-a" value="1, -0.5"></label><button type="button" id="add-zplane">查看零极点与因果 ROC</button>
    <label>典型 X(z)=1/(1−p z⁻¹) 的实极点 p<input id="z-pole" type="number" value="0.5" step="any"></label><label>选择 ROC / 序列方向<select id="z-side"><option value="right">右边：|z| &gt; |p|</option><option value="left">左边：|z| &lt; |p|</option></select></label><button type="button" id="add-inverse">显示典型逆 z 变换</button>
    <div class="field-pair"><label>z 的模<input id="z-radius" type="number" value="1" step="any"></label><label>辐角 / °<input id="z-angle" type="number" value="90" step="any"></label></div><button type="button" id="add-zvalue">当前有限序列的 X(z)</button></details>
    <!-- EXTRA_CONTROLS -->
    <ol id="operation-list"></ol><button type="button" id="clear-operations">清空处理步骤</button>`;
  document.querySelector('.controls').after(controls);
  // Keep signal setup and operations in a single left column.
  const column = document.createElement('div'); column.className = 'input-column';
  const inputCard = document.querySelector('.controls'); inputCard.before(column); column.append(inputCard, controls);
  const csv = document.createElement('details'); csv.className = 'csv-import';
  csv.innerHTML = `<summary>导入 CSV 文件</summary><p class="field-help">UTF-8、逗号分隔、最多 4096 行 / 1 MiB。列号从 1 开始。时间列单位为秒，必须等间隔；导入后以 n₀/fs 为时间原点。</p>
    <label>CSV 文件<input id="csv-file" type="file" accept=".csv,text/csv"></label>
    <div class="field-pair"><label>数值列<input id="csv-value" type="number" min="1" value="1"></label><label>时间列（可空）<input id="csv-time" type="number" min="1"></label></div>
    <label class="check-label"><input id="csv-header" type="checkbox" checked> 首行为表头</label><button type="button" id="import-csv">读取 CSV</button>`;
  $('manual-fields').after(csv);
  const analyses = document.createElement('article'); analyses.className = 'card analysis-card'; analyses.id = 'analyses';
  document.querySelector('.task-details').before(analyses);

  function list() {
    $('operation-list').replaceChildren(...operations.map(op => node('li', JSON.stringify(op))));
  }
  function add(op) {
    if (operations.length >= 8) throw new Error('最多 8 个处理步骤，请先清空。');
    const next = [...operations, op];
    const task = api.readTask(); task.operations = next;
    api.runTask(task);
  }
  function action(id, fn) {
    $(id).addEventListener('click', async () => {
      try { await fn(); } catch (error) { api.status(`${error.message} 当前结果保持不变。`, 'error'); }
    });
  }
  function connect(controller) {
    api = controller;
    action('add-transform', () => add({type:'transform', gain:number('op-gain'), shift:number('op-shift'), reverse:$('op-reverse').checked}));
    action('clear-operations', () => { operations = []; list(); api.run(); });
    action('import-csv', async () => {
      const file = $('csv-file').files[0];
      if (!file) throw new Error('请先选择 CSV 文件。');
      if (file.size > 1024 * 1024) throw new Error('CSV 文件不能超过 1 MiB。');
      const parsed = DSP.parseCSV(await file.text(), {valueColumn:Number(number('csv-value')) - 1, timeColumn:number('csv-time') === '' ? null : Number(number('csv-time')) - 1, header:$('csv-header').checked});
      api.runTask({schemaVersion:1,input:{kind:'manual',values:parsed.values,n0:0,sampleRateHz:parsed.sampleRateHz ?? $('sample-rate').value},operations:[]});
      if (parsed.timeStart !== null) api.status(`已导入 ${parsed.values.length} 项，fs = ${parsed.sampleRateHz} Hz。原时间首项 ${parsed.timeStart} s 已平移至 0 s。`, 'warning');
    });
    action('add-convolve', () => add({type:'convolve',kernel:number('conv-kernel'),n0:number('conv-n0')}));
    action('add-difference', () => add({type:'difference',b:number('diff-b'),a:number('diff-a'),xHistory:number('diff-x'),yHistory:number('diff-y'),tail:number('diff-tail')}));
    action('add-dtft', () => add({type:'dtft'}));
    action('add-response', () => add({type:'response',b:number('response-b'),a:number('response-a')}));
    action('add-zplane', () => add({type:'zplane',b:number('z-b'),a:number('z-a')}));
    action('add-inverse', () => add({type:'inverse_z',pole:number('z-pole'),side:number('z-side')}));
    action('add-zvalue', () => add({type:'zvalue',radius:number('z-radius'),angleDeg:number('z-angle')}));
    // EXTRA_ACTIONS
  }

  function polePlot(item) {
    const radius=Math.max(1.3,...[...item.zeros,...item.poles].map(p=>Math.hypot(p.real,p.imag)*1.3));
    const scale=100/radius,x=v=>150+v*scale,y=v=>130-v*scale;
    const parts=[`<circle cx="150" cy="130" r="${scale}" fill="none" stroke="#bdcbd8" stroke-dasharray="4 4"/><path d="M25 130H275M150 5V255" stroke="#bdcbd8"/>`];
    item.zeros.forEach(p=>parts.push(`<circle cx="${x(p.real)}" cy="${y(p.imag)}" r="5" fill="none" stroke="#287d76" stroke-width="2"/>`));
    item.poles.forEach(p=>parts.push(`<path d="M${x(p.real)-5} ${y(p.imag)-5}l10 10m-10 0l10 -10" stroke="#ae4949" stroke-width="2"/>`));
    parts.push(`<text x="275" y="145" font-size="12">Re</text><text x="155" y="14" font-size="12">Im</text><text x="${x(1)}" y="146" font-size="11">1</text>`);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 300 270');svg.style.maxHeight='270px';svg.setAttribute('role','img');svg.setAttribute('aria-label','零极点图：圆圈为零点，叉号为极点，虚线为单位圆');svg.innerHTML=parts.join('');analyses.append(svg);
    table(['类型','实部','虚部'],[...item.zeros.map(p=>['零点',p.real,p.imag]),...item.poles.map(p=>['极点',p.real,p.imag])]);
  }
  function chart(xs,ys,xLabel,yLabel) {
    const finite=ys.filter(v=>v!==null&&Number.isFinite(v));
    if (!finite.length) {analyses.append(node('p','当前频率点无有限响应。'));return;}
    const lo=Math.min(0,...finite), hi=Math.max(0,...finite), span=hi-lo||1;
    const x=i=>48+500*i/Math.max(1,xs.length-1),y=v=>22+140*(hi-v)/span;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 590 205');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${yLabel} 对 ${xLabel}`);
    let drawing='',active=false;
    ys.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){active=false;return;}drawing+=`${active?'L':'M'}${x(i)},${y(v)} `;active=true;});
    const parts=[`<path d="${drawing}" fill="none" stroke="#287d76" stroke-width="1.8"/>`];
    [0,.5,1].forEach(f=>{const i=Math.round((xs.length-1)*f);parts.push(`<text x="${x(i)}" y="184" text-anchor="middle" font-size="12" fill="#52677c">${Number(xs[i].toPrecision(5))}</text>`);});
    for(const [v,yy] of [[hi,22],[lo,162]])parts.push(`<text x="43" y="${yy}" text-anchor="end" font-size="11" fill="#52677c">${Number(v.toPrecision(3))}</text>`);
    svg.innerHTML=parts.join('');analyses.append(node('p',`${yLabel} · ${xLabel}`),svg);
  }
  function table(headings, rows) {
    const table = document.createElement('table'); const head = document.createElement('tr');
    headings.forEach(h=>head.append(node('th',h))); table.append(head);
    rows.forEach(row=>{const tr=document.createElement('tr'); row.forEach(v=>tr.append(node('td',typeof v==='number'? Number(v.toPrecision(6)):v)));table.append(tr);});
    const wrap=document.createElement('div'); wrap.className='analysis-scroll';wrap.append(table);analyses.append(wrap);
  }
  function render(result) {
    analyses.replaceChildren(node('h2', '实验读数'));
    const source = result.task.input;
    if (source.frequencyHz !== undefined) {
      const ratio = source.frequencyHz / source.sampleRateHz;
      const alias = Math.abs(((ratio + 0.5) % 1 + 1) % 1 - 0.5) * source.sampleRateHz;
      let period = null;
      for (let p = 1; p <= 4096; p++) if (Math.abs(ratio * p - Math.round(ratio * p)) < 1e-10) { period = p; break; }
      analyses.append(node('p', `折叠到 [0, fs/2] 的频率：${alias.toPrecision(6)} Hz；离散基频周期候选：${period ?? '在 4096 项内未找到'}。候选由 f/fs 数值近似求得；零振幅、直流和退化采样可能有更短周期。`));
    }
    analyses.append(node('p', `当前有限窗口能量：${result.metrics.energy.toPrecision(6)}。这不是无限周期信号的总能量；无限非零周期信号通常总能量发散。`));
    if (result.steps.length) analyses.append(node('p', `原始 ${result.original.values.length} 项 → ${result.steps.length} 个操作 → 当前 ${result.signal.values.length} 项；上方时域图与摘要显示最终输出。`));
    for (const item of result.analyses.filter(item=>item.type==='difference')) {
      analyses.append(node('h3','零状态 + 零输入 = 全响应'));
      const rows = item.zeroState.slice(0,8).map((v,i)=>[i,v,item.zeroInput[i],v+item.zeroInput[i]]);
      table(['相对窗口下标','零状态','零输入','全响应'],rows);
      analyses.append(node('p',`零历史冲激响应前 8 项：${item.impulse.slice(0,8).join(', ')}；阶跃响应前 8 项：${item.step.slice(0,8).join(', ')}。仅观察 32 项，有限窗口有界不代表 BIBO 稳定。`));
    }
    for (const item of result.analyses.filter(item=>['dtft','response'].includes(item.type))) {
      analyses.append(node('h3',item.type==='dtft'?'有限序列 DTFT':'系统单位圆上的代数响应'));
      chart(item.omega.map(w=>w/Math.PI),item.magnitude,'ω / π','幅度');
      chart(item.omega.map(w=>w/Math.PI),item.phase,'ω / π','相位 / rad');
      if (item.convolutionError !== null && item.convolutionError !== undefined) analyses.append(node('p',`卷积定理 max |Y − X·H| = ${item.convolutionError.toExponential(3)}（完整有限序列，无 IIR 截断）。`));
      analyses.append(node('p',item.type==='dtft'?'实序列满足 X(−ω)=X*(ω)，幅度偶对称、相位在非零幅度处呈奇对称（允许 2π 分支差）。':'只有 ROC 包含单位圆时，这一代数值才是冲激响应的 DTFT；单位圆极点处留空。'));
    }
    for(const item of result.analyses.filter(item=>['zplane','inverse_z','zvalue'].includes(item.type))) {
      if(item.type==='zplane') {
        analyses.append(node('h3','H(z) 零极点（约去公共因子后）'));
        polePlot(item);
        analyses.append(node('p',`${item.roc}；零状态、因果系统 ${item.causalStable?'BIBO 稳定':'不是 BIBO 稳定'}。约去 ${item.cancelled.length} 对公共零极点（数值容差 1e−9）；约消不代表内部初始状态稳定。`));
      } else if(item.type==='inverse_z') {
        analyses.append(node('h3','同一表达式，不同 ROC'));
        chart(item.values.map((_,i)=>item.n0+i),item.values,'n','逆变换样值');
        analyses.append(node('p',`X(z)=1/(1−${item.pole} z⁻¹)，ROC：${item.roc}。x[n]=${item.side==='right'?'pⁿ u[n]':'−pⁿ u[−n−1]'}；${item.side==='right'?'因果':'反因果'}，${item.stable?'ROC 包含单位圆，绝对可和':'ROC 不包含单位圆，非绝对可和'}。图中只显示 16 项，公式定义无限序列。`));
      } else analyses.append(node('p',`有限序列 X(z)，|z|=${item.radius}、arg z=${item.angleDeg}°：实部 ${item.real.toPrecision(6)}，虚部 ${item.imag.toPrecision(6)}。|z|=1 时等于对应频率的 DTFT。`));
    }
    // EXTRA_RENDER
  }
  return {connect, render, readOperations:() => operations, reset:() => {operations=[];list();}, loadOperations:ops => {operations=ops;list();}};
})();
