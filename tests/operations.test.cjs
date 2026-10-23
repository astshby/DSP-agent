const test = require('node:test');
const assert = require('node:assert/strict');
const DSP = require('../src/dsp.js');
const task = (values, operations = [], n0 = 0, fs = 1000) => ({schemaVersion:1,input:{kind:'manual',values,n0,sampleRateHz:fs},operations});
const near = (a,b,t=1e-10) => assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('CSV validates selected columns, quoted headers and equal sampling intervals', () => {
  assert.deepEqual(DSP.parseCSV('"time","signal, A"\n1,3\n1.1,4\n1.2,5', {valueColumn:1,timeColumn:0}).values,[3,4,5]);
  near(DSP.parseCSV('t,x\n0,1\n.01,2', {valueColumn:1,timeColumn:0}).sampleRateHz,100);
  assert.deepEqual(DSP.parseCSV('1\n2',{header:false}).values,[1,2]);
  for (const csv of ['t,x\n0,1\n.1,2\n.3,4','t,x\n0,1\n0,2','t,x\n0,','t,x\n0,1,2\n1,3','t,x\n0,NaN']) assert.throws(()=>DSP.parseCSV(csv,{valueColumn:1,timeColumn:0}));
});
test('reverse then shift preserves physical indices and task reproduction', () => {
  const r=DSP.runAnalysis(task([1,2,3],[{type:'transform',gain:2,shift:4,reverse:true}],-1));
  assert.deepEqual(r.signal.values,[6,4,2]); assert.equal(r.signal.n0,3);
  assert.deepEqual(DSP.runAnalysis(r.task),r);
  assert.throws(()=>DSP.runAnalysis(task([1],[{type:'transform',gain:1,shift:0,reverse:'false'}])));
});
