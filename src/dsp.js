/* Pure DSP functions shared by the browser and future Node.js tools. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DSP = api;
})(globalThis, function () {
  'use strict';
  const MAX_SAMPLES = 4096;
  const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

  function number(value, label, { integer = false, optional = false } = {}) {
    if (value === null || value === undefined || String(value).trim() === '') {
      if (optional) return null;
      throw new Error(`${label}不能为空。`);
    }
    const raw = String(value).trim();
    if (!NUMBER.test(raw) || !Number.isFinite(Number(raw))) {
      throw new Error(`${label}必须是有限的十进制数值。`);
    }
    const result = Number(raw);
    if (integer && !Number.isSafeInteger(result)) throw new Error(`${label}必须是安全范围内的整数。`);
    return result;
  }

  function sampleRate(value, optional = false) {
    const fs = number(value, '采样率', { optional });
    if (fs !== null && fs <= 0) throw new Error('采样率必须大于 0 Hz。');
    if (fs !== null && !Number.isFinite(1 / fs)) throw new Error('采样率过小，采样间隔超出数值范围。');
    return fs;
  }

  function parseSequence(raw) {
    let text = String(raw ?? '').trim().replaceAll('，', ',');
    if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1).trim();
    if (!text) throw new Error('请至少输入一个样值。');
    if (/^,|,$|,\s*,/.test(text)) throw new Error('序列中有空样值，请检查连续或首尾逗号。');
    const parts = text.split(/[\s,]+/);
    if (parts.length > MAX_SAMPLES) throw new Error(`当前版本最多支持 ${MAX_SAMPLES} 个样值。`);
    return parts.map((part, i) => number(part, `第 ${i + 1} 个样值`));
  }

  function statistics(values) {
    let sum = 0, energy = 0, min = Infinity, max = -Infinity;
    for (const value of values) {
      sum += value;
      energy += value * value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const metrics = { count: values.length, min, max, mean: sum / values.length,
      rms: Math.sqrt(energy / values.length), energy, peakToPeak: max - min };
    if (Object.values(metrics).some(value => !Number.isFinite(value))) {
      throw new Error('样值幅度过大，无法可靠计算统计量。请减小数值。');
    }
    return metrics;
  }

  function runAnalysis(task) {
    if (!task || task.schemaVersion !== 1 || !task.input) throw new Error('不支持的任务格式。');
    if (!Array.isArray(task.operations) || task.operations.length !== 0) {
      throw new Error('当前版本只支持信号生成与查看，尚未支持处理操作。');
    }
    const input = task.input;
    const n0 = number(input.n0, '首项下标', { integer: true });
    const warnings = [];
    let normalized, values, label, formula;
    if (input.kind === 'manual') {
      values = Array.isArray(input.values)
        ? input.values.map((value, i) => number(value, `第 ${i + 1} 个样值`))
        : parseSequence(input.text);
      if (!values.length || values.length > MAX_SAMPLES) throw new Error(`序列长度必须在 1 到 ${MAX_SAMPLES} 之间。`);
      const fs = sampleRate(input.sampleRateHz, true);
      normalized = { kind: 'manual', values: [...values], n0, sampleRateHz: fs };
      label = '手动离散序列';
      formula = 'x[n] 由输入样值和首项下标确定';
      if (fs === null) warnings.push('未设置采样率：按离散下标 n 查看；使用时间轴前请补充采样率。');
    } else if (input.kind === 'generated') {
      const count = number(input.count, '样本数', { integer: true });
      if (count < 1 || count > MAX_SAMPLES) throw new Error(`样本数必须在 1 到 ${MAX_SAMPLES} 之间。`);
      const fs = sampleRate(input.sampleRateHz);
      const amplitude = number(input.amplitude, '幅值');
      const offset = number(input.offset, '直流偏置');
      const waveform = input.waveform;
      normalized = { kind: 'generated', waveform, sampleRateHz: fs, count, n0, amplitude, offset };
      if (waveform === 'sine' || waveform === 'cosine') {
        const frequencyHz = number(input.frequencyHz, '频率');
        const phaseDeg = number(input.phaseDeg, '相位');
        if (frequencyHz < 0) throw new Error('发生器频率不能小于 0 Hz。');
        Object.assign(normalized, { frequencyHz, phaseDeg });
        const wave = waveform === 'sine' ? Math.sin : Math.cos;
        values = Array.from({ length: count }, (_, i) => amplitude * wave(2 * Math.PI * frequencyHz * (n0 + i) / fs + phaseDeg * Math.PI / 180) + offset);
        label = waveform === 'sine' ? '正弦序列' : '余弦序列';
        formula = `x[n] = A · ${waveform === 'sine' ? 'sin' : 'cos'}(2π f n / fs + φ) + D`;
        if (frequencyHz >= fs / 2) warnings.push('频率达到或超过 fs/2：当前样值可能出现混叠或奈奎斯特点的特殊情况，请勿将图中变化直接视为原始频率。');
      } else if (waveform === 'impulse' || waveform === 'step') {
        const position = number(input.position, '发生位置', { integer: true });
        normalized.position = position;
        values = Array.from({ length: count }, (_, i) => amplitude * (waveform === 'impulse' ? Number(n0 + i === position) : Number(n0 + i >= position)) + offset);
        label = waveform === 'impulse' ? '脉冲序列' : '阶跃序列';
        formula = waveform === 'impulse' ? 'x[n] = A · δ[n − k] + D' : 'x[n] = A · u[n − k] + D';
        if (waveform === 'impulse' && (position < n0 || position > n0 + count - 1)) warnings.push('脉冲位置在当前下标范围之外，窗口内只显示直流偏置。');
      } else throw new Error('不支持的信号类型。');
    } else throw new Error('不支持的信号来源。');

    if (!Number.isSafeInteger(n0 + values.length - 1)) throw new Error('序列下标超出安全整数范围。');
    if (values.some(value => !Number.isFinite(value))) throw new Error('参数过大，生成了非有限数值，请减小参数。');
    const fs = normalized.sampleRateHz;
    if (fs !== null && (!Number.isFinite(n0 / fs) || !Number.isFinite((n0 + values.length - 1) / fs))) {
      throw new Error('采样率与下标组合超出时间轴数值范围。');
    }
    return {
      task: { schemaVersion: 1, input: normalized, operations: [] },
      signal: { values, n0, sampleRateHz: fs, label, formula },
      metrics: statistics(values), warnings,
    };
  }
  return Object.freeze({ MAX_SAMPLES, parseSequence, runAnalysis });
});
