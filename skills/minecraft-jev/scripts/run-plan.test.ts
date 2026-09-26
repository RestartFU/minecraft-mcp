import { test, expect } from 'bun:test';
import { runPlan, validatePlan, localMatch } from './run-plan';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const screen={description:'Title screen',regions:[[1,1,100,50]],all:['Play','Settings']};
const plan={width:854,height:480,start:screen,steps:[{name:'open',action:{click:[10,10] as [number,number]},after:screen,settle_ms:300}]};
test('unknown screen emits no input',async()=>{
 const calls:string[]=[];const dir=await mkdtemp(join(tmpdir(),'jev-plan-test-'));
 try{
  const adapter={call:async(cmd:string)=>{calls.push(cmd);return cmd==='state'?{width:854,height:480}:{width:854,height:480,source_width:854,png_base64:''};}};
  const r=await runPlan(adapter,async()=>({observation:'unknown modal'}),plan,dir);
  expect(r.status).toBe('fallback');expect(r.completed).toBe(0);expect(calls).toEqual(['state','screenshot']);
 }finally{await rm(dir,{recursive:true});}
});
test('changed dimensions emit no input',async()=>{
 const calls:string[]=[];const dir=await mkdtemp(join(tmpdir(),'jev-plan-test-'));
 try{await expect(runPlan({call:async(cmd:string)=>{calls.push(cmd);return {width:900,height:600};}},async()=>({}),plan,dir)).rejects.toThrow('dimensions');expect(calls).toEqual(['state']);}
 finally{await rm(dir,{recursive:true});}
});
test('model error cannot authorize an action',async()=>{
 const calls:string[]=[];const dir=await mkdtemp(join(tmpdir(),'jev-plan-test-'));
 try{const r=await runPlan({call:async(cmd:string)=>{calls.push(cmd);return {width:854,height:480,source_width:854,png_base64:''};}},async()=>({choice:'match',error:'timeout'}),plan,dir,'jev');expect(r.status).toBe('fallback');expect(calls).toEqual(['state','screenshot']);}
 finally{await rm(dir,{recursive:true});}
});
test('bad routes are rejected before execution',()=>{
 expect(()=>validatePlan({...plan,steps:[{...plan.steps[0],action:{key:'t'}}]})).toThrow('Unsupported');
 expect(()=>validatePlan({...plan,start:{...screen,regions:[[0,0,1000,500]]}})).toThrow('region');
});
test('literal matching requires every observed label',()=>{
 expect(localMatch('Servers\nCreate new worid',{...screen,all:['Servers','Create new world|Create new worid']})).toBe(true);
 expect(localMatch('Settings',screen)).toBe(false);
});
test('known labels complete without Jev calls in hybrid mode',async()=>{
 const requests:any[]=[];const dir=await mkdtemp(join(tmpdir(),'jev-plan-test-'));
 try{
  const r=await runPlan({call:async()=>({width:854,height:480,source_width:854,png_base64:''})},async(req:any)=>{requests.push(req);return {observation:'Play Settings'};},plan,dir,'hybrid');
  expect(r.status).toBe('complete');expect(requests.length).toBe(2);expect(requests.every(r=>r.mode==='ocr')).toBe(true);
 }finally{await rm(dir,{recursive:true});}
});
test('hybrid consults Jev on an unmatched observation and stops on abstention',async()=>{
 const requests:any[]=[];const calls:string[]=[];const dir=await mkdtemp(join(tmpdir(),'jev-plan-test-'));
 try{
  const r=await runPlan({call:async(cmd:string)=>{calls.push(cmd);return {width:854,height:480,source_width:854,png_base64:''};}},async(req:any)=>{requests.push(req);return req.mode==='ocr'?{observation:'unrecognized dialog'}:{choice:'fallback'};},plan,dir,'hybrid');
  expect(r.status).toBe('fallback');expect(requests.length).toBe(2);expect(requests[1].state).toBe('unrecognized dialog');expect(calls).toEqual(['state','screenshot']);
 }finally{await rm(dir,{recursive:true});}
});
test('failed input still releases the pressed button',async()=>{
 const actions:string[]=[];const dir=await mkdtemp(join(tmpdir(),'jev-plan-test-'));
 try{
  await expect(runPlan({call:async(cmd:string,args:any)=>{if(cmd==='click'){actions.push(args.action);if(args.action==='press')throw Error('failed click');}return {width:854,height:480,source_width:854,png_base64:''};}},async()=>({observation:'Play Settings'}),plan,dir,'local')).rejects.toThrow('failed click');
  expect(actions).toEqual(['press','release']);
 }finally{await rm(dir,{recursive:true});}
});
