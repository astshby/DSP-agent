/* Enhancement for historical pages. The original week's DSP implementation stays local. */
(function () {
  'use strict';
  const api=window.WeeklyLab,week=Number(document.body.dataset.offlineAssistantWeek);
  if(!api)throw new Error('本周实验接口未就绪。');
  const profile=CourseCapabilities.forWeek(week),$=id=>document.getElementById(id);
  let pending=null;
  const panel=document.createElement('section');panel.className='card weekly-assistant';
  panel.innerHTML='<h2>离线规则助手</h2><p id="assistant-scope" class="field-help"></p><label for="assistant-text">描述本周实验</label><textarea id="assistant-text" rows="3"></textarea><div id="assistant-examples" class="weekly-examples"></div><p id="assistant-context" class="field-help"></p><div class="weekly-actions"><button type="button" id="assistant-prepare">解析并预览</button><button type="button" id="assistant-execute" disabled>执行预览任务</button></div><pre id="assistant-plan" role="status" aria-live="polite"></pre>';
  document.querySelector('.results').append(panel);
  $('assistant-scope').textContent=`第 ${week} 周能力：${profile.summary}。常用句式离线解析；先预览，参数不清楚会提示补充。`;
  $('assistant-text').placeholder=profile.examples[0];
  $('assistant-plan').textContent='选择一个示例，或用自己的话描述本周实验。未注明的参数沿用页面设置；修改时沿用上次操作。';
  function invalidate(message='参数或要求已修改，请重新解析预览。') {
    if(pending){pending=null;$('assistant-execute').disabled=true;$('assistant-plan').textContent=message;}
  }
  for(const text of profile.examples){
    const button=document.createElement('button');button.type='button';button.textContent=text;
    button.addEventListener('click',()=>{$('assistant-text').value=text;invalidate();$('assistant-text').focus();});
    $('assistant-examples').append(button);
  }
  const mapping={convolve:{kernel:'conv-kernel',n0:'conv-n0'},difference:{b:'diff-b',a:'diff-a',xHistory:'diff-x',yHistory:'diff-y',tail:'diff-tail'},response:{b:'response-b',a:'response-a'},zplane:{b:'z-b',a:'z-a'},inverse_z:{pole:'z-pole',side:'z-side'},zvalue:{radius:'z-radius',angleDeg:'z-angle'},spectrum:{method:'spectrum-method',window:'spectrum-window',nfft:'spectrum-nfft',removeMean:'spectrum-mean'},filter:{family:'filter-family',response:'filter-response',cutoffHz:'filter-cutoff',taps:'filter-taps',window:'filter-window'}};
  function settings() {
    const result={};
    for(const [type,fields] of Object.entries(mapping))if(profile.allowed.includes(type)) {
      const values={};
      for(const [key,id] of Object.entries(fields))if($(id))values[key]=$(id).type==='checkbox'?$(id).checked:$(id).value;
      result[type]=values;
    }
    return result;
  }
  function showResult(result) {
    invalidate('实验结果已更新；需要新操作时请重新解析。');
    for(const [type,fields] of Object.entries(mapping)){
      const operation=result.task.operations.findLast(op=>op.type===type);
      if(!operation)continue;
      for(const [key,id] of Object.entries(fields))if($(id)&&operation[key]!==undefined){
        if($(id).type==='checkbox')$(id).checked=operation[key];
        else $(id).value=Array.isArray(operation[key])?operation[key].join(', '):operation[key];
      }
    }
    $('assistant-context').textContent=`当前 ${result.signal.values.length} 项，首项下标 ${result.signal.n0}；${result.task.operations.length} 个处理步骤。`;
  }
  $('assistant-text').addEventListener('input',()=>invalidate());
  document.addEventListener('input',event=>{if(!panel.contains(event.target))invalidate();});
  document.addEventListener('weekly-result',event=>showResult(event.detail));
  $('assistant-prepare').addEventListener('click',()=>{
    try{
      pending=RuleAssistant.plan($('assistant-text').value,api.readTask(),settings(),profile);
      $('assistant-plan').textContent=RuleAssistant.previewText(pending);
      $('assistant-execute').disabled=pending.status!=='ready';
    }catch(error){invalidate();$('assistant-plan').textContent=error.message;}
  });
  $('assistant-execute').addEventListener('click',()=>{
    if(pending?.status!=='ready')return;
    const applied=pending;
    try{
      const result=api.runTask(applied.task);showResult(result);
      const metrics=result.metrics;
      $('assistant-plan').textContent=RuleAssistant.previewText({...applied,message:`已执行。N=${metrics.count}，均值=${Number(metrics.mean.toPrecision(6))}，RMS=${Number(metrics.rms.toPrecision(6))}，能量=${Number(metrics.energy.toPrecision(6))}。`});
    }catch(error){invalidate();$('assistant-plan').textContent=`执行失败：${error.message}。原结果保持不变。`;}
  });
  showResult(api.getResult());
})();
