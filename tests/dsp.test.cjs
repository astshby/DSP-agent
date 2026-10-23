'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAnalysis, parseSequence } = require('../src/dsp.js');
const generated = overrides => ({ schemaVersion: 1, input: { kind: 'generated', waveform: 'sine',
  sampleRateHz: 8, count: 8, n0: 0, frequencyHz: 1, phaseDeg: 0, amplitude: 1, offset: 0, ...overrides }, operations: [] });
const manual = overrides => ({ schemaVersion: 1, input: { kind: 'manual', text: '1, 2, 1', n0: -1,
  sampleRateHz: null, ...overrides }, operations: [] });
const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('one period of sine has the expected quarter-cycle samples and energy', () => {
  const result = runAnalysis(generated());
  [0, 1, 0, -1].forEach((value, i) => close(result.signal.values[i * 2], value));
  close(result.metrics.energy, 4); close(result.metrics.rms, Math.SQRT1_2); close(result.metrics.mean, 0);
});
test('phase, amplitude, offset and absolute negative indices affect the samples', () => {
  const result = runAnalysis(generated({ count: 3, n0: -2, amplitude: 2, offset: 3, phaseDeg: 90 }));
  [3, 3 + Math.SQRT2, 5].forEach((value, i) => close(result.signal.values[i], value));
});
test('cosine begins at its amplitude and respects the phase convention', () => {
  const result = runAnalysis(generated({ waveform: 'cosine', count: 4 }));
  close(result.signal.values[0], 1); close(result.signal.values[2], 0);
});
test('shifted impulse and step use sequence indices, not array positions', () => {
  assert.deepEqual(runAnalysis(generated({ waveform: 'impulse', n0: -2, count: 5, position: -1 })).signal.values, [0, 1, 0, 0, 0]);
  assert.deepEqual(runAnalysis(generated({ waveform: 'step', n0: -2, count: 5, position: 0 })).signal.values, [0, 0, 1, 1, 1]);
});
test('an impulse outside the observation window produces zero values and a warning', () => {
  const result = runAnalysis(generated({ waveform: 'impulse', count: 3, position: 10 }));
  assert.deepEqual(result.signal.values, [0, 0, 0]); assert.equal(result.warnings.length, 1);
});
test('manual data needs no sample rate and retains its indices and statistics', () => {
  const result = runAnalysis(manual());
  assert.deepEqual(result.signal.values, [1, 2, 1]); assert.equal(result.signal.n0, -1);
  assert.equal(result.signal.sampleRateHz, null); assert.equal(result.metrics.energy, 6);
  close(result.metrics.rms, Math.sqrt(2)); close(result.metrics.mean, 4 / 3);
  assert.deepEqual(runAnalysis(result.task), result);
});
test('manual sequence parsing supports decimal scientific notation and Chinese separators', () => {
  assert.deepEqual(parseSequence('[1， -2.5 3e-2\n+.5]'), [1, -2.5, 0.03, 0.5]);
  for (const text of ['', '[]', '1,,2', ',1', '1,', '1,wat', '1,Infinity', '1,0x10', '<script>', '1e999']) {
    assert.throws(() => parseSequence(text), Error, text);
  }
});
test('sampling at and above Nyquist remains available as an explicit warning experiment', () => {
  assert.equal(runAnalysis(generated({ frequencyHz: 4 })).warnings.length, 1);
  const aliased = runAnalysis(generated({ frequencyHz: 7 })).signal.values;
  const base = runAnalysis(generated()).signal.values;
  aliased.forEach((value, i) => close(value, -base[i]));
});
test('reject invalid counts, indices, sampling rates, values, and unknown operations', () => {
  for (const change of [{ count: 0 }, { count: 1.5 }, { count: 4097 }, { count: '' }, { sampleRateHz: 0 },
    { sampleRateHz: '' }, { sampleRateHz: -1 }, { sampleRateHz: Number.MIN_VALUE }, { n0: '' }, { n0: 0.5 }, { n0: Number.MAX_SAFE_INTEGER },
    { amplitude: Infinity }, { waveform: 'unknown' }, { frequencyHz: -1 }, { phaseDeg: '' }]) {
    assert.throws(() => runAnalysis(generated(change)), Error);
  }
  assert.throws(() => runAnalysis(manual({ sampleRateHz: 0 })), /采样率/);
  assert.throws(() => runAnalysis(manual({ values: [] })), /长度/);
  assert.throws(() => runAnalysis(manual({ values: [''] })), /不能为空/);
  assert.throws(() => runAnalysis(manual({ text: '1e200' })), /幅度过大/);
  assert.throws(() => runAnalysis({ ...generated(), operations: [{ type: 'fft' }] }), /尚未支持/);
});
test('one-sample, maximum-length and zero signals stay finite', () => {
  assert.equal(runAnalysis(generated({ count: 1 })).metrics.count, 1);
  assert.equal(runAnalysis(generated({ count: 4096 })).metrics.count, 4096);
  const result = runAnalysis(manual({ text: '0 0 0' }));
  assert.equal(result.metrics.energy, 0); assert.equal(result.metrics.rms, 0);
});
