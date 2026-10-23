(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('signal-form');
  let lastResult = null;
  let lastPlotWidth = 0;
  const fields = { waveform: 'sine', frequency: 50, phase: 0, amplitude: 1, offset: 0,
    'sample-rate': 1000, 'sample-count': 64, 'start-index': 0, position: 0, sequence: '1, 2, 1' };
  const format = value => value === 0 ? '0' : Number(value.toPrecision(6)).toString();
  const source = () => form.elements.source.value;

  function updateFields() {
    const manual = source() === 'manual';
    $('generated-fields').hidden = manual;
    $('manual-fields').hidden = !manual;
    $('count-field').hidden = manual;
    const periodic = ['sine', 'cosine'].includes($('waveform').value);
    $('periodic-fields').hidden = !periodic;
    $('position-field').hidden = periodic;
    $('run-button').textContent = manual ? '读取并绘图 →' : '生成并绘图 →';
    $('sampling-help').textContent = manual
      ? '采样率可留空，按下标查看；最多 4096 个样值。'
      : '最多 4096 个样值。采样时间为 t = n / fs。';
  }

  function readTask() {
    const input = { kind: source(), n0: $('start-index').value, sampleRateHz: $('sample-rate').value };
    if (input.kind === 'manual') input.text = $('sequence').value;
    else Object.assign(input, {
      waveform: $('waveform').value, frequencyHz: $('frequency').value, phaseDeg: $('phase').value,
      amplitude: $('amplitude').value, offset: $('offset').value, count: $('sample-count').value, position: $('position').value,
    });
    return { schemaVersion: 1, input, operations: [] };
  }

  function status(message, kind = '') {
    $('status').textContent = message;
    $('status').className = `status ${kind}`;
  }

  function plot(result) {
    const { values, n0, sampleRateHz: fs } = result.signal;
    const time = $('axis-mode').value === 'time' && fs !== null;
    const width = Math.max(240, Math.round($('waveform-plot').getBoundingClientRect().width));
    lastPlotWidth = width;
    const compact = width < 440;
    const height = compact ? 270 : 350, left = compact ? 44 : 66, right = 24, top = 25, bottom = 48;
    $('waveform-plot').setAttribute('viewBox', `0 0 ${width} ${height}`);
    const iw = width - left - right, ih = height - top - bottom;
    let low = Math.min(0, result.metrics.min), high = Math.max(0, result.metrics.max);
    const pad = Math.max((high - low) * 0.13, high === low ? 1 : Number.MIN_VALUE);
    low -= pad; high += pad;
    const x = i => left + (values.length === 1 ? iw / 2 : i * iw / (values.length - 1));
    const y = value => top + (high - value) * ih / (high - low);
    const parts = [`<title id="plot-title">${result.signal.label}时域图</title><desc id="plot-description">共 ${values.length} 个样值，下标从 ${n0} 到 ${n0 + values.length - 1}；${time ? '横轴为秒' : '横轴为离散下标'}。</desc>`];
    for (let i = 0; i <= 4; i++) {
      const v = low + (high - low) * i / 4, yy = y(v);
      parts.push(`<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#e7edf4"/><text x="${left-12}" y="${yy+4}" text-anchor="end" fill="#697e92" font-size="12">${format(v)}</text>`);
    }
    parts.push(`<line x1="${left}" y1="${y(0)}" x2="${width-right}" y2="${y(0)}" stroke="#a6b6c8"/>`);
    const tickCount = Math.min(compact ? 4 : 7, values.length);
    const ticks = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (values.length - 1) / Math.max(1, tickCount - 1))))];
    for (const i of ticks) {
      const value = time ? (n0 + i) / fs : n0 + i;
      parts.push(`<text x="${x(i)}" y="${height-23}" text-anchor="middle" fill="#697e92" font-size="12">${format(value)}</text>`);
    }
    if (values.length <= 128) {
      values.forEach((value, i) => parts.push(`<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(value)}" stroke="#aac3e9" stroke-width="1.4"/><circle cx="${x(i)}" cy="${y(value)}" r="${values.length > 64 ? 2.4 : 3.5}" fill="#285ab2"/>`));
    } else {
      const path = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`).join(' ');
      parts.push(`<path d="${path}" fill="none" stroke="#285ab2" stroke-width="1.8"/>`);
    }
    parts.push(`<text x="${width-right}" y="${height-4}" text-anchor="end" font-size="12" fill="#697e92">${time ? 't / s' : 'n'}</text><text x="17" y="16" fill="#697e92" font-size="12">x[n]</text>`);
    $('waveform-plot').innerHTML = parts.join('');
    $('plot-style-note').textContent = values.length <= 128 ? '竖线和圆点表示离散样值' : '样值较多，以折线连接显示；未抽取数据';
  }

  function render(result) {
    const { signal, metrics, task } = result;
    const fs = signal.sampleRateHz;
    const range = `${signal.n0} … ${signal.n0 + metrics.count - 1}`;
    $('signal-label').textContent = signal.label;
    $('plot-range').textContent = `n = ${range} · ${metrics.count} 个样值`;
    $('axis-mode').querySelector('[value="time"]').disabled = fs === null;
    if (fs === null) $('axis-mode').value = 'index';
    const display = { count: metrics.count, rate: fs === null ? '未设置' : `${format(fs)} Hz`, range,
      mean: format(metrics.mean), rms: format(metrics.rms), p2p: format(metrics.peakToPeak), energy: format(metrics.energy) };
    for (const [key, value] of Object.entries(display)) $(`metric-${key}`).textContent = value;
    $('formula').textContent = signal.formula;
    const explanations = {
      sine: '观察圆点的位置：每个点都是对正弦信号的一次采样。增大频率，或减小采样率，比较相邻样值的变化。',
      cosine: '余弦与正弦可以通过相位联系起来。试着修改相位，并观察 n = 0 附近的样值。',
      impulse: '当 A = 1、D = 0 时，只有 n = k 的样值等于 1，其余为 0。这是移位后的单位脉冲。',
      step: '当 A = 1、D = 0 时，从 n = k 开始的样值为 1，此前为 0。负下标同样是序列的一部分。',
      manual: '输入的第一项位于 n₀，后续每项的下标依次加 1。序列的数值和下标需要一起理解。',
    };
    $('experiment-explanation').textContent = explanations[task.input.waveform || 'manual'];
    $('parameter-summary').textContent = `N = ${metrics.count} · n₀ = ${signal.n0}`
      + (fs === null ? ' · fs 未设置' : ` · fs = ${format(fs)} Hz · Δt = ${format(1 / fs)} s`)
      + (task.input.frequencyHz === undefined ? '' : ` · f = ${format(task.input.frequencyHz)} Hz`);
    $('task-json').textContent = JSON.stringify(task, null, 2);
    $('sample-preview-note').textContent = `显示前 ${Math.min(8, metrics.count)} 项，共 ${metrics.count} 项。`;
    $('samples-body').replaceChildren(...signal.values.slice(0, 8).map((value, i) => {
      const row = document.createElement('tr');
      for (const text of [signal.n0 + i, format(value)]) {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      }
      return row;
    }));
    plot(result);
    status(result.warnings.length ? result.warnings.join(' ') : `已生成 ${metrics.count} 个样值。图形与指标对应本次成功运行的参数。`, result.warnings.length ? 'warning' : '');
  }

  function run() {
    try {
      const result = DSP.runAnalysis(readTask());
      render(result);
      lastResult = result;
    } catch (error) {
      status(`${error.message}${lastResult ? ' 图中保留上次成功运行的结果，尚未应用本次输入。' : ''}`, 'error');
      $('status').focus({ preventScroll: true });
    }
  }

  function preset(name) {
    for (const [id, value] of Object.entries(fields)) $(id).value = value;
    form.elements.source.value = name === 'manual' ? 'manual' : 'generated';
    if (name === 'impulse' || name === 'step') {
      $('waveform').value = name; $('start-index').value = -8; $('sample-count').value = 25;
    } else if (name === 'manual') {
      $('start-index').value = -1; $('sample-rate').value = '';
    }
    $('axis-mode').value = 'index';
    updateFields(); run();
  }

  form.addEventListener('submit', event => { event.preventDefault(); run(); });
  form.addEventListener('input', () => {
    updateFields();
    if (lastResult) status('参数已修改，请点击绘图按钮更新。当前图形与指标仍为上次成功结果。', 'pending');
  });
  $('axis-mode').addEventListener('change', () => { if (lastResult) plot(lastResult); });
  $('reset-button').addEventListener('click', () => preset('sine'));
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => preset(button.dataset.preset)));
  const resizePlot = () => {
    if (lastResult && Math.max(240, Math.round($('waveform-plot').getBoundingClientRect().width)) !== lastPlotWidth) plot(lastResult);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizePlot).observe($('waveform-plot').parentElement);
  else window.addEventListener('resize', resizePlot);
  updateFields(); run();
})();
