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

test('z ROC distinguishes left/right inverse and causal stability with delay and cancellation', () => {
  const analyze=op=>DSP.runAnalysis(task([1,2],[op])).analyses[0];
  const p=analyze({type:'zplane',b:[1],a:[1,-.5]});near(p.poles[0].real,.5);assert.equal(p.causalStable,true);
  assert.equal(analyze({type:'zplane',b:[1],a:[1,-1]}).causalStable,false);
  near(analyze({type:'zplane',b:[0,1],a:[1]}).poles[0].real,0);
  assert.equal(analyze({type:'zplane',b:[1,-2],a:[1,-2]}).poles.length,0);
  const pair=analyze({type:'zplane',b:[1],a:[1,0,1]});near(Math.abs(pair.poles[0].imag),1);
  const right=analyze({type:'inverse_z',pole:.5,side:'right'}),left=analyze({type:'inverse_z',pole:.5,side:'left'});
  assert.equal(right.stable,true);assert.equal(left.stable,false);assert.equal(left.values.at(-1),-2);
  assert.equal(analyze({type:'inverse_z',pole:2,side:'left'}).stable,true);
  const z=analyze({type:'zvalue',radius:1,angleDeg:90});near(z.real,1);near(z.imag,-2);
  assert.throws(()=>analyze({type:'zvalue',radius:0,angleDeg:0}));
});

test('FFT agrees with independent direct DFT, calibrated DC, Nyquist, sine and zero padding', () => {
  const analyze=(x,more={},n0=0)=>DSP.runAnalysis(task(x,[{type:'spectrum',method:'fft',window:'rectangular',nfft:32,...more}],n0,32)).analyses[0];
  const x=Array.from({length:32},(_,n)=>2*Math.sin(2*Math.PI*4*n/32)+.25);
  for(const window of ['rectangular','hann','hamming']) {
    const fft=analyze(x,{window}),dft=analyze(x,{window,method:'dft'});
    fft.real.forEach((r,i)=>{near(r,dft.real[i]);near(fft.imag[i],dft.imag[i]);});
    near(fft.amplitude[4],2);near(fft.amplitude[0],.25);
  }
  near(analyze(Array.from({length:32},(_,n)=>3*(-1)**n)).amplitude[16],3);
  near(analyze(x,{nfft:64}).amplitude[8],2);
  assert.equal(analyze(x,{nfft:64}).binSpacing,.5);assert.equal(analyze(x,{nfft:64}).recordSpacing,1);
  near(analyze(x,{},-2).phase[4],0);
  assert.equal(analyze(Array(32).fill(0)).peak,null);
  assert.throws(()=>analyze(x,{nfft:33}),/2 的/);
  assert.throws(()=>analyze(x,{nfft:16}),/不少于/);
});

test('FIR and Butterworth coefficients and full outputs match independent SciPy fixtures', () => {
  const reference=require('./fixtures/filters.json');
  for(const c of reference.cases) {
    const r=DSP.runAnalysis(task(reference.input,[c.operation],0,reference.fs)),design=r.analyses[0];
    c.b.forEach((v,i)=>near(design.b[i],v,1e-12));c.a.forEach((v,i)=>near(design.a[i],v,1e-12));
    c.output.forEach((v,i)=>near(r.signal.values[i],v,1e-11));
    assert.deepEqual(DSP.runAnalysis(r.task),r);
  }
  assert.throws(()=>DSP.runAnalysis(task([1],[{type:'filter',family:'fir',response:'lowpass',cutoffHz:500,taps:31,window:'hamming'}])),/截止/);
  assert.throws(()=>DSP.runAnalysis(task([1],[{type:'filter',family:'fir',response:'lowpass',cutoffHz:100,taps:30,window:'hamming'}])),/奇数/);
});
test('multitone and noise generation are deterministic and preserve normalized task settings', () => {
  const input={kind:'generated',waveform:'multitone',sampleRateHz:32,count:32,n0:0,amplitude:1,offset:0,frequencyHz:2,phaseDeg:0,frequency2Hz:8,amplitude2:.5};
  const r=DSP.runAnalysis({schemaVersion:1,input,operations:[]});near(r.signal.values[1],Math.sin(Math.PI/8)+.5);
  for(const waveform of ['multitone','noise']) {
    const r=DSP.runAnalysis({schemaVersion:1,input:{...input,waveform,seed:42},operations:[]});
    assert.deepEqual(DSP.runAnalysis(r.task),r);
  }
});

test('cross-runtime comparison tolerates rounding and phase branches, rejects structural or numerical errors',()=>{
  assert.equal(DSP.compareResults({values:[1,0],phase:[Math.PI,null]},{values:[1+Number.EPSILON,1e-16],phase:[-Math.PI,null]}).equal,true);
  for(const [a,b] of [[{x:[1]},{x:[1,2]}],[{x:1},{x:1.01}],[{x:null},{x:0}],[{x:Infinity},{x:Infinity}]])assert.equal(DSP.compareResults(a,b).equal,false);
});
