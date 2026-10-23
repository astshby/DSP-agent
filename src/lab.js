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
    // EXTRA_ACTIONS
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
    // EXTRA_RENDER
  }
  return {connect, render, readOperations:() => operations, reset:() => {operations=[];list();}, loadOperations:ops => {operations=ops;list();}};
})();
