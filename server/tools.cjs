'use strict';
const {randomUUID}=require('node:crypto');
const DSP=require('../src/dsp.js');
const {tools,validate}=require('./contracts.cjs');
function createRegistry(){
  const signals=new Map(),results=new Map();
  const put=(map,value)=>{if(map.size>=32)map.delete(map.keys().next().value);const id=randomUUID();map.set(id,value);return id;};
  function getSignal(id){const result=signals.get(id);if(!result)throw new Error('本地信号不存在或已过期，请重新载入。');return result;}
  function info(result){return {sampleRateHz:result.signal.sampleRateHz,n0:result.signal.n0,count:result.signal.values.length,metrics:result.metrics};}
  return {
    definitions:tools,
    add(input){const result=DSP.runAnalysis({schemaVersion:1,input,operations:[]});return {signalId:put(signals,result),...info(result)};},
    result(id){const result=results.get(id);if(!result)throw new Error('结果不存在或已过期。');return result;},
    execute(name,args){
      const definition=tools.find(t=>t.name===name);if(!definition)throw new Error('未知工具；只能调用已注册 DSP 工具。');
      validate(args,definition.parameters);
      const source=getSignal(args.signalId);
      if(name==='get_signal_info')return {signalId:args.signalId,...info(source)};
      const result=DSP.runAnalysis({...source.task,operations:args.operations});
      const summaries=result.analyses.map(a=>({type:a.type,...(a.peak?{peak:a.peak}:{}),...(a.causalStable!==undefined?{causalStable:a.causalStable,roc:a.roc}:{}),...(a.convolutionError!==undefined?{convolutionError:a.convolutionError}:{}),...(a.family?{family:a.family,delaySamples:a.delaySamples}:{} )}));
      return {resultId:put(results,result),...info(result),warnings:result.warnings,analyses:summaries};
    },
  };
}
module.exports={createRegistry};
