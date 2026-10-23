/* Course-week capability profiles shared by the full lab and standalone pages. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourseCapabilities = api;
})(globalThis, function () {
  'use strict';
  const names = Object.freeze({input:'信号生成 / 手动序列 / 采样参数',inspect:'波形与统计读数',transform:'缩放 / 移位 / 反折',convolve:'线性卷积',difference:'差分方程与初始历史',dtft:'有限序列 DTFT',response:'系统频率响应',zplane:'零极点 / 因果 ROC',inverse_z:'典型逆 z 变换',zvalue:'有限序列 z 求值',spectrum:'DFT / FFT 频谱',filter:'FIR / 二阶 IIR 滤波'});
  const additions = {5:['input','inspect'],6:['transform'],7:['convolve'],8:['difference'],9:['dtft','response'],10:['zplane','inverse_z','zvalue'],11:['spectrum'],12:['filter'],13:[]};
  const examples = {
    5:['请生成 100Hz 正弦信号，采样率 1000Hz，样本数 64','输入序列 [1,2,1]，首项下标 -1','查看能量和 RMS'],
    6:['请把当前序列放大 2 倍，然后移位 -3','反折','查看能量'],
    7:['请计算卷积 [1,2,1]，首项下标 -1','按页面设置做卷积','卷积改成 [1,0,-1]'],
    8:['请做差分方程，b=[1]，a=[1,-0.5]，输出历史 [2]','根据页面设置做差分方程','差分方程改成 b=[1]，a=[1,-0.8]'],
    9:['请分析当前序列 DTFT','查看系统频率响应，b=[0.5,0.5]，a=[1]','卷积 [1,1] 然后 DTFT'],
    10:['请查看零极点，b=[1]，a=[1,-0.5]','逆 z 变换，p=0.5，左边','计算 z 变换，模 1，辐角 90度'],
    11:['请用 Hann 窗查看 256 点 FFT','频谱改成 128 点 DFT，矩形窗','查看频谱，先去均值'],
    12:['请用 31 抽头 Hamming 做 0.2kHz 低通，再看频谱','截止改成 150Hz','换成二阶 IIR'],
    13:['请用 31 抽头 Hamming 做 0.2kHz 低通，再看频谱','截止改成 150Hz','换成二阶 IIR'],
  };
  function forWeek(week = 13) {
    if (!Number.isInteger(week) || week < 5 || week > 13) throw new Error('课程周次必须为 5—13。');
    const allowed = Object.keys(additions).filter(w => Number(w) <= week).flatMap(w => additions[w]);
    return Object.freeze({week,allowed:Object.freeze(allowed),waveforms:Object.freeze(['sine','cosine','impulse','step',...(week >= 12 ? ['multitone','noise'] : [])]),examples:Object.freeze(examples[week]),summary:allowed.map(type => names[type]).join('；')});
  }
  function requireCapability(profile,type) {
    if (!profile.allowed.includes(type)) throw new Error(`第 ${profile.week} 周尚未开放“${names[type] ?? type}”。本周支持：${profile.summary}。`);
  }
  return Object.freeze({forWeek,requireCapability,names});
});
