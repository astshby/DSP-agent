'use strict';
async function runAgent(provider,registry,{maxTurns=6,timeoutMs=90000,signal,onEvent=()=>{}}={}){
  const messages=[],trace=[];let resultId=null,totalCalls=0;
  const controller=new AbortController();
  const abort=()=>controller.abort(new Error('助手运行已取消。'));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new Error('助手运行超时。')),timeoutMs);
  function check(){if(controller.signal.aborted)throw controller.signal.reason;}
  const cancelled=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});});
  // A rejected abort promise is always consumed by the race below.
  cancelled.catch(()=>{});
  try{
    for(let turn=0;turn<maxTurns;turn++){
      check();const reply=await Promise.race([provider.next({messages,tools:registry.definitions,signal:controller.signal}),cancelled]);check();
      if(!reply||typeof reply!=='object')throw new Error('模型适配器返回格式错误。');
      if(!reply.toolCalls?.length){if(typeof reply.text!=='string')throw new Error('助手缺少文本或工具调用。');return {text:reply.text,resultId,trace};}
      if(!Array.isArray(reply.toolCalls)||reply.toolCalls.length>4)throw new Error('每轮最多 4 个工具调用。');
      for(const call of reply.toolCalls){
        check();if(++totalCalls>8)throw new Error('助手工具调用超过上限。');
        if(typeof call.id!=='string'||typeof call.name!=='string')throw new Error('工具调用缺少标识或名称。');
        let result,status='completed';
        try{result=registry.execute(call.name,call.arguments);if(result.resultId)resultId=result.resultId;}catch(error){result={error:error.message};status='failed';if(call.name==='run_analysis')resultId=null;}
        const event={name:call.name,callId:call.id,status};trace.push(event);onEvent(event);
        messages.push({role:'tool',callId:call.id,name:call.name,result});
      }
    }
    throw new Error('助手达到最大轮数，已停止。');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function mockProvider(signalId,operations){let turn=0;return {async next(){turn++;return turn===1?{toolCalls:[{id:'info-1',name:'get_signal_info',arguments:{signalId}}]}:turn===2?{toolCalls:[{id:'analysis-1',name:'run_analysis',arguments:{signalId,operations}}]}:{text:'模拟工具流程完成；所有 DSP 计算均在本地执行。'};}};}
module.exports={runAgent,mockProvider};
