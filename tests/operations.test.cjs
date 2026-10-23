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

test('linear convolution values, length, support, identity and commutativity', () => {
  const conv=(x,h,n0=0,hn0=0)=>DSP.runAnalysis(task(x,[{type:'convolve',kernel:h,n0:hn0}],n0));
  const r=conv([1,2,1],[1,1,1],-1,-2);
  assert.deepEqual(r.signal.values,[1,3,4,3,1]); assert.equal(r.signal.n0,-3);
  assert.deepEqual(conv([1,2,1],[1]).signal.values,[1,2,1]);
  assert.deepEqual(conv([2,-1],[3,4,5]).signal.values,conv([3,4,5],[2,-1]).signal.values);
  assert.deepEqual(conv([1,1,1,1],[.5,.5]).signal.values,[.5,1,1,1,.5]);
  assert.throws(()=>conv(Array(4096).fill(0),[1,1]),/4096/);
});

test('difference equation normalizes a0 and decomposes zero state plus zero input', () => {
  const run=(x,more={})=>DSP.runAnalysis(task(x,[{type:'difference',b:[2],a:[2,-1],...more}]));
  assert.deepEqual(run([1,0,0,0]).signal.values,[1,.5,.25,.125]);
  const r=run([1,1,1],{yHistory:[2]});
  assert.deepEqual(r.signal.values,[2,2,2]);
  r.signal.values.forEach((v,i)=>near(v,r.analyses[0].zeroState[i]+r.analyses[0].zeroInput[i]));
  assert.deepEqual(run([0],{b:[1,1],a:[1],xHistory:[3],tail:2}).signal.values,[3,0,0]);
  assert.deepEqual(DSP.runAnalysis(r.task),r);
  assert.throws(()=>run([1],{a:[0]}),/a₀/);
  assert.throws(()=>run([1],{yHistory:[1,2]}),/历史/);
  assert.throws(()=>run(Array(1024).fill(1),{a:[1,-10]}),/溢出/);
});

test('DTFT respects negative support, conjugate symmetry and finite convolution theorem', () => {
  const r=DSP.runAnalysis(task([1,2,1],[{type:'convolve',kernel:[.5,.5],n0:-1},{type:'dtft'}],-2));
  const d=r.analyses[0]; assert.ok(d.convolutionError<1e-12);
  d.real.forEach((v,i)=>{near(v,d.real[256-i]);near(d.imag[i],-d.imag[256-i]);});
  near(d.magnitude[128],4);
  const impulse=DSP.runAnalysis(task([1],[{type:'dtft'}],-1)).analyses[0];
  near(impulse.phase[192],Math.PI/2);
  const response=DSP.runAnalysis(task([0],[{type:'response',b:[.5,.5],a:[1]}])).analyses[0];
  near(response.magnitude[128],1); near(response.magnitude[0],0); assert.equal(response.phase[0],null);
  assert.equal(DSP.runAnalysis(task([1],[{type:'response',b:[1],a:[1,-1]}])).analyses[0].magnitude[128],null);
});
