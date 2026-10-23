// Browser-test fixture: only the upstream API transport is simulated.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('../../server/index.cjs');
const {createConfigStore}=require('../../server/providers.cjs');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsp-browser-config-'));
  const server=createServer({configStore:createConfigStore(dir),fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body),context=JSON.parse(body.messages[1].content),signalId=context.signal.signalId;
    if(context.request.includes('取消')||context.request.includes('等待'))await new Promise((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);reject(new Error('aborted'));};const timer=setTimeout(()=>{init.signal.removeEventListener('abort',done);resolve();},1800);init.signal.addEventListener('abort',done,{once:true});
    });
    if(context.request.includes('额度'))return new Response('fixture-only: secret must never be returned',{status:429});
    let message;
    const results=body.messages.filter(m=>m.role==='tool');
    if(!results.length)message={tool_calls:[{id:'info',type:'function',function:{name:'get_signal_info',arguments:JSON.stringify({signalId})}}]};
    else if(results.length===1){
      const operations=context.request.includes('RMS')?[]:[{type:'filter',family:'iir',response:'lowpass',cutoffHz:context.request.includes('150')?150:100},{type:'spectrum',method:'fft',window:'hann',nfft:256,removeMean:false}];
      message={tool_calls:[{id:'run',type:'function',function:{name:'run_analysis',arguments:JSON.stringify({signalId,operations})}}]};
    }else message={content:'已使用本地工具计算。<img src=x onerror=alert(1)> 这里只是模型文本。'};
    return new Response(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]}));
  }});
  server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
  process.on('SIGTERM',()=>{server.close();server.closeAllConnections();fs.rm(dir,{recursive:true,force:true}).finally(()=>process.exit());});
})();
