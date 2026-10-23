/* Bounded offline language parser. All plans still use the shared DSP validator. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dsp.js'));
  else root.RuleAssistant = factory(root.DSP);
})(globalThis, function (DSP) {
  'use strict';
  const help = '支持自然句式，例如“请用 31 抽头 Hamming 做 0.2 kHz 低通，再看频谱”。也可说“截止改成 150Hz”“换成二阶 IIR”。未注明的参数沿用页面设置；修改时优先沿用上次操作。';
  const decimal = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
  const frequencyPattern = () => new RegExp(`(${decimal})\\s*(kHz|Hz|千赫兹|赫兹)`, 'gi');
  const modifying = /改成|改为|修改|换成|换为|切换|改用|换用|调整|改到/;
  const windowPattern = /hamming(?:\s*窗)?|hann(?:\s*窗)?|汉明窗?|海明窗?|汉宁窗?|汉恩窗?|矩形窗|rectangular(?:\s*窗)?/gi;
  const filler = /请问|请|麻烦|帮我|给我|对当前的信号|对当前信号|当前的信号|当前信号|这个信号|对信号|信号|上一次|上一个|上次|上个|最近的|最近|截止频率|截止|频率|滤波器|滤波|抽头数|点数|设置为|设为|设置|修改为|修改成|修改|调整为|调整到|调整|切换成|切换为|改成|改为|换成|换为|改用|换用|改到|使用|采用|应用|进行|做|设计|计算|分析|绘制|画出|查看|看看|看|画|一个|一下|的|用|为|是|把|将|先|再/g;

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

  function simpleOperation(command) {
    const reader = tokens(command);
    if (/DTFT/i.test(command)) {
      reader.take(/\bDTFT\b/gi, '操作'); reader.finish(); return {type:'dtft'};
    }
    if (/卷积|系统响应/.test(command)) {
      reader.take(/卷积|系统响应/g, '操作', () => true);
      const kernel = reader.take(/\[([^\]]*)\]/g, '卷积序列', m => DSP.parseSequence(m[1]));
      const n0 = reader.take(/(?:首项下标|起始下标|n0|n₀)\s*(?:为|=)?\s*([+-]?\d+)/gi, '响应起始下标', m => Number(m[1]));
      reader.finish();
      if (!kernel) throw new Error('请提供卷积的 h 序列，例如“卷积 [1,2,1]”。');
      return {type:'convolve',kernel,n0:n0 ?? 0};
    }
    if (/放大|缩放|增益/.test(command)) {
      const gain = reader.take(new RegExp(`(?:放大|缩放|增益)\\s*(?:为|到|=)?\\s*(${decimal})\\s*倍?`, 'gi'), '增益', m => Number(m[1]));
      reader.finish(); if (gain === undefined) throw new Error('请提供数值增益。');
      return {type:'transform',gain,shift:0,reverse:false};
    }
    if (/移位|平移/.test(command)) {
      const shift = reader.take(/(?:移位|平移)\s*([+-]?\d+)\s*(?:个?样点)?/g, '移位量', m => Number(m[1]));
      reader.finish(); if (shift === undefined) throw new Error('请提供整数移位量。');
      return {type:'transform',gain:1,shift,reverse:false};
    }
    if (/反折|反转/.test(command)) {
      reader.take(/反折|反转/g, '操作', () => true); reader.finish();
      return {type:'transform',gain:1,shift:0,reverse:true};
    }
    throw new Error(`未识别到支持的操作。${help}`);
  }

  function plan(text, currentTask, settings = {}) {
    try {
      if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('请输入 1—500 字的实验要求。');
      // Conditional/negative wording must not silently execute the opposite intent.
      if (/不要|别|不做|不使用|不采用|不是|无需|取消|或者|否则|如果|除非|而不是/.test(text)) throw new Error('请直接说明要执行的操作；当前离线助手尚不处理否定、条件或二选一要求。');
      let task = DSP.runAnalysis(currentTask).task;
      const changes = [];
      for (const command of splitCommands(text.trim())) {
        const edit = modifying.test(command);
        let kind;
        if (/DTFT/i.test(command)) kind = 'dtft';
        else if (/FFT|DFT|频谱|傅里叶变换|频域|\d+\s*点|点数/i.test(command)) kind = 'spectrum';
        else if (/低通|高通|FIR|IIR|Butterworth|巴特沃斯|滤波|截止|抽头|阶/i.test(command) || (edit && frequencyPattern().test(command))) kind = 'filter';
        else if (edit && new RegExp(windowPattern.source, 'i').test(command)) kind = task.operations.findLast(op => ['filter','spectrum'].includes(op.type))?.type;
        if (edit && !['filter','spectrum'].includes(kind)) throw new Error('请明确修改截止频率、滤波器类型、窗函数或频谱点数。');
        const index = edit ? task.operations.findLastIndex(op => op.type === kind) : task.operations.length;
        if (index < 0) throw new Error(`当前任务没有可修改的${kind === 'filter' ? '滤波器' : '频谱'}，请先新增并执行一次。`);
        const previous = edit ? task.operations[index] : null;
        let parsed;
        if (kind === 'filter') parsed = filterOperation(command, previous, settings?.filter);
        else if (kind === 'spectrum') {
          const before = DSP.runAnalysis({...task,operations:task.operations.slice(0,index)}).signal;
          parsed = spectrumOperation(command, previous, settings?.spectrum, before);
        } else parsed = {operation:simpleOperation(command),sources:{parameters:'文字'}};
        const next = [...task.operations];
        if (edit) next[index] = parsed.operation; else next.push(parsed.operation);
        task = DSP.runAnalysis({...task,operations:next}).task;
        changes.push({mode:edit ? 'replace' : 'append',index,operation:task.operations[index],sources:parsed.sources});
      }
      return {status:'ready',message:'已理解并校验，尚未执行。请核对以下操作和参数来源；点击执行后统一重算。',task,changes};
    } catch (error) {
      return {status:'needs_input',message:`请补充或修正：${error.message}`,task:null,changes:[]};
    }
  }
  return Object.freeze({plan,help});
});
