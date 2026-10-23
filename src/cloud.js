/* Cloud inference is opt-in; all DSP tools run on the local backend. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=window.DSPLab;
  if(!api)return;
  const panel=document.createElement('section');panel.className='card cloud-panel';
  const week14=document.body.dataset.courseWeek==='14';
  panel.innerHTML=`<h2>云端模型助手</h2><p class="field-help">${week14?'第十四周：OpenAI':'第十五周：OpenAI / DeepSeek'}。模型理解实验要求并调用本地 DSP 工具；结果先预览，再应用。</p>
    <p id="cloud-connection" role="status">正在检查本地服务…</p>
    <label for="cloud-provider">服务商</label><select id="cloud-provider"><option value="openai">OpenAI</option>${week14?'':'<option value="deepseek">DeepSeek</option>'}</select>
    <details id="cloud-settings"><summary>模型设置与连接测试</summary>
    <p class="field-help" id="cloud-endpoint"></p><label for="cloud-model">模型 ID</label><input id="cloud-model" autocomplete="off" spellcheck="false">
    <label for="cloud-key">API Key（留空保留已保存密钥）</label><input id="cloud-key" type="password" autocomplete="new-password" spellcheck="false">
    <p class="field-help">仅保存到本机用户目录的 .dsp-agent/providers.json，不进入任务导出。该文件为明文；Unix 文件权限为 600，Windows 沿用用户目录权限。ChatGPT 订阅不含 API 额度。</p>
    <div class="cloud-actions"><button type="button" id="cloud-save">保存配置</button><button type="button" id="cloud-delete">删除此服务商配置</button><button type="button" id="cloud-test">测试模型与工具</button></div>
    <p class="field-help">连接测试与实验请求会调用官方 API，可能产生费用。密钥只发送给所选官方服务；信号摘要、处理参数及输入文字会发给模型，原始样值保留在本机。</p></details>
    <label for="cloud-text">实验要求</label><textarea id="cloud-text" rows="4" maxlength="4000" placeholder="保留当前信号的低频部分，采用二阶 IIR，再比较频谱。请解释选择的参数。"></textarea>
    <p class="field-help">每次发送当前输入与完整处理步骤，可继续说“截止改为 150 Hz”。需要生成或上传新信号时，先使用左侧输入区。每次最多 6 轮、8 次工具调用、90 秒。</p>
    <div class="cloud-actions"><button type="button" id="cloud-run">发送给模型并预览</button><button type="button" id="cloud-cancel" disabled>取消请求</button><button type="button" id="cloud-apply" disabled>应用计算结果</button><button type="button" id="cloud-export" disabled>下载模型记录</button></div>
    <pre id="cloud-output" role="status" aria-live="polite">模型解释供实验参考，以本地计算和教材为准。</pre>`;
  document.querySelector('.stage').append(panel);
  let providers=[],available=false,busy=false,controller=null,pending=null,revision=0,record=null;
  const show=text=>{$('cloud-output').textContent=text;};
  function buttons(){for(const id of ['cloud-provider','cloud-model','cloud-key','cloud-save','cloud-delete','cloud-test','cloud-run'])$(id).disabled=!available||busy;$('cloud-cancel').disabled=!busy;$('cloud-apply').disabled=!pending||busy;$('cloud-export').disabled=!record||busy;}
  function invalidate(){revision++;if(pending){pending=null;show('实验参数或要求已修改，请重新发送给模型。');}buttons();}
  document.addEventListener('input',e=>{invalidate();});
  document.addEventListener('dsp-result',invalidate);
  async function request(url,data,signal){const response=await fetch(url,{...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),signal:signal||AbortSignal.timeout(10000)});let value;try{value=await response.json();}catch{throw new Error('未找到兼容的本地服务，请运行 npm start 并打开终端中的地址。');}if(!response.ok)throw new Error(value.error?.message||'本地服务请求失败。');return value;}
  function settings(){const p=providers.find(p=>p.id===$('cloud-provider').value);if(!p)return;$('cloud-model').value=p.model;$('cloud-key').value='';$('cloud-endpoint').textContent=p.url;$('cloud-connection').textContent=`本地服务已连接 · ${p.label} ${p.configured?'密钥已保存':'尚未配置密钥'}`;}
  async function action(fn){if(busy)return;busy=true;controller=new AbortController();buttons();try{await fn(controller.signal);}catch(e){show(controller.signal.aborted?'请求已取消，当前实验保持不变。':e.message);}finally{busy=false;controller=null;buttons();}}
  $('cloud-provider').addEventListener('change',()=>{invalidate();settings();});
  $('cloud-save').addEventListener('click',()=>action(async signal=>{invalidate();const data={providerId:$('cloud-provider').value,model:$('cloud-model').value.trim(),apiKey:$('cloud-key').value.trim()};$('cloud-key').value='';providers=(await request('/api/providers',data,signal)).providers;settings();show('配置已保存。点击“测试模型与工具”验证实际调用。');}));
  $('cloud-delete').addEventListener('click',()=>action(async signal=>{invalidate();providers=(await request('/api/providers',{providerId:$('cloud-provider').value,remove:true},signal)).providers;settings();show('此服务商的本地配置已删除。');}));
  $('cloud-test').addEventListener('click',()=>action(async signal=>{invalidate();show('正在验证模型与实际 DSP 工具调用…');const r=await request('/api/providers/test',{providerId:$('cloud-provider').value},signal);show(`连接与工具调用通过：${r.providerId} / ${r.model}\n${r.text}\n${r.trace.map(t=>`${t.name}：${t.status}`).join('\n')}`);}));
  $('cloud-run').addEventListener('click',()=>action(async signal=>{
    pending=null;record=null;buttons();const text=$('cloud-text').value.trim();if(!text)throw new Error('请先填写实验要求。');
    const task=DSP.runAnalysis(api.readTask()).task,snapshot=JSON.stringify(api.readTask()),started=revision;
    show('正在请求模型并执行本地工具；完成后显示预览…');
    const stored=await request('/api/signals',{input:task.input},signal);
    const r=await request('/api/agent/runs',{providerId:$('cloud-provider').value,text,signalId:stored.signalId,operations:task.operations},signal);
    if(signal.aborted)return;
    if(revision!==started||snapshot!==JSON.stringify(api.readTask()))throw new Error('请求期间实验或要求已改变，本次返回结果已丢弃，请重新发送。');
    if(r.result){const local=DSP.runAnalysis(r.result.task);if(!DSP.compareResults(local,r.result).equal)throw new Error('本地复算与后端结果不一致，不能应用。');pending={task:r.result.task,snapshot,revision:started};}
    record={version:'1.0.0',provider:r.providerId,model:r.model,request:text,explanation:r.text,trace:r.trace,task:r.result?.task??null,metrics:r.result?.metrics??null};
    show(`${r.providerId} / ${r.model}\n\n${r.text}\n\n工具记录：\n${r.trace.map(t=>`${t.name}：${t.status}`).join('\n')||'本次未调用工具'}${r.result?`\n\n待应用步骤：\n${r.result.task.operations.map(RuleAssistant.describeOperation).join('\n')||'原始信号（无处理）'}\n\n计算指标：\n${JSON.stringify(r.result.metrics,null,2)}\n\n确认后点击“应用计算结果”。`:'\n\n模型仅回复文字，请补充要求后再发送。'}`);
  }));
  $('cloud-cancel').addEventListener('click',()=>controller?.abort());
  $('cloud-apply').addEventListener('click',()=>{if(!pending)return;if(pending.revision!==revision||pending.snapshot!==JSON.stringify(api.readTask())){invalidate();return;}const task=pending.task;pending=null;try{api.runTask(task);show(`已应用模型配置，图表与读数已更新。\n\n${record?.explanation||''}`);}catch(e){show(e.message);}buttons();});
  $('cloud-export').addEventListener('click',()=>{if(!record)return;const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='dsp-model-record.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  buttons();
  if(!['http:','https:'].includes(location.protocol)){$('cloud-connection').textContent=`当前是离线 HTML。模型模式：在项目目录运行 npm start，再打开 http://127.0.0.1:8787/${week14?'?week=14':''}。`;return;}
  request('/api/health').then(h=>{if(!h.cloudProvidersEnabled)throw new Error('请启动 v1.0 本地服务后使用模型模式。');return request('/api/providers');}).then(r=>{providers=r.providers;available=true;settings();buttons();}).catch(e=>{$('cloud-connection').textContent=e.message;});
})();
