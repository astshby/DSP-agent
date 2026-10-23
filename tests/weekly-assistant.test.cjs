const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Capabilities=require('../src/capabilities.js');
const {plan}=require('../src/assistant.js');
const task={schemaVersion:1,input:{kind:'generated',waveform:'sine',sampleRateHz:1000,count:64,n0:0,frequencyHz:50,phaseDeg:0,amplitude:1,offset:0},operations:[]};
const settings={convolve:{kernel:[1,1,1],n0:0},difference:{b:[1],a:[1,-.5],xHistory:[],yHistory:[],tail:0},response:{b:[.5,.5],a:[1]},zplane:{b:[1],a:[1,-.5]},inverse_z:{pole:.5,side:'right'},zvalue:{radius:1,angleDeg:90},spectrum:{method:'fft',nfft:256,window:'rectangular',removeMean:false},filter:{family:'fir',response:'lowpass',cutoffHz:100,taps:51,window:'hamming'}};
const weeks=['第五周','第六周','第七周','第八周','第九周','第十周','第十一周','第十二周'];

for(const [index,name] of weeks.entries())test(`${name}: every suggested request runs on that week's actual historical DSP`,()=>{
  const week=index+5,profile=Capabilities.forWeek(week),html=fs.readFileSync(`self/${name}/index.html`,'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const core=scripts.find(s=>s.includes('function runAnalysis(task)'));
  assert.ok(core,'historical DSP core missing');
  const context=vm.createContext({});vm.runInContext(core,context);
  vm.runInContext(fs.readFileSync('src/capabilities.js','utf8'),context);
  vm.runInContext(fs.readFileSync('src/assistant.js','utf8'),context);
  let current=task;
  for(const text of profile.examples){
    const proposed=context.RuleAssistant.plan(text,current,settings,profile);
    assert.equal(proposed.status,'ready',`${text}: ${proposed.message}`);
    const result=context.DSP.runAnalysis(proposed.task);
    assert.ok(Number.isFinite(result.metrics.energy));current=result.task;
  }
});

test('weekly allowlists are cumulative and reject every future operation before execution',()=>{
  const commands={transform:'放大2倍',convolve:'卷积[1,1]',difference:'差分方程 b=[1] a=[1,-0.5]',dtft:'DTFT',response:'查看系统频响 b=[1] a=[1,-0.5]',zplane:'查看零极点 b=[1] a=[1,-0.5]',inverse_z:'逆z变换 p=0.5 右边',zvalue:'z变换 模1 辐角90度',spectrum:'FFT',filter:'低通100Hz'};
  for(let week=5;week<=13;week++){
    const profile=Capabilities.forWeek(week);
    for(const [type,text] of Object.entries(commands)){
      const result=plan(text,task,settings,profile);
      assert.equal(result.status,profile.allowed.includes(type)?'ready':'needs_input',`${week}: ${text}: ${result.message}`);
      if(!profile.allowed.includes(type)){assert.equal(result.task,null);assert.match(result.message,/尚未开放/);}
    }
    if(week>5)for(const type of Capabilities.forWeek(week-1).allowed)assert.ok(profile.allowed.includes(type));
  }
});

test('week five can generate, edit sampling metadata, inspect, and retain the no-operation core contract',()=>{
  const profile=Capabilities.forWeek(5);
  const sine=plan('请生成100Hz正弦信号，采样率1000Hz，样本数32，幅值2，相位90度',task,{},profile);
  assert.equal(sine.status,'ready',sine.message);assert.equal(sine.task.input.amplitude,2);assert.equal(sine.task.input.count,32);assert.deepEqual(sine.task.operations,[]);
  const changed=plan('采样率改成2000Hz',sine.task,{},profile);assert.equal(changed.task.input.sampleRateHz,2000);
  const manual=plan('输入序列[1,2,1]，首项下标-1',task,{},profile);assert.deepEqual(manual.task.input.values,[1,2,1]);
  const inspected=plan('查看均值和RMS以及能量',manual.task,{},profile);assert.equal(inspected.status,'ready',inspected.message);assert.deepEqual(inspected.task.operations,[]);
  assert.equal(plan('生成双频信号',task,{},profile).status,'needs_input');
  assert.equal(plan('输入序列[1,2]然后FFT',task,{},profile).task,null);
});
