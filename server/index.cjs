'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createRegistry}=require('./tools.cjs');
const {runAgent,mockProvider}=require('./runner.cjs');
const {plan}=require('../src/assistant.js');
const root=path.resolve(__dirname,'..');
const staticFiles=new Map([
  ['/', ['index.html','text/html']],['/index.html',['index.html','text/html']],
  ['/styles.css',['styles.css','text/css']],
  ...['dsp','assistant','lab','app'].map(name=>[`/src/${name}.js`,[`src/${name}.js`,'text/javascript']]),
]);
function createServer(){
  const registry=createRegistry();
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  function body(req){return new Promise((resolve,reject)=>{
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')){reject(Object.assign(new Error('仅接受 application/json。'),{status:415}));req.resume();return;}
    let size=0,chunks=[],failed=false;
    req.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){if(!failed){failed=true;chunks=[];reject(Object.assign(new Error('请求不能超过 1 MiB。'),{status:413}));}}else if(!failed)chunks.push(chunk);});
    req.on('end',()=>{if(!failed)try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('JSON 格式错误。'));}});
    req.on('error',reject);
  });}
  const server=http.createServer(async(req,res)=>{
    try{
      const port=server.address().port,hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
      if(!hosts.includes(req.headers.host))return json(res,403,{error:{code:'FORBIDDEN_HOST',message:'仅接受本机地址。'}});
      if(req.headers.origin&&!hosts.map(h=>`http://${h}`).includes(req.headers.origin))return json(res,403,{error:{code:'FORBIDDEN_ORIGIN',message:'仅接受本机同源请求。'}});
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:{code:'ORIGIN_MISMATCH',message:'网页与 API 必须同源。'}});
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(req.method==='GET'&&staticFiles.has(url.pathname)){
        const [file,type]=staticFiles.get(url.pathname);
        res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(await fs.readFile(path.join(root,file)));
      }
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',version:'0.9.0',mode:'local-mock',cloudProvidersEnabled:false});
      if(req.method==='GET'&&url.pathname==='/api/tools')return json(res,200,{schemaVersion:1,tools:registry.definitions});
      if(req.method==='GET'&&url.pathname==='/api/providers')return json(res,200,{providers:[{id:'openai',status:'planned-delivery-10'},{id:'deepseek',status:'planned-delivery-11'}],acceptsApiKeys:false});
      if(req.method==='GET'&&url.pathname.startsWith('/api/results/'))return json(res,200,registry.result(url.pathname.slice('/api/results/'.length)));
      if(req.method!=='POST')return json(res,404,{error:{code:'NOT_FOUND',message:'接口不存在。'}});
      if(!['/api/signals','/api/tools/call','/api/agent/preview','/api/agent/runs'].includes(url.pathname))return json(res,404,{error:{code:'NOT_FOUND',message:'接口不存在。'}});
      const data=await body(req);
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('请求必须是 JSON 对象。');
      if(url.pathname==='/api/signals')return json(res,201,registry.add(data.input));
      if(url.pathname==='/api/tools/call')return json(res,200,registry.execute(data.name,data.arguments));
      if(url.pathname==='/api/agent/preview')return json(res,200,plan(data.text,data.task));
      if(url.pathname==='/api/agent/runs'){
        if(data.mode!=='mock')throw new Error('本版仅实现 mock 工具流程，真实模型将在第 10 / 11 次接入。');
        const run=await runAgent(mockProvider(data.signalId,data.operations),registry);
        return json(res,200,{mode:'mock',...run});
      }
    }catch(error){if(!res.headersSent)json(res,error.status??400,{error:{code:'INVALID_REQUEST',message:error.message}});else res.end();}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return server;
}
if(require.main===module){
  const port=Number(process.env.DSP_PORT??8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('DSP_PORT 必须为 1—65535 的整数。');
  const server=createServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${port} 已占用；关闭旧服务或设置 DSP_PORT。`:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`DSP v0.9 本地服务：http://127.0.0.1:${port}\n仅本机可访问。当前为离线/模拟工具模式，不调用云端模型。按 Ctrl+C 停止。`));
}
module.exports={createServer};
