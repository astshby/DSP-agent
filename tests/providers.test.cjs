const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createConfigStore,createProvider,definitions}=require('../server/providers.cjs');
const {createServer}=require('../server/index.cjs');
const {createRegistry}=require('../server/tools.cjs');
const {runAgent}=require('../server/runner.cjs');
const input={kind:'manual',values:[1,2,1],n0:0,sampleRateHz:1000};
const tool=(name,args,id='call-1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const reply=message=>new Response(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]}));
async function storeFor(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsp-config-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,store:createConfigStore(dir)};}
test('config persists independently, redacts keys, retains blank keys and deletes provider',async t=>{
  const {dir,store}=await storeFor(t);
  await store.save('openai',{model:'gpt-4.1-mini',apiKey:'test-secret-only'});
  await store.save('deepseek',{model:'deepseek-chat',apiKey:'test-ds-only'});
  await store.save('openai',{model:'other-model',apiKey:''});
  assert.equal((await createConfigStore(dir).get('openai')).apiKey,'test-secret-only');
  assert.equal(JSON.stringify(await store.list()).includes('test-secret'),false);
  if(process.platform!=='win32')assert.equal((await fs.stat(path.join(dir,'providers.json'))).mode&0o777,0o600);
  assert.throws(()=>store.save('unknown',{model:'a'}),/不支持/);
  assert.throws(()=>store.save('openai',{model:'a',apiKey:'bad\nkey'}),/格式/);
  assert.throws(()=>store.save('openai',{model:'a',url:'https://example.org'}),/未知/);
  await store.save('openai',{remove:true});
  await assert.rejects(store.get('openai'),/先保存/);
  assert.equal((await store.list()).find(x=>x.id==='deepseek').configured,true);
});
for(const id of ['openai','deepseek'])test(`${id}: official endpoint, complete tool history, local calculation and summaries without raw samples`,async()=>{
  const registry=createRegistry(),stored=registry.add(input),requests=[];
  const provider=createProvider(id,{model:definitions[id].model,apiKey:'fake-key'},{text:'放大 2 倍',signalInfo:stored},{fetchImpl:async(url,init)=>{
    assert.equal(url,definitions[id].url);assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer fake-key');
    const body=JSON.parse(init.body);requests.push(body);
    if(requests.length===1)return reply({content:null,tool_calls:[tool('get_signal_info',{signalId:stored.signalId},'info')]});
    if(requests.length===2){assert.equal(body.messages.at(-1).tool_call_id,'info');return reply({content:null,tool_calls:[tool('run_analysis',{signalId:stored.signalId,operations:[{type:'transform',gain:2,shift:0,reverse:false}]},'analysis')]});}
    assert.equal(body.messages.at(-2).tool_calls[0].id,'analysis');assert.equal(body.messages.at(-1).tool_call_id,'analysis');
    return reply({content:'已计算二倍增益。'});
  }});
  const run=await runAgent(provider,registry);assert.deepEqual(registry.result(run.resultId).signal.values,[2,4,2]);assert.equal(run.trace.length,2);
  assert.equal(JSON.stringify(requests).includes('fake-key'),false);
  for(const req of requests)for(const m of req.messages.filter(m=>['tool','user'].includes(m.role)))assert.equal(m.content.includes('"values"'),false);
});
test('provider errors are actionable and never echo upstream credentials; malformed tool JSON rejected',async()=>{
  const context={text:'test',signalInfo:{}},args={messages:[],tools:[],signal:new AbortController().signal};
  for(const status of [401,403,404,429,500]){
    const provider=createProvider('openai',{apiKey:'secret',model:'m'},context,{fetchImpl:async()=>new Response('secret',{status})});
    await assert.rejects(provider.next(args),e=>e.message.includes(String(status))&&!e.message.includes('secret'));
  }
  await assert.rejects(createProvider('deepseek',{apiKey:'secret',model:'m'},context,{fetchImpl:async()=>reply({tool_calls:[{id:'bad',type:'function',function:{name:'run_analysis',arguments:'{broken'}}]})}).next(args),/合法 JSON/);
  await assert.rejects(createProvider('openai',{},context,{fetchImpl:async()=>new Response('not-json')}).next(args),/无效 JSON/);
  await assert.rejects(createProvider('openai',{},context,{fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'partial'}}]}))}).next(args),/截断/);
});
test('runner sends tool validation errors back for correction, invalid latest analysis clears old result',async()=>{
  const registry=createRegistry(),stored=registry.add(input);let turn=0;
  const result=await runAgent({async next({messages}){turn++;if(turn===1)return {toolCalls:[{id:'bad',name:'run_analysis',arguments:{signalId:stored.signalId,operations:[{type:'filter',family:'iir',response:'lowpass',cutoffHz:9999}]}}]};if(turn===2){assert.match(messages[0].result.error,/截止/);return {toolCalls:[{id:'good',name:'run_analysis',arguments:{signalId:stored.signalId,operations:[]}}]};}return {text:'已修正'};}},registry);
  assert.deepEqual(result.trace.map(t=>t.status),['failed','completed']);assert.ok(result.resultId);
  let next=0;const stale=await runAgent({async next(){next++;return next<3?{toolCalls:[{id:String(next),name:'run_analysis',arguments:{signalId:stored.signalId,operations:next===1?[]:[{type:'unsupported'}]}}]}:{text:'无法完成'};}},registry);assert.equal(stale.resultId,null);
});
test('runner cancels stalled requests and bounds total tool calls',async()=>{
  const controller=new AbortController();let providerSignal;
  const running=runAgent({next({signal}){providerSignal=signal;return new Promise(()=>{});}},{definitions:[]},{signal:controller.signal});controller.abort();await assert.rejects(running,/取消/);assert.equal(providerSignal.aborted,true);
  await assert.rejects(runAgent({next:async()=>({toolCalls:Array.from({length:4},(_,i)=>({id:String(i),name:'bad',arguments:{}}))})},{definitions:[],execute(){throw new Error('invalid');}}),/超过上限/);
});
test('HTTP model configuration, tool test, scoped signal and resulting preview work for both providers',async t=>{
  const {store}=await storeFor(t);let calls=0;
  const server=createServer({configStore:store,fetchImpl:async(url,init)=>{
    calls++;const body=JSON.parse(init.body),context=JSON.parse(body.messages[1].content),last=body.messages.at(-1);
    if(last.role==='tool')return reply({content:'完成'});
    return reply({tool_calls:[tool('run_analysis',{signalId:context.signal.signalId,operations:context.currentOperations})]});
  }});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  for(const providerId of ['openai','deepseek']){
    const saved=await post('/api/providers',{providerId,model:definitions[providerId].model,apiKey:'fake-secret'});assert.equal(saved.status,200);assert.equal((await saved.text()).includes('fake-secret'),false);
    const tested=await post('/api/providers/test',{providerId});assert.equal(tested.status,200);assert.ok((await tested.json()).resultId);
    const {signalId}=await post('/api/signals',{input}).then(r=>r.json());
    const run=await post('/api/agent/runs',{providerId,signalId,text:'查看信号',operations:[]}).then(r=>r.json());assert.deepEqual(run.result.signal.values,input.values);
  }
  assert.equal(calls,8);
  assert.match(await fetch(base+'/?week=14').then(r=>r.text()),/data-course-week="14"/);
  assert.equal((await post('/api/providers',{providerId:'openai',model:'m',apiKey:'x',url:'https://evil.invalid'})).status,400);
  assert.equal((await fetch(base+'/api/providers',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
});
test('HTTP scopes tools to the registered input and blocks cross-signal requests',async t=>{
  const {store}=await storeFor(t);await store.save('openai',{model:'test-model',apiKey:'fixture-key'});
  let foreignId,sawRejection=false;
  const server=createServer({configStore:store,fetchImpl:async(url,init)=>{
    const b=JSON.parse(init.body),last=b.messages.at(-1);
    if(last.role==='tool'){sawRejection=JSON.parse(last.content).error.includes('只能操作本次');return reply({content:'不能操作另一个信号。'});}
    return reply({tool_calls:[tool('run_analysis',{signalId:foreignId,operations:[]})]});
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,data)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  foreignId=(await post('/api/signals',{input}).then(r=>r.json())).signalId;
  const {signalId}=await post('/api/signals',{input}).then(r=>r.json());
  const result=await post('/api/agent/runs',{providerId:'openai',signalId,text:'尝试跨信号',operations:[]}).then(r=>r.json());
  assert.equal(sawRejection,true);assert.equal(result.resultId,null);assert.equal(result.trace[0].status,'failed');assert.equal(result.result,undefined);
});
test('browser disconnect aborts provider transport and server limits concurrent cloud runs',async t=>{
  const {store}=await storeFor(t);await store.save('openai',{model:'test-model',apiKey:'fixture-key'});
  const started=[],stopped=[];
  const server=createServer({configStore:store,fetchImpl:async(url,init)=>new Promise((resolve,reject)=>{
    started.push(init.signal);init.signal.addEventListener('abort',()=>{stopped.push(true);reject(new Error('aborted'));},{once:true});
  })});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,data,signal)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});
  const waitFor=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('timed out waiting for server lifecycle');};
  const {signalId}=await post('/api/signals',{input}).then(r=>r.json());
  const data={providerId:'openai',signalId,text:'hold',operations:[]},controllers=[new AbortController(),new AbortController()];
  const runs=controllers.map(c=>post('/api/agent/runs',data,c.signal).catch(e=>e));
  try{
    await waitFor(()=>started.length===2);assert.equal((await post('/api/agent/runs',data)).status,429);
  }finally{controllers.forEach(c=>c.abort());await Promise.all(runs);}
  await waitFor(()=>stopped.length===2);assert.ok(started.every(s=>s.aborted));
});
