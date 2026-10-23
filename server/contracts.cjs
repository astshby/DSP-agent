'use strict';
const number={type:'number'};
const integer={type:'integer'};
const values={type:'array',items:number,minItems:1,maxItems:4096};
const coefficients={...values,maxItems:129};
const history={...coefficients,minItems:0};
const choice=(...values)=>({type:'string',enum:values});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const operation=(name,fields={})=>object({type:choice(name),...fields});
const operations={type:'array',maxItems:8,items:{anyOf:[
  operation('transform',{gain:number,shift:integer,reverse:{type:'boolean'}}),
  operation('convolve',{kernel:values,n0:integer}),
  operation('difference',{b:coefficients,a:coefficients,xHistory:history,yHistory:history,tail:{type:'integer',minimum:0,maximum:4095}}),
  operation('dtft'),operation('response',{b:coefficients,a:coefficients}),
  operation('zplane',{b:{...values,maxItems:3},a:{...values,maxItems:3}}),
  operation('inverse_z',{pole:number,side:choice('left','right')}),
  operation('zvalue',{radius:number,angleDeg:number}),
  operation('spectrum',{method:choice('dft','fft'),window:choice('rectangular','hann','hamming'),nfft:{type:'integer',minimum:1,maximum:4096},removeMean:{type:'boolean'}}),
  operation('filter',{family:choice('fir'),response:choice('lowpass','highpass'),cutoffHz:number,taps:{type:'integer',minimum:3,maximum:129},window:choice('rectangular','hann','hamming')}),
  operation('filter',{family:choice('iir'),response:choice('lowpass','highpass'),cutoffHz:number}),
]}};
const tools=[
  {name:'get_signal_info',description:'读取本地信号元数据与统计量，不返回原始样值。先确认采样率再按 Hz 设计滤波。',parameters:object({signalId:{type:'string'}})},
  {name:'run_analysis',description:'对本地信号按顺序执行至多 8 步。系数按 z⁻¹ 升幂；频率 Hz，相位度；返回摘要与结果 ID，原始数据留在本地。',parameters:object({signalId:{type:'string'},operations})},
];
function validate(value,schema,path='arguments'){
  if(schema.anyOf){if(schema.anyOf.some(candidate=>{try{validate(value,candidate,path);return true;}catch{return false;}}))return;throw new Error(`${path} 不符合任何支持的操作契约。`);}
  const type=schema.type;
  if(type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${path} 必须是对象。`);
    for(const key of Object.keys(value))if(!Object.hasOwn(schema.properties,key))throw new Error(`${path}.${key} 是未知字段。`);
    for(const key of schema.required)if(!Object.hasOwn(value,key))throw new Error(`${path}.${key} 缺失。`);
    for(const key of Object.keys(value))validate(value[key],schema.properties[key],`${path}.${key}`);
  }else if(type==='array'){
    if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))throw new Error(`${path} 数组长度无效。`);
    value.forEach((item,i)=>validate(item,schema.items,`${path}[${i}]`));
  }else if(type==='number'||type==='integer'){
    if(typeof value!=='number'||!Number.isFinite(value)||(type==='integer'&&!Number.isSafeInteger(value))||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))throw new Error(`${path} 数值无效。`);
  }else if(typeof value!==type)throw new Error(`${path} 类型无效。`);
  if(schema.enum&&!schema.enum.includes(value))throw new Error(`${path} 值不受支持。`);
}
module.exports={tools,validate};
