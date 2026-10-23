'use strict';
// Provider-neutral protocol. Real OpenAI/DeepSeek adapters are deliveries 10/11.
async function runAgent(provider,registry,{maxTurns=4,timeoutMs=5000}={}){
  const messages=[],trace=[];let resultId=null,totalCalls=0;
  const deadline=Date.now()+timeoutMs;
  for(let turn=0;turn<maxTurns;turn++){
    let timer;
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('助手运行超时。');
    const controller=new AbortController();
    let reply;
    try{
      reply=await Promise.race([provider.next({messages,tools:registry.definitions,signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('助手运行超时。'));},remaining);})]);
    }finally{clearTimeout(timer);}
    if(!reply||typeof reply!=='object')throw new Error('模型适配器返回格式错误。');
    if(!reply.toolCalls?.length){if(typeof reply.text!=='string')throw new Error('助手缺少文本或工具调用。');return {text:reply.text,resultId,trace};}
    if(!Array.isArray(reply.toolCalls)||reply.toolCalls.length>4)throw new Error('每轮最多 4 个工具调用。');
    for(const call of reply.toolCalls){
      if(++totalCalls>8)throw new Error('助手工具调用超过上限。');
      if(typeof call.id!=='string'||typeof call.name!=='string')throw new Error('工具调用缺少标识或名称。');
      const result=registry.execute(call.name,call.arguments);
      if(result.resultId)resultId=result.resultId;
      trace.push({name:call.name,callId:call.id,status:'completed'});
      messages.push({role:'tool',callId:call.id,name:call.name,result});
    }
  }
  throw new Error('助手达到最大轮数，已停止。');
}
function mockProvider(signalId,operations){
  let turn=0;
  return {async next(){turn++;return turn===1?{toolCalls:[{id:'info-1',name:'get_signal_info',arguments:{signalId}}]}:turn===2?{toolCalls:[{id:'analysis-1',name:'run_analysis',arguments:{signalId,operations}}]}:{text:'模拟工具流程完成；所有 DSP 计算均在本地执行。'};}};
}
module.exports={runAgent,mockProvider};
