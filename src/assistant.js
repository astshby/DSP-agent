/* Bounded offline language parser. All plans still use the shared DSP validator. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dsp.js'), require('./capabilities.js'));
  else root.RuleAssistant = factory(root.DSP, root.CourseCapabilities);
})(globalThis, function (DSP, Capabilities) {
  'use strict';
  const help = '支持自然句式，例如“请用 31 抽头 Hamming 做 0.2 kHz 低通，再看频谱”。也可说“截止改成 150Hz”“换成二阶 IIR”。未注明的参数沿用页面设置；修改时优先沿用上次操作。';
  const decimal = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
  const frequencyPattern = () => new RegExp(`(${decimal})\\s*(kHz|Hz|千赫兹|赫兹)`, 'gi');
  const modifying = /改成|改为|修改|换成|换为|切换|改用|换用|调整|改到/;
  const windowPattern = /hamming(?:\s*窗)?|hann(?:\s*窗)?|汉明窗?|海明窗?|汉宁窗?|汉恩窗?|矩形窗|rectangular(?:\s*窗)?/gi;
  const filler = /当前的|当前|按照页面设置|按页面设置|根据页面设置|页面设置|窗函数|设计窗|分析窗|读取|生成|设置|输入|序列|波形|参数|以及|和|按|根据|请问|请|麻烦|帮我|给我|对当前的信号|对当前信号|当前的信号|当前信号|这个信号|对信号|信号|上一次|上一个|上次|上个|最近的|最近|截止频率|截止|频率|滤波器|滤波|抽头数|点数|设置为|设为|设置|修改为|修改成|修改|调整为|调整到|调整|切换成|切换为|改成|改为|换成|换为|改用|换用|改到|使用|采用|应用|进行|做|设计|计算|分析|绘制|画出|查看|看看|看|画|一个|一下|的|用|为|是|把|将|先|再/g;

  function splitCommands(text) {
    // Separators inside a sequence, e.g. [1, 2, 1], are data, not instructions.
    const commands = []; let start = 0, depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '[') depth++;
      if (text[i] === ']') depth--;
      if (depth < 0) throw new Error('序列方括号不匹配。');
      if (depth) continue;
      const separator = text.slice(i).match(/^(?:[;；\n]+|[,，]?\s*(?:然后再?|接着|随后|之后|并且|并|再))/);
      if (!separator) continue;
      const command = text.slice(start, i).trim();
      if (command) commands.push(command);
      i += separator[0].length - 1; start = i + 1;
    }
    if (depth) throw new Error('序列方括号不匹配。');
    const last = text.slice(start).trim();
    if (last) commands.push(last);
    else if (start > 0) throw new Error('连接词之后还缺少操作，请补全要求。');
    if (!commands.length || commands.length > 4) throw new Error('每次请输入 1—4 个操作，多步用“然后”连接。');
    return commands;
  }

  function tokens(command) {
    let remaining = command;
    return {
      take(pattern, label, convert = m => m[0]) {
        const found = [];
        remaining = remaining.replace(pattern, (...args) => {
          found.push(convert(args)); return ' ';
        });
        if (found.length > 1 && new Set(found.map(String)).size > 1) throw new Error(`${label}出现多个不同值，请明确选择一个。`);
        return found[0];
      },
      finish() {
        const rest = remaining.replace(filler, '').replace(/[\s,，。.!！?？:：=、]/g, '');
        if (rest) throw new Error(`还有未理解的内容“${rest}”。请说明操作与参数；频率请带 Hz 或 kHz 单位。`);
      },
    };
  }

  function windowName(token) {
    if (/hamming|汉明|海明/i.test(token)) return 'hamming';
    if (/hann|汉宁|汉恩/i.test(token)) return 'hann';
    return 'rectangular';
  }

  function filterOperation(command, previous, settings) {
    const reader = tokens(command), explicit = {};
    explicit.cutoffHz = reader.take(frequencyPattern(), '截止频率', m => Number(m[1]) * (/^k|千/i.test(m[2]) ? 1000 : 1));
    explicit.response = reader.take(/低通|高通/g, '响应类型', m => m[0] === '低通' ? 'lowpass' : 'highpass');
    explicit.family = reader.take(/FIR|IIR|Butterworth|巴特沃斯/gi, '滤波器类别', m => /^fir$/i.test(m[0]) ? 'fir' : 'iir');
    explicit.taps = reader.take(/(\d+)\s*(?:个\s*)?(?:抽头|taps?)/gi, '抽头数', m => Number(m[1]));
    const prefixedTaps = reader.take(/(?:抽头数|抽头|taps?)\s*(?:设为|改成|改为|为|=)?\s*(\d+)/gi, '抽头数', m => Number(m[1]));
    if (explicit.taps !== undefined && prefixedTaps !== undefined && explicit.taps !== prefixedTaps) throw new Error('抽头数不一致。');
    explicit.taps ??= prefixedTaps;
    explicit.window = reader.take(windowPattern, '设计窗', m => windowName(m[0]));
    const order = reader.take(/(\d+|二|两)\s*阶/g, '滤波器阶数', m => /二|两/.test(m[1]) ? 2 : Number(m[1]));
    reader.finish();
    const sources = {};
    function choose(key, fallback) {
      if (explicit[key] !== undefined) { sources[key] = '文字'; return explicit[key]; }
      if (previous && previous[key] !== undefined) { sources[key] = '上次操作'; return previous[key]; }
      if (settings && settings[key] !== undefined) { sources[key] = '页面设置'; return settings[key]; }
      if (fallback !== undefined) { sources[key] = '默认值'; return fallback; }
      throw new Error(key === 'cutoffHz' ? '请补充截止频率，例如 200 Hz，或填写页面的截止频率。' : '请选择低通或高通。');
    }
    // A design window or tap count explicitly selects the supported FIR method.
    if (explicit.family === undefined && (explicit.taps !== undefined || explicit.window !== undefined)) explicit.family = 'fir';
    const op = {type:'filter', family:choose('family', 'fir'), response:choose('response'), cutoffHz:choose('cutoffHz')};
    if (op.family === 'fir') {
      if (order !== undefined) {
        if (explicit.taps !== undefined && explicit.taps !== order + 1) throw new Error('FIR 阶数等于抽头数减 1，请核对这两个参数。');
        explicit.taps = order + 1;
      }
      op.taps = choose('taps', 51); op.window = choose('window', 'hamming');
    } else {
      if (order !== undefined && order !== 2) throw new Error('当前 IIR 实现固定为二阶 Butterworth；其他阶数尚未实现。');
      if (explicit.taps !== undefined || explicit.window !== undefined) throw new Error('抽头数和设计窗用于 FIR；二阶 Butterworth IIR 无这两个参数。');
    }
    return {operation:op, sources};
  }

  function spectrumOperation(command, previous, settings, signal) {
    const reader = tokens(command), explicit = {};
    reader.take(/频谱|傅里叶变换|频域/g, '频谱操作', () => true);
    explicit.method = reader.take(/FFT|DFT/gi, '计算方法', m => m[0].toLowerCase());
    explicit.nfft = reader.take(/(\d+)\s*点/g, '变换点数', m => Number(m[1]));
    const prefixed = reader.take(/点数\s*(?:设为|改成|改为|为|=)?\s*(\d+)/g, '变换点数', m => Number(m[1]));
    if (explicit.nfft !== undefined && prefixed !== undefined && explicit.nfft !== prefixed) throw new Error('变换点数不一致。');
    explicit.nfft ??= prefixed;
    explicit.window = reader.take(windowPattern, '分析窗', m => windowName(m[0]));
    explicit.removeMean = reader.take(/不去均值|保留均值|去均值/g, '去均值选项', m => m[0] === '去均值');
    reader.finish();
    const sources = {};
    function choose(key, fallback) {
      if (explicit[key] !== undefined) {sources[key] = '文字'; return explicit[key];}
      if (previous && previous[key] !== undefined) {sources[key] = '上次操作'; return previous[key];}
      if (settings && settings[key] !== undefined) {sources[key] = '页面设置'; return settings[key];}
      sources[key] = key === 'nfft' ? '按信号长度' : '默认值'; return fallback;
    }
    return {operation:{type:'spectrum',method:choose('method', 'fft'),window:choose('window', 'hann'),
      nfft:choose('nfft', 2 ** Math.ceil(Math.log2(signal.values.length))),removeMean:choose('removeMean', false)},sources};
  }

  function simpleOperation(command, previous, settings = {}) {
    const reader = tokens(command);
    if (/DTFT/i.test(command)) {
      reader.take(/\bDTFT\b/gi, '操作'); reader.finish(); return {type:'dtft'};
    }
    if (/卷积|系统响应/.test(command)) {
      reader.take(/卷积|系统响应/g, '操作', () => true);
      const kernel = reader.take(/\[([^\]]*)\]/g, '卷积序列', m => DSP.parseSequence(m[1]));
      const n0 = reader.take(/(?:首项下标|起始下标|n0|n₀)\s*(?:为|=)?\s*([+-]?\d+)/gi, '响应起始下标', m => Number(m[1]));
      reader.finish();
      if (!kernel && !previous?.kernel && !settings.kernel) throw new Error('请提供卷积的 h 序列，例如“卷积 [1,2,1]”，或填写页面冲激响应。');
      return {type:'convolve',kernel:kernel ?? previous?.kernel ?? settings.kernel,n0:n0 ?? previous?.n0 ?? settings.n0 ?? 0};
    }
    if (/放大|缩放|增益/.test(command)) {
      const gain = reader.take(new RegExp(`(?:放大|缩放|增益)\\s*(?:改成|改为|设为|为|到|=)?\\s*(${decimal})\\s*倍?`, 'gi'), '增益', m => Number(m[1]));
      reader.finish(); if (gain === undefined) throw new Error('请提供数值增益。');
      return {type:'transform',gain,shift:previous?.shift ?? 0,reverse:previous?.reverse ?? false};
    }
    if (/移位|平移/.test(command)) {
      const shift = reader.take(/(?:移位|平移)\s*(?:改成|改为|为|=)?\s*([+-]?\d+)\s*(?:个?样点)?/g, '移位量', m => Number(m[1]));
      reader.finish(); if (shift === undefined) throw new Error('请提供整数移位量。');
      return {type:'transform',gain:previous?.gain ?? 1,shift,reverse:previous?.reverse ?? false};
    }
    if (/反折|反转/.test(command)) {
      reader.take(/反折|反转/g, '操作', () => true); reader.finish();
      return {type:'transform',gain:previous?.gain ?? 1,shift:previous?.shift ?? 0,reverse:true};
    }
    throw new Error(`未识别到支持的操作。${help}`);
  }

  function inputPlan(command, current) {
    const reader=tokens(command), sources={};
    const inherited=current.kind==='generated'?current:{kind:'generated',waveform:'sine',sampleRateHz:current.sampleRateHz ?? 1000,count:current.values?.length ?? 64,n0:current.n0,frequencyHz:50,amplitude:1,phaseDeg:0,offset:0,position:0};
    const input={...inherited};
    const take=(key,pattern,convert=m=>Number(m[1]))=>{const value=reader.take(pattern,key,convert);if(value!==undefined){input[key]=value;sources[key]='文字';}return value;};
    const fs=take('sampleRateHz',new RegExp(`(?:采样率|fs)\\s*(?:改成|改为|为|=)?\\s*(${decimal})\\s*(kHz|Hz|千赫兹|赫兹)`,'gi'),m=>Number(m[1])*(/^k|千/i.test(m[2])?1000:1));
    take('n0',/(?:首项下标|起始下标|n0|n₀)\s*(?:改成|改为|为|=)?\s*([+-]?\d+)/gi);
    const sequence=reader.take(/(?:输入(?:序列)?|序列|样值)\s*(\[[^\]]*\])/g,'样值',m=>DSP.parseSequence(m[1]));
    if(sequence){
      reader.finish();return {input:{kind:'manual',values:sequence,n0:input.n0,sampleRateHz:fs ?? current.sampleRateHz},sources:{values:'文字',n0:sources.n0 ?? '当前输入',sampleRateHz:sources.sampleRateHz ?? '当前输入'}};
    }
    const wave=reader.take(/正弦|余弦|单位脉冲|单位阶跃|脉冲|阶跃|双频|均匀噪声|噪声/g,'波形',m=>({'正弦':'sine','余弦':'cosine','单位脉冲':'impulse','脉冲':'impulse','单位阶跃':'step','阶跃':'step','双频':'multitone','噪声':'noise','均匀噪声':'noise'})[m[0]]);
    if(wave){input.waveform=wave;sources.waveform='文字';}
    take('count',/(?:样本数|样值数|N)\s*(?:改成|改为|为|=)?\s*(\d+)/g);
    take('amplitude',new RegExp(`(?:幅值|幅度)\\s*(?:改成|改为|为|=)?\\s*(${decimal})`,'gi'));
    take('phaseDeg',new RegExp(`相位\\s*(?:改成|改为|为|=)?\\s*(${decimal})\\s*(?:度|°)`,'gi'));
    take('offset',new RegExp(`(?:偏置|直流)\\s*(?:改成|改为|为|=)?\\s*(${decimal})`,'gi'));
    take('position',/(?:发生位置|位置)\s*(?:改成|改为|为|=)?\s*([+-]?\d+)/g);
    take('frequency2Hz',new RegExp(`第二频率\\s*(?:为|=)?\\s*(${decimal})\\s*(kHz|Hz|千赫兹|赫兹)`,'gi'),m=>Number(m[1])*(/^k|千/i.test(m[2])?1000:1));
    take('amplitude2',new RegExp(`第二幅值\\s*(?:为|=)?\\s*(${decimal})`,'gi'));
    take('seed',/(?:随机种子|种子)\s*(?:为|=)?\s*(\d+)/g);
    const frequency=reader.take(frequencyPattern(),'信号频率',m=>Number(m[1])*(/^k|千/i.test(m[2])?1000:1));
    if(frequency!==undefined){input.frequencyHz=frequency;sources.frequencyHz='文字';}
    reader.finish();
    if(!Object.keys(sources).length)throw new Error('请描述波形或待修改的信号参数。');
    if(current.kind==='manual'&&!wave){
      if(Object.keys(sources).some(key=>!['sampleRateHz','n0'].includes(key)))throw new Error('当前是手动序列；生成信号时请注明正弦、余弦、脉冲或阶跃。');
      return {input:{...current,n0:input.n0,sampleRateHz:input.sampleRateHz},sources};
    }
    input.frequency2Hz ??= 300;input.amplitude2 ??= .5;input.seed ??= 42;input.position ??= 0;
    return {input,sources:{...sources,other:'当前输入'}};
  }

  function systemOperation(command,kind,previous,settings={}) {
    const reader=tokens(command), explicit={},sources={};
    reader.take(/差分方程|差分系统|差分|系统频率响应|频率响应|系统频响|频响|零极点|因果\s*ROC|ROC|稳定性/gi,'操作',()=>true);
    for(const key of ['b','a'])explicit[key]=reader.take(new RegExp(`\\b${key}\\s*=\\s*(\\[[^\\]]*\\])`,'gi'),key,m=>DSP.parseSequence(m[1]));
    if(kind==='difference') {
      explicit.xHistory=reader.take(/(?:输入历史|xHistory)\s*(?:为|=)?\s*(\[[^\]]*\])/gi,'输入历史',m=>DSP.parseSequence(m[1]));
      explicit.yHistory=reader.take(/(?:输出历史|yHistory)\s*(?:为|=)?\s*(\[[^\]]*\])/gi,'输出历史',m=>DSP.parseSequence(m[1]));
      explicit.tail=reader.take(/(?:尾部补零|补零)\s*(\d+)\s*项?/g,'补零长度',m=>Number(m[1]));
      if(reader.take(/零初始(?:条件|历史)?/g,'初始条件',()=>true)){explicit.xHistory=[];explicit.yHistory=[];}
    }
    reader.finish();
    const choose=(key,fallback)=>{
      if(explicit[key]!==undefined){sources[key]='文字';return explicit[key];}
      if(previous?.[key]!==undefined){sources[key]='上次操作';return previous[key];}
      if(settings[key]!==undefined){sources[key]='页面设置';return settings[key];}
      if(fallback!==undefined){sources[key]='默认值';return fallback;}
      throw new Error(`请提供 ${key} 系数，例如 b=[1]，a=[1,-0.5]，或填写页面参数。`);
    };
    const operation={type:kind,b:choose('b'),a:choose('a')};
    if(kind==='difference')Object.assign(operation,{xHistory:choose('xHistory',[]),yHistory:choose('yHistory',[]),tail:choose('tail',0)});
    return {operation,sources};
  }

  function zOperation(command,kind,previous,settings={}) {
    const reader=tokens(command),explicit={},sources={};
    if(kind==='inverse_z') {
      reader.take(/典型逆\s*z\s*变换|逆\s*z\s*变换/gi,'操作',()=>true);
      explicit.pole=reader.take(new RegExp(`(?:极点|p)\\s*(?:改成|改为|为|=)?\\s*(${decimal})`,'gi'),'极点',m=>Number(m[1]));
      explicit.side=reader.take(/左边|反因果|右边|因果/g,'方向',m=>/左边|反因果/.test(m[0])?'left':'right');
    } else {
      reader.take(/(?:有限序列)?\s*z\s*(?:变换|求值)/gi,'操作',()=>true);
      explicit.radius=reader.take(new RegExp(`(?:模|半径|radius)\\s*(?:改成|改为|为|=)?\\s*(${decimal})`,'gi'),'z 的模',m=>Number(m[1]));
      explicit.angleDeg=reader.take(new RegExp(`(?:辐角|角度)\\s*(?:改成|改为|为|=)?\\s*(${decimal})\\s*(?:度|°)`,'gi'),'辐角',m=>Number(m[1]));
    }
    reader.finish();
    const operation={type:kind};
    for(const key of kind==='inverse_z'?['pole','side']:['radius','angleDeg']){
      if(explicit[key]!==undefined){sources[key]='文字';operation[key]=explicit[key];}
      else if(previous?.[key]!==undefined){sources[key]='上次操作';operation[key]=previous[key];}
      else if(settings[key]!==undefined){sources[key]='页面设置';operation[key]=settings[key];}
      else throw new Error(`请补充 ${key}，或填写本周页面参数。`);
    }
    return {operation,sources};
  }

  function kindOf(command,edit,task) {
    if(/差分/.test(command))return 'difference';
    if(/频率响应|系统频响|频响/.test(command))return 'response';
    if(/零极点|ROC|稳定性/i.test(command))return 'zplane';
    if(/逆\s*z\s*变换/i.test(command))return 'inverse_z';
    if(/z\s*(?:变换|求值)/i.test(command))return 'zvalue';
    if(/DTFT/i.test(command))return 'dtft';
    if(/FFT|DFT|频谱|傅里叶变换|频域|\d+\s*点|点数/i.test(command))return 'spectrum';
    if(/低通|高通|FIR|IIR|Butterworth|巴特沃斯|滤波|截止|抽头|阶/i.test(command))return 'filter';
    if(/卷积|系统响应/.test(command))return 'convolve';
    if(/放大|缩放|增益|移位|平移|反折|反转/.test(command))return 'transform';
    if(/正弦|余弦|脉冲|阶跃|双频|噪声|采样率|样本数|幅值|幅度|相位|偏置|直流|发生位置|信号频率|输入\s*\[|输入序列|序列\s*\[/i.test(command))return 'input';
    if(/能量|RMS|均值|峰峰值|摘要|统计|查看波形/i.test(command))return 'inspect';
    if(edit&&frequencyPattern().test(command))return task.operations.some(op=>op.type==='filter')?'filter':'input';
    if(edit&&new RegExp(windowPattern.source,'i').test(command))return task.operations.findLast(op=>['filter','spectrum'].includes(op.type))?.type;
    return null;
  }

  function plan(text,currentTask,settings={},profile=Capabilities.forWeek()) {
    try {
      if(typeof text!=='string'||!text.trim()||text.length>500)throw new Error('请输入 1—500 字的实验要求。');
      if(/不要|别|不做|不使用|不采用|不是|无需|取消|或者|否则|如果|除非|而不是/.test(text))throw new Error('请直接说明要执行的操作；当前离线助手尚不处理否定、条件或二选一要求。');
      let task=DSP.runAnalysis(currentTask).task;
      for(const op of task.operations)Capabilities.requireCapability(profile,op.type);
      const changes=[];
      for(const command of splitCommands(text.trim())) {
        const edit=modifying.test(command),kind=kindOf(command,edit,task);
        if(!kind)throw new Error(`未识别到支持的操作。本周支持：${profile.summary}。`);
        Capabilities.requireCapability(profile,kind);
        if(kind==='input') {
          const parsed=inputPlan(command,task.input);
          if(parsed.input.kind==='generated'&&!profile.waveforms.includes(parsed.input.waveform))throw new Error(`第 ${profile.week} 周尚未开放该发生器波形。`);
          task=DSP.runAnalysis({...task,input:parsed.input}).task;
          changes.push({mode:'input',index:null,operation:{type:'input',input:task.input},sources:parsed.sources});continue;
        }
        if(kind==='inspect') {
          const reader=tokens(command);reader.take(/能量|RMS|均值|峰峰值|摘要|统计|查看波形/gi,'指标',()=>true);reader.finish();
          changes.push({mode:'inspect',index:null,operation:{type:'inspect'},sources:{parameters:'当前任务'}});continue;
        }
        const index=edit?task.operations.findLastIndex(op=>op.type===kind):task.operations.length;
        if(index<0)throw new Error(`当前没有可修改的“${Capabilities.names[kind]}”，请先新增并执行一次。`);
        const previous=edit?task.operations[index]:null;
        let parsed;
        if(kind==='filter')parsed=filterOperation(command,previous,settings?.filter);
        else if(kind==='spectrum') {
          const before=DSP.runAnalysis({...task,operations:task.operations.slice(0,index)}).signal;
          parsed=spectrumOperation(command,previous,settings?.spectrum,before);
        } else if(['difference','response','zplane'].includes(kind))parsed=systemOperation(command,kind,previous,settings?.[kind]);
        else if(['inverse_z','zvalue'].includes(kind))parsed=zOperation(command,kind,previous,settings?.[kind]);
        else parsed={operation:simpleOperation(command,previous,settings?.[kind]),sources:{parameters:previous?'文字 / 上次操作':settings?.[kind]?'文字 / 页面设置':'文字'}};
        const next=[...task.operations];
        if(edit)next[index]=parsed.operation;else next.push(parsed.operation);
        task=DSP.runAnalysis({...task,operations:next}).task;
        changes.push({mode:edit?'replace':'append',index,operation:task.operations[index],sources:parsed.sources});
      }
      return {status:'ready',message:'已理解并校验，尚未执行。请核对操作和参数来源；执行后统一更新波形与读数。',task,changes};
    } catch(error) {return {status:'needs_input',message:`请补充或修正：${error.message}`,task:null,changes:[]};}
  }

  function describeOperation(op) {
    const list=values=>values.slice(0,8).join(', ')+(values.length>8?' …':'');
    switch(op.type) {
      case 'input': {
        const input=op.input;
        if(input.kind==='manual')return `手动序列 [${list(input.values)}]，N=${input.values.length}，n₀=${input.n0}，fs=${input.sampleRateHz??'未设置'}${input.sampleRateHz===null?'':' Hz'}`;
        const names={sine:'正弦',cosine:'余弦',impulse:'脉冲',step:'阶跃',multitone:'双频叠加',noise:'均匀噪声'};
        return `${names[input.waveform]}，fs=${input.sampleRateHz} Hz，N=${input.count}，n₀=${input.n0}，幅值=${input.amplitude}，偏置=${input.offset}`
          +(input.frequencyHz===undefined?'':`，f=${input.frequencyHz} Hz，相位=${input.phaseDeg}°`)
          +(input.position===undefined?'':`，发生位置=${input.position}`)
          +(input.frequency2Hz===undefined?'':`，第二频率=${input.frequency2Hz} Hz，第二幅值=${input.amplitude2}`)
          +(input.seed===undefined?'':`，种子=${input.seed}`);
      }
      case 'inspect':return '查看当前波形、均值、RMS、峰峰值和有限窗口能量';
      case 'transform':return `${op.reverse?'反折 → ':''}移位 ${op.shift} → 增益 ${op.gain}`;
      case 'convolve':return `卷积：h=[${list(op.kernel)}]，n₀=${op.n0}`;
      case 'difference':return `差分方程：b=[${list(op.b)}]，a=[${list(op.a)}]，输入历史=[${list(op.xHistory)}]，输出历史=[${list(op.yHistory)}]，补零 ${op.tail} 项`;
      case 'dtft':return '当前序列 DTFT（257 个频率点）';
      case 'response':return `系统响应：b=[${list(op.b)}]，a=[${list(op.a)}]`;
      case 'zplane':return `零极点：b=[${list(op.b)}]，a=[${list(op.a)}]`;
      case 'inverse_z':return `典型逆 z：p=${op.pole}，${op.side==='right'?'右边':'左边'}序列`;
      case 'zvalue':return `z 求值：模 ${op.radius}，辐角 ${op.angleDeg}°`;
      case 'spectrum':return `${op.method.toUpperCase()}：${op.nfft} 点，${op.window} 窗${op.removeMean?'，先去均值':''}`;
      case 'filter':return `${op.family.toUpperCase()} ${op.response==='lowpass'?'低通':'高通'}：截止 ${op.cutoffHz} Hz${op.family==='fir'?`，${op.taps} 抽头，${op.window} 窗`:'，二阶 Butterworth'}`;
      default:return op.type;
    }
  }
  function previewText(result) {
    const labels={family:'滤波器类别',response:'响应类型',cutoffHz:'截止频率',taps:'抽头数',window:'窗函数',method:'计算方法',nfft:'点数',removeMean:'去均值',parameters:'参数',values:'样值',sampleRateHz:'采样率',n0:'首项下标',count:'样本数',frequencyHz:'信号频率',other:'其他参数'};
    return result.message+(result.task?'\n\n'+result.changes.map(change=>{
      const sources=Object.entries(change.sources).map(([key,source])=>`${labels[key]??key}：${source}`).join('；');
      const title=change.mode==='input'?'更新输入':change.mode==='inspect'?'读取实验结果':`${change.mode==='replace'?'修改':'新增'}第 ${change.index+1} 步`;
      return `${title}：${describeOperation(change.operation)}\n${sources}`;
    }).join('\n\n'):'');
  }
  return Object.freeze({plan,help,describeOperation,previewText});
});
