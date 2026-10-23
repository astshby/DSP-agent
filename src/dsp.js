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


  function array(value, label) {
    const values = Array.isArray(value) ? value.map(v => number(v, label)) : parseSequence(value);
    if (!values.length || values.length > MAX_SAMPLES) throw new Error(`${label}长度必须在 1 到 ${MAX_SAMPLES} 之间。`);
    return values;
  }

  // A deliberately bounded CSV dialect: comma-separated UTF-8, optional header,
  // quoted fields (including escaped quotes), no embedded newlines.
  function parseCSV(text, { valueColumn = 0, timeColumn = null, header = true } = {}) {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('CSV 文件不能超过 1 MiB。');
    valueColumn = number(valueColumn, '数值列', { integer: true });
    timeColumn = number(timeColumn, '时间列', { integer: true, optional: true });
    if (valueColumn < 0 || (timeColumn !== null && (timeColumn < 0 || timeColumn === valueColumn))) throw new Error('数值列与时间列必须是不同的非负列号。');
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const rows = lines.map((line, index) => {
      const fields = []; let field = '', quoted = false, closed = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (quoted && line[i + 1] === '"') { field += '"'; i++; }
          else if (quoted) { quoted = false; closed = true; }
          else if (!field && !closed) quoted = true;
          else throw new Error(`CSV 第 ${index + 1} 行引号格式错误。`);
        } else if (c === ',' && !quoted) { fields.push(field); field = ''; closed = false; }
        else { if (closed && c.trim()) throw new Error('CSV 引号后存在多余内容。'); field += c; }
      }
      if (quoted) throw new Error('CSV 不支持跨行引号字段。');
      fields.push(field); return fields;
    });
    if (header) rows.shift();
    if (!rows.length || rows.length > MAX_SAMPLES) throw new Error(`CSV 数据必须为 1 到 ${MAX_SAMPLES} 行。`);
    const columns = rows[0].length;
    if (rows.some(row => row.length !== columns) || valueColumn >= columns || (timeColumn !== null && timeColumn >= columns)) throw new Error('CSV 列数不一致或所选列不存在。');
    const values = rows.map((row, i) => number(row[valueColumn], `CSV 第 ${i + 1} 个样值`));
    let sampleRateHz = null, timeStart = null;
    if (timeColumn !== null) {
      if (rows.length < 2) throw new Error('由时间列推算采样率至少需要两个样值。');
      const times = rows.map(row => number(row[timeColumn], 'CSV 时间（秒）'));
      const dt = times[1] - times[0];
      if (!(dt > 0)) throw new Error('CSV 时间必须严格递增。');
      if (times.some((t, i) => i && (!(t > times[i - 1]) || Math.abs((t - times[i - 1]) - dt) > Math.max(dt * 1e-5, Number.EPSILON * Math.max(1, Math.abs(t)) * 8)))) throw new Error('CSV 时间必须等间隔；当前版本不自动重采样。');
      sampleRateHz = sampleRate(1 / dt); timeStart = times[0];
    }
    statistics(values);
    return { values, sampleRateHz, timeStart };
  }

  function processOperations(original, requested) {
    let signal = { ...original, values: [...original.values] };
    const operations = [], steps = [], analyses = [];
    for (const request of requested) {
      if (!request || typeof request !== 'object') throw new Error('处理操作格式错误。');
      let op;
      if (request.type === 'transform') {
        op = { type: 'transform', gain: number(request.gain, '增益'), shift: number(request.shift, '移位', { integer: true }), reverse: request.reverse === true };
        if (request.reverse !== undefined && typeof request.reverse !== 'boolean') throw new Error('反折必须是布尔值。');
        if (op.reverse) { signal.n0 = -(signal.n0 + signal.values.length - 1); signal.values.reverse(); }
        signal.n0 += op.shift;
        signal.values = signal.values.map(v => v * op.gain);
        signal.label = '序列变换结果'; signal.formula = `y[n] = ${op.gain} x[${op.reverse ? '−' : ''}(n − ${op.shift})]`;
      } else if (request.type === 'convolve') {
        op = {type:'convolve', kernel:array(request.kernel, '冲激响应'), n0:number(request.n0, '响应首项下标', {integer:true})};
        signal.values = convolution(signal.values, op.kernel);
        signal.n0 += op.n0; signal.label = '线性卷积输出'; signal.formula = 'y[n] = Σ x[k] h[n − k]；输入与 h 在窗口外按零处理';
      } else if (request.type === 'difference') {
        op = {type:'difference', ...coefficients(request.b,request.a), xHistory:history(request.xHistory), yHistory:history(request.yHistory), tail:number(request.tail ?? 0,'补零尾部', {integer:true})};
        if (op.tail < 0 || signal.values.length + op.tail > MAX_SAMPLES) throw new Error('补零尾部必须非负且总长度不能超过 4096。');
        if (op.xHistory.length > op.b.length - 1 || op.yHistory.length > op.a.length - 1) throw new Error('历史值数量不能超过相应差分阶数。');
        const x = [...signal.values,...Array(op.tail).fill(0)];
        const zeroState = difference(x,op.b,op.a,[],[]);
        const zeroInput = difference(Array(x.length).fill(0),op.b,op.a,op.xHistory,op.yHistory);
        signal.values = difference(x,op.b,op.a,op.xHistory,op.yHistory);
        signal.label = '差分方程输出'; signal.formula = 'a₀ y[n] = Σ bₖ x[n−k] − Σₖ≥₁ aₖ y[n−k]；按给定历史值递推';
        analyses.push({type:'difference',b:op.b,a:op.a,zeroState,zeroInput,
          impulse:difference([1,...Array(31).fill(0)],op.b,op.a,[],[]),step:difference(Array(32).fill(1),op.b,op.a,[],[])});
      } else if (request.type === 'dtft') {
        op = {type:'dtft'};
        const spectrum = dtft(signal.values, signal.n0);
        let convolutionError = null;
        const previous = operations.at(-1);
        if (previous?.type === 'convolve') {
          const before = steps.length > 1 ? steps.at(-2).signal : original;
          const x = dtft(before.values,before.n0), h = dtft(previous.kernel,previous.n0);
          convolutionError = Math.max(...spectrum.real.map((r,i)=>Math.hypot(r-(x.real[i]*h.real[i]-x.imag[i]*h.imag[i]),spectrum.imag[i]-(x.real[i]*h.imag[i]+x.imag[i]*h.real[i]))));
        }
        analyses.push({type:'dtft',...spectrum,convolutionError});
      } else if (request.type === 'response') {
        op = {type:'response',...coefficients(request.b,request.a)};
        analyses.push({type:'response',...frequencyResponse(op.b,op.a)});
      } else if (request.type === 'zplane') {
        op = {type:'zplane',...coefficients(request.b,request.a)};
        analyses.push({type:'zplane',...poleZero(op.b,op.a)});
      } else if (request.type === 'inverse_z') {
        op = {type:'inverse_z',pole:number(request.pole,'实极点 p'),side:request.side};
        if (op.pole === 0 || Math.abs(op.pole)>10 || !['right','left'].includes(op.side)) throw new Error('典型逆变换要求 0 < |p| ≤ 10，并选择左边或右边序列。');
        const n0=op.side==='right'?0:-16;
        const values=Array.from({length:16},(_,i)=>op.side==='right'?op.pole**i:-(op.pole**(n0+i)));
        statistics(values);
        analyses.push({type:'inverse_z',...op,n0,values,stable:op.side==='right'?Math.abs(op.pole)<1:Math.abs(op.pole)>1,
          roc:op.side==='right'?`|z| > ${Math.abs(op.pole)}`:`|z| < ${Math.abs(op.pole)}`});
      } else if (request.type === 'zvalue') {
        op={type:'zvalue',radius:number(request.radius,'z 的模'),angleDeg:number(request.angleDeg,'z 的辐角')};
        if (op.radius<=0) throw new Error('本数值实验要求 |z| > 0。');
        let real=0,imag=0;
        signal.values.forEach((v,i)=>{const n=signal.n0+i, scale=v*op.radius**(-n),angle=op.angleDeg*Math.PI/180*n;real+=scale*Math.cos(angle);imag-=scale*Math.sin(angle);});
        if (!Number.isFinite(real)||!Number.isFinite(imag)) throw new Error('z 变换求值溢出，请选择更接近单位圆的 z。');
        analyses.push({type:'zvalue',...op,real,imag});
      } else if (request.type === 'spectrum') {
        op={type:'spectrum',method:request.method,window:request.window,nfft:number(request.nfft,'变换点数',{integer:true}),removeMean:request.removeMean===true};
        if(request.removeMean!==undefined&&typeof request.removeMean!=='boolean')throw new Error('去均值必须是布尔值。');
        analyses.push({type:'spectrum',...spectrum(signal,op)});
      } else if (request.type === 'filter') {
        op={type:'filter',family:request.family,response:request.response,cutoffHz:number(request.cutoffHz,'截止频率')};
        if(op.family==='fir')Object.assign(op,{taps:number(request.taps,'抽头数',{integer:true}),window:request.window});
        const design=designFilter(op,signal.sampleRateHz),before={...signal,values:[...signal.values]};
        signal.values=difference(signal.values,design.b,design.a);
        signal.label='数字滤波输出';signal.formula='零历史、因果滤波；保留与输入相同长度，尾部未延拓';
        const config={method:'fft',window:'hann',nfft:2**Math.ceil(Math.log2(signal.values.length)),removeMean:false};
        analyses.push({type:'filter',...design,before,after:{...signal,values:[...signal.values]},response:frequencyResponse(design.b,design.a),beforeSpectrum:spectrum(before,config),afterSpectrum:spectrum(signal,config)});
      // OPERATION_BRANCHES
      } else throw new Error(`尚未支持操作：${request.type}`);
      if (!Number.isSafeInteger(signal.n0) || !Number.isSafeInteger(signal.n0 + signal.values.length - 1)) throw new Error('处理后的下标超出范围。');
      if (signal.sampleRateHz !== null && !Number.isFinite(Math.max(Math.abs(signal.n0), Math.abs(signal.n0 + signal.values.length - 1)) / signal.sampleRateHz)) throw new Error('处理后的时间轴超出范围。');
      statistics(signal.values);
      operations.push(op); steps.push({ operation: op, signal: { ...signal, values: [...signal.values] } });
    }
    return { operations, signal, steps, analyses };
  }

  function convolution(x, h) {
    if (x.length + h.length - 1 > MAX_SAMPLES) throw new Error('卷积输出超过 4096 项，请缩短输入或冲激响应。');
    const y = Array(x.length + h.length - 1).fill(0);
    x.forEach((v,i) => h.forEach((w,j) => {y[i+j] += v*w;}));
    return y;
  }
  function coefficients(b, a) {
    b = array(b,'分子 b'); a = array(a,'分母 a');
    if (b.length > 129 || a.length > 129) throw new Error('差分系数最多 129 项。');
    if (a[0] === 0) throw new Error('a₀ 不能为 0。');
    const a0 = a[0]; b = b.map(v => v / a0); a = a.map(v => v / a0);
    if ([...b,...a].some(v=>!Number.isFinite(v))) throw new Error('系数归一化溢出。');
    return {b,a};
  }
  function history(value) { return value === undefined || value === '' || (Array.isArray(value) && !value.length) ? [] : array(value,'历史值'); }
  function difference(x,b,a,xHistory=[],yHistory=[]) {
    const y = [];
    for (let n=0;n<x.length;n++) {
      let sum=0;
      for (let k=0;k<b.length;k++) sum += b[k]*(n-k >= 0 ? x[n-k] : (xHistory[k-n-1] ?? 0));
      for (let k=1;k<a.length;k++) sum -= a[k]*(n-k >= 0 ? y[n-k] : (yHistory[k-n-1] ?? 0));
      y.push(sum/a[0]);
      if (!Number.isFinite(y[n]) || Math.abs(y[n]) > 1e150) throw new Error('递推响应溢出，请缩短观察窗口或检查不稳定系统参数。');
    }
    return y;
  }
  function atFrequency(values, n0, omega) {
    let real=0,imag=0;
    values.forEach((v,i)=>{real+=v*Math.cos(omega*(n0+i));imag-=v*Math.sin(omega*(n0+i));});
    return {real,imag};
  }
  function dtft(values,n0) {
    const omega=Array.from({length:257},(_,i)=>-Math.PI+2*Math.PI*i/256);
    const complex=omega.map(w=>atFrequency(values,n0,w));
    const magnitude=complex.map(c=>Math.hypot(c.real,c.imag));
    const threshold=Math.max(...magnitude)*1e-10;
    return {omega,real:complex.map(c=>c.real),imag:complex.map(c=>c.imag),magnitude,
      phase:complex.map((c,i)=>magnitude[i]<=threshold?null:Math.atan2(c.imag,c.real))};
  }
  function frequencyResponse(b,a) {
    const num=dtft(b,0),den=dtft(a,0);
    const complex=num.real.map((r,i)=>{
      const d=den.real[i]**2+den.imag[i]**2;
      return d < 1e-24 ? null : {real:(r*den.real[i]+num.imag[i]*den.imag[i])/d,imag:(num.imag[i]*den.real[i]-r*den.imag[i])/d};
    });
    const magnitude=complex.map(c=>c?Math.hypot(c.real,c.imag):null);
    if (magnitude.some(v=>v!==null&&!Number.isFinite(v))) throw new Error('频率响应溢出。');
    const threshold=Math.max(...magnitude.filter(v=>v!==null))*1e-10;
    return {omega:num.omega,magnitude,phase:complex.map((c,i)=>!c||magnitude[i]<=threshold?null:Math.atan2(c.imag,c.real))};
  }
  function roots(coeffs) {
    const c=[...coeffs];while(c.length>1&&c[0]===0)c.shift();
    if(c.length===1)return [];
    if(c.length===2)return [{real:-c[1]/c[0],imag:0}];
    const [a,b,d]=c,delta=b*b-4*a*d;
    if(!Number.isFinite(delta))throw new Error('零极点系数过大。');
    if(delta>=0)return [{real:(-b+Math.sqrt(delta))/(2*a),imag:0},{real:(-b-Math.sqrt(delta))/(2*a),imag:0}];
    return [{real:-b/(2*a),imag:Math.sqrt(-delta)/(2*a)},{real:-b/(2*a),imag:-Math.sqrt(-delta)/(2*a)}];
  }
  function poleZero(b,a) {
    if(b.length>3||a.length>3)throw new Error('零极点实验目前支持最高二阶（各 3 个系数）。');
    const m=Math.max(b.length,a.length),pad=c=>[...c,...Array(m-c.length).fill(0)];
    let zeros=roots(pad(b)),poles=roots(pad(a));const cancelled=[];
    if(b.every(v=>v===0))return {zeros:[],poles:[],cancelled,causalStable:true,roc:'零传递函数：各有限 z（表达式的可去奇点按延拓处理）；初始状态响应需另行判断'};
    poles=poles.filter(p=>{
      const index=zeros.findIndex(z=>Math.hypot(p.real-z.real,p.imag-z.imag)<1e-9);
      if(index<0)return true;
      cancelled.push(p);zeros.splice(index,1);return false;
    });
    if([...zeros,...poles].some(p=>!Number.isFinite(p.real)||!Number.isFinite(p.imag)))throw new Error('零极点求值溢出。');
    const radius=Math.max(0,...poles.map(p=>Math.hypot(p.real,p.imag)));
    return {zeros,poles,cancelled,causalStable:radius<1,roc:poles.length?`因果 ROC：|z| > ${radius.toPrecision(6)}`:'因果 ROC：整个有限 z 平面（常数传递函数）'};
  }
  function windowValues(length,kind) {
    if(!['rectangular','hann','hamming'].includes(kind))throw new Error('不支持的窗函数。');
    // Periodic analysis windows; FIR design uses a symmetric window separately.
    return Array.from({length},(_,i)=>kind==='rectangular'||length===1?1:kind==='hann'?.5-.5*Math.cos(2*Math.PI*i/length):.54-.46*Math.cos(2*Math.PI*i/length));
  }
  function fourier(values,method) {
    const n=values.length,real=[...values],imag=Array(n).fill(0);
    if(method==='dft') {
      for(let k=0;k<n;k++){const c=atFrequency(values,0,2*Math.PI*k/n);real[k]=c.real;imag[k]=c.imag;}
    } else {
      for(let i=1,j=0;i<n;i++) {
        let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
        if(i<j)[real[i],real[j]]=[real[j],real[i]];
      }
      for(let length=2;length<=n;length*=2)for(let start=0;start<n;start+=length)for(let j=0;j<length/2;j++) {
        const angle=-2*Math.PI*j/length,c=Math.cos(angle),s=Math.sin(angle),u=start+j,v=u+length/2;
        const tr=c*real[v]-s*imag[v],ti=s*real[v]+c*imag[v];
        real[v]=real[u]-tr;imag[v]=imag[u]-ti;real[u]+=tr;imag[u]+=ti;
      }
    }
    return {real,imag};
  }
  function spectrum(signal,op) {
    const count=signal.values.length,nfft=op.nfft;
    if(!['dft','fft'].includes(op.method))throw new Error('请选择 DFT 或 FFT。');
    if(nfft<count||nfft>MAX_SAMPLES||nfft<1)throw new Error('变换点数须不少于信号长度，且不超过 4096。');
    if(op.method==='fft'&&(nfft&(nfft-1)))throw new Error('FFT 点数必须是 2 的整数次幂。');
    if(op.method==='dft'&&nfft>1024)throw new Error('直接 DFT 演示最多 1024 点；大序列请用 FFT。');
    const weights=windowValues(count,op.window),gain=weights.reduce((a,b)=>a+b,0);
    const mean=op.removeMean?signal.values.reduce((a,b)=>a+b,0)/count:0;
    const values=signal.values.map((v,i)=>(v-mean)*weights[i]);values.push(...Array(nfft-count).fill(0));
    const complex=fourier(values,op.method),bins=Math.floor(nfft/2)+1;
    const frequency=[],amplitude=[],phase=[],real=[],imag=[];
    for(let k=0;k<bins;k++) {
      const angle=-2*Math.PI*k*signal.n0/nfft,c=Math.cos(angle),s=Math.sin(angle);
      const re=complex.real[k]*c-complex.imag[k]*s,im=complex.real[k]*s+complex.imag[k]*c;
      real.push(re);imag.push(im);
      frequency.push(k*(signal.sampleRateHz??1)/nfft);
      amplitude.push(Math.hypot(re,im)/gain*(k===0||(nfft%2===0&&k===nfft/2)?1:2));
      phase.push(Math.atan2(im,re));
    }
    const peak=Math.max(...amplitude),peakIndex=amplitude.indexOf(peak);
    return {frequency,amplitude,real,imag,phase:phase.map((p,i)=>amplitude[i]<=peak*1e-10?null:p),window:op.window,method:op.method,nfft,count,
      coherentGain:gain/count,binSpacing:(signal.sampleRateHz??1)/nfft,recordSpacing:(signal.sampleRateHz??1)/count,
      frequencyUnit:signal.sampleRateHz===null?'cycles/sample':'Hz',peak:peak>1e-14?{frequency:frequency[peakIndex],amplitude:peak}:null};
  }
  function designFilter(op,fs) {
    if(fs===null)throw new Error('按 Hz 设计滤波器前必须设置采样率。');
    if(!(op.cutoffHz>0&&op.cutoffHz<fs/2))throw new Error('截止频率必须在 0 与 fs/2 之间。');
    if(!['lowpass','highpass'].includes(op.response))throw new Error('目前仅支持低通与高通。');
    if(op.family==='fir') {
      const n=op.taps;
      if(!Number.isInteger(n)||n<3||n>129||n%2===0)throw new Error('FIR 抽头数必须为 3 到 129 的奇数。');
      if(!['rectangular','hann','hamming'].includes(op.window))throw new Error('不支持的设计窗。');
      const mid=(n-1)/2,fc=op.cutoffHz/fs;
      let b=Array.from({length:n},(_,i)=>{
        const t=i-mid,low=t===0?2*fc:Math.sin(2*Math.PI*fc*t)/(Math.PI*t);
        const ideal=op.response==='lowpass'?low:(t===0?1:0)-low;
        const w=op.window==='rectangular'?1:op.window==='hann'?.5-.5*Math.cos(2*Math.PI*i/(n-1)):.54-.46*Math.cos(2*Math.PI*i/(n-1));
        return ideal*w;
      });
      const gain=b.reduce((sum,v,i)=>sum+v*Math.cos((op.response==='lowpass'?0:Math.PI)*(i-mid)),0);
      if(Math.abs(gain)<1e-12)throw new Error('滤波器设计增益过小。');
      b=b.map(v=>v/gain);
      return {b,a:[1],family:'fir',delaySamples:mid};
    }
    if(op.family==='iir') {
      const k=Math.tan(Math.PI*op.cutoffHz/fs),norm=1/(1+Math.SQRT2*k+k*k);
      const b=op.response==='lowpass'?[k*k*norm,2*k*k*norm,k*k*norm]:[norm,-2*norm,norm];
      return {b,a:[1,2*(k*k-1)*norm,(1-Math.SQRT2*k+k*k)*norm],family:'iir',delaySamples:null};
    }
    throw new Error('请选择 FIR 或二阶 Butterworth IIR。');
  }
  // MATH_FUNCTIONS

  // Cross-runtime libm may differ by a few ULPs. Compare numerical results,
  // treating principal phases modulo 2π and retaining structural checks.
  function compareResults(actual,expected) {
    let maxAbsoluteError=0;
    function equal(a,b,key='') {
      if(typeof a==='number'||typeof b==='number') {
        if(typeof a!=='number'||typeof b!=='number'||!Number.isFinite(a)||!Number.isFinite(b))return false;
        let delta=Math.abs(a-b);
        if(key==='phase')delta=Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
        maxAbsoluteError=Math.max(maxAbsoluteError,delta);
        return delta<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
      }
      if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;
      if(Array.isArray(a)!==Array.isArray(b))return false;
      const keys=Object.keys(a);
      return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k],Array.isArray(a)?key:k));
    }
    const matches=equal(actual,expected);return {equal:matches,maxAbsoluteError};
  }

  function runAnalysis(task) {
    if (!task || task.schemaVersion !== 1 || !task.input) throw new Error('不支持的任务格式。');
    if (!Array.isArray(task.operations) || task.operations.length > 8) {
      throw new Error('处理操作必须是数组，且最多 8 步。');
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
      if (waveform === 'sine' || waveform === 'cosine' || waveform === 'multitone') {
        const frequencyHz = number(input.frequencyHz, '频率');
        const phaseDeg = number(input.phaseDeg, '相位');
        if (frequencyHz < 0) throw new Error('发生器频率不能小于 0 Hz。');
        Object.assign(normalized, { frequencyHz, phaseDeg });
        const wave = waveform === 'cosine' ? Math.cos : Math.sin;
        values = Array.from({ length: count }, (_, i) => amplitude * wave(2 * Math.PI * frequencyHz * (n0 + i) / fs + phaseDeg * Math.PI / 180) + offset);
        label = waveform === 'sine' ? '正弦序列' : '余弦序列';
        formula = `x[n] = A · ${waveform === 'sine' ? 'sin' : 'cos'}(2π f n / fs + φ) + D`;
        if (frequencyHz >= fs / 2) warnings.push('频率达到或超过 fs/2：当前样值可能出现混叠或奈奎斯特点的特殊情况，请勿将图中变化直接视为原始频率。');
        if(waveform==='multitone') {
          const frequency2Hz=number(input.frequency2Hz,'第二频率'),amplitude2=number(input.amplitude2,'第二幅值');
          if(frequency2Hz<0)throw new Error('第二频率不能小于 0。');
          Object.assign(normalized,{frequency2Hz,amplitude2});
          values=values.map((v,i)=>v+amplitude2*Math.sin(2*Math.PI*frequency2Hz*(n0+i)/fs));
          label='双频叠加';formula='x[n] = A sin(2πfn/fs+φ) + A₂ sin(2πf₂n/fs) + D';
          if(frequency2Hz>=fs/2)warnings.push('第二频率达到或超过奈奎斯特频率，可能混叠。');
        }
      } else if(waveform==='noise') {
        const seed=number(input.seed,'随机种子',{integer:true});
        if(seed<0||seed>4294967295)throw new Error('种子范围为 0 到 4294967295。');
        normalized.seed=seed;let state=seed;
        values=Array.from({length:count},()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return amplitude*(2*state/4294967296-1)+offset;});
        label='可重复均匀噪声';formula='x[n] = A · U[−1,1) + D；固定种子的伪随机序列';
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
    const original = { values, n0, sampleRateHz: fs, label, formula };
    statistics(values);
    const processed = processOperations(original, task.operations);
    return {
      task: { schemaVersion: 1, input: normalized, operations: processed.operations },
      signal: processed.signal, original, steps: processed.steps, analyses: processed.analyses,
      metrics: statistics(processed.signal.values), warnings,
    };
  }
  return Object.freeze({ MAX_SAMPLES, parseSequence, parseCSV, runAnalysis, compareResults });
});
