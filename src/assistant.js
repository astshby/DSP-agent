/* Offline grammar only. It produces data; it never evaluates user code. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./dsp.js'));
  else root.RuleAssistant=factory(root.DSP);
})(globalThis,function(DSP){
  'use strict';
  const help='支持：分析频谱、DTFT、低通 100 Hz、高通 100 Hz、放大 2 倍、移位 -3、反折、卷积 [1,2,1]。多步用“然后”连接；单位与数值必须完整。';
  const decimal='([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)';
  function plan(text,currentTask){
    try {
      if(typeof text!=='string'||!text.trim()||text.length>500)throw new Error('请输入 1—500 字的实验命令。');
      let task=DSP.runAnalysis(currentTask).task;
      const commands=text.trim().split(/\s*(?:然后|；|;)\s*/);
      if(commands.length>4)throw new Error('规则助手每次最多追加 4 个操作。');
      for(const command of commands){
        let op,match;
        if(/^(?:分析)?(?:频谱|FFT)$/i.test(command)){
          const current=DSP.runAnalysis(task).signal;
          op={type:'spectrum',method:'fft',window:'hann',nfft:2**Math.ceil(Math.log2(current.values.length)),removeMean:false};
        }else if(/^DTFT$/i.test(command))op={type:'dtft'};
        else if((match=command.match(new RegExp('^(低通|高通)\\s*'+decimal+'\\s*Hz$','i'))))op={type:'filter',family:'fir',response:match[1]==='低通'?'lowpass':'highpass',cutoffHz:Number(match[2]),taps:51,window:'hamming'};
        else if((match=command.match(new RegExp('^放大\\s*'+decimal+'\\s*倍$','i'))))op={type:'transform',gain:Number(match[1]),shift:0,reverse:false};
        else if((match=command.match(/^移位\s*([+-]?\d+)$/)))op={type:'transform',gain:1,shift:Number(match[1]),reverse:false};
        else if(command==='反折')op={type:'transform',gain:1,shift:0,reverse:true};
        else if((match=command.match(/^卷积\s*(\[.*\])$/)))op={type:'convolve',kernel:DSP.parseSequence(match[1]),n0:0};
        else throw new Error(`无法完整识别“${command}”。${help}`);
        task=DSP.runAnalysis({...task,operations:[...task.operations,op]}).task;
      }
      return {status:'ready',message:'已解析并校验，尚未替换页面结果。确认参数后点击执行。低/高通默认 FIR 51 抽头 Hamming；频谱默认周期 Hann 窗。',task};
    }catch(error){return {status:'needs_input',message:`请补充或修正：${error.message}`,task:null};}
  }
  return Object.freeze({plan,help});
});
