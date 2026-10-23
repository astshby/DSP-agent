'use strict';
// Reproducible, idempotent enhancement. Keep every historical DSP core intact.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const weeks=['第五周','第六周','第七周','第八周','第九周','第十周','第十一周','第十二周'];
const start='<!-- WEEKLY_ASSISTANT_START -->',end='<!-- WEEKLY_ASSISTANT_END -->';
const script=file=>`<script>\n${fs.readFileSync(path.join(root,file),'utf8').replace(/<\/script/gi,'<\\/script')}\n</script>`;
function requiredReplace(html,before,after){if(!html.includes(before))throw new Error('Historical page anchor missing: '+before);return html.replace(before,after);}
for(const [index,week] of weeks.entries()){
  const courseWeek=index+5,file=path.join(root,'self',week,'index.html');
  let html=fs.readFileSync(file,'utf8');
  html=html.replace(/<!-- WEEKLY_ASSISTANT_START -->[\s\S]*?<!-- WEEKLY_ASSISTANT_END -->\n?/g,'');
  if(!html.includes('/* WEEKLY_API_BRIDGE */')){
    // The original app supplies rendering and the original week's validator.
    if(courseWeek===5){
      const bridge=`  /* WEEKLY_API_BRIDGE */
  window.WeeklyLab={readTask,getResult:()=>lastResult,status,runTask(task){
    const result=DSP.runAnalysis(task),input=result.task.input;
    form.elements.source.value=input.kind;
    $('start-index').value=input.n0;$('sample-rate').value=input.sampleRateHz??'';
    if(input.kind==='manual')$('sequence').value=input.values.join(', ');
    else for(const [key,id] of Object.entries({waveform:'waveform',frequencyHz:'frequency',phaseDeg:'phase',amplitude:'amplitude',offset:'offset',count:'sample-count',position:'position'}))if(input[key]!==undefined)$(id).value=input[key];
    updateFields();render(result);lastResult=result;return result;
  }};
`;
      html=requiredReplace(html,'  updateFields(); run();\n})();',bridge+'  updateFields(); run();\n})();');
    }else html=requiredReplace(html,'    api = controller;','    /* WEEKLY_API_BRIDGE */\n    window.WeeklyLab = controller;\n    api = controller;');
    // Only the app's renderer has this adjacent destructuring anchor.
    html=requiredReplace(html,'  function render(result) {\n    const { signal, metrics, task } = result;',"  function render(result) {\n    document.dispatchEvent(new CustomEvent('weekly-result',{detail:result}));\n    const { signal, metrics, task } = result;");
  }
  html=html.replace(/<body(?: data-offline-assistant-week="\d+")?>/,`<body data-offline-assistant-week="${courseWeek}">`);
  const enhancement=`${start}\n<style>\n${fs.readFileSync(path.join(root,'styles-weekly-assistant.css'),'utf8')}\n</style>\n${['src/capabilities.js','src/assistant.js','src/weekly-assistant.js'].map(script).join('\n')}\n${end}\n`;
  html=requiredReplace(html,'</body>',enhancement+'</body>');
  fs.writeFileSync(file,html);
  const profile=require('../src/capabilities.js').forWeek(courseWeek);
  const report=path.join(root,'self',week,'README.md');
  let markdown=fs.readFileSync(report,'utf8').replace(/\n?<!-- WEEKLY_ASSISTANT_REPORT_START -->[\s\S]*?<!-- WEEKLY_ASSISTANT_REPORT_END -->\n?/g,'').trimEnd();
  markdown+='\n\n<!-- WEEKLY_ASSISTANT_REPORT_START -->\n## 离线助手补充（v0.9.2 回填）\n\n本页现在包含第十三周规则助手的本周子集，仍调用本周原有 DSP 程序。断网双击即可使用；不需要服务器、模型或 API Key。\n\n本周累计能力：'+profile.summary+'。\n\n可直接点击页面上的示例，也可以输入：\n\n'+profile.examples.map(text=>'- `'+text+'`').join('\n')+'\n\n先点“解析并预览”，检查参数来源，再执行。参数会同步到原表单；修改要求或表单后，旧预览失效。缺少参数时可补充文字或先填写本周设置；CSV 仍由浏览器文件选择器导入，再对当前信号发出要求。\n\n请求后续周次的操作会提示尚未开放，不会执行一半任务。每周能力和更多例子见根目录 `docs/每周离线助手.md`；自动验证包含本周真实 DSP、示例执行、未来功能拒绝和窄屏交互。\n<!-- WEEKLY_ASSISTANT_REPORT_END -->\n';
  fs.writeFileSync(report,markdown);
  console.log(`Enhanced ${week}: original DSP + week ${courseWeek} assistant subset`);
}
