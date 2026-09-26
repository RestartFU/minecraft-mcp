#!/usr/bin/env bun
// Fixed 854x480 menu benchmark, never joins a server or creates a world.
import { Client } from '/home/danick/.local/share/minecraft-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/home/danick/.local/share/minecraft-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { mkdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const [profileArg, outputArg, trialsArg='3', modesArg='local,jev'] = process.argv.slice(2);
const trials = Number(trialsArg);
const modes=modesArg.split(',');
if(!modes.length || modes.some(m=>!['local','jev'].includes(m)))throw Error('Modes must be local, jev, or local,jev');
if (!profileArg || !outputArg || !Number.isInteger(trials) || trials<1 || trials>10) throw Error('Usage: bun benchmark.ts DEDICATED_PROFILE OUTPUT [trials=3] [local,jev]');
const data='/home/danick/.var/app/io.mrarm.mcpelauncher/data/mcpelauncher';
const profile=await realpath(profileArg);
if(profile===await realpath(data) || !profile.startsWith(resolve(data,'..')+'/')) throw Error('Use dedicated benchmark profile in Flatpak shared data');
const output=resolve(outputArg); await mkdir(output,{recursive:true});
// The inspected calibration file provides ROIs; no model invents coordinates.
const configPath=join(output,'calibration.json');
const env={...process.env,MCPELAUNCHER_CLIENT:'/home/danick/.local/bin/mcpelauncher-headless',MCPELAUNCHER_DATA:data,MCPELAUNCHER_ABI:'x86_64',MCPELAUNCHER_SOCKET_DIR:resolve(data,'../s')};
const client=new Client({name:'minecraft-jev-benchmark',version:'1.0.0'});
const transport=new StdioClientTransport({command:'/home/danick/.local/bin/bun',args:['run','/home/danick/.local/share/minecraft-mcp/src/index.ts'],env});
const helper=spawn('python',[join(import.meta.dir,'decide.py'),'--serve'],{stdio:['pipe','pipe','inherit'],env:{...process.env,OMP_THREAD_LIMIT:'1'}});
const lines=createInterface({input:helper.stdout})[Symbol.asyncIterator]();
async function decide(request:any){helper.stdin.write(JSON.stringify(request)+'\n');const line=await lines.next();if(line.done) throw Error('Decision helper exited');return JSON.parse(line.value);}
const id=`jevbench-${process.pid}`; let owned=false;
async function call(name:string,args:any={}){const result:any=await client.callTool({name,arguments:{instance:id,...args}},undefined,{timeout:60000});if(result.isError)throw Error(`${name} failed`);return result;}
async function capture(label:string){const start=performance.now();const r=await call('screenshot',{width:854});const c=r.content.find((c:any)=>c.type==='image');if(!c)throw Error('Missing frame');const path=join(output,label+'.png');await Bun.write(path,Buffer.from(c.data,'base64'));return {path,ms:performance.now()-start};}
async function click(x:number,y:number){await call('mouse_move_to',{x,y});await Bun.sleep(100);try{await call('click',{x,y,action:'press'});await Bun.sleep(100);}finally{await call('click',{action:'release'});}await Bun.sleep(1500);}
function localChoice(s:string){s=s.toLowerCase();if(/settings/.test(s)&&/play/.test(s))return 'main_menu';if(/create new wor[il]d/.test(s)&&/servers/.test(s))return 'play_screen';return 'fallback';}
const rows:any[]=[];
try{
 await client.connect(transport);await call('list');
 const inv=Bun.spawn(['python','/home/danick/.codex/skills/minecraft-headless/scripts/client_inventory.py','--require-capacity','4'],{stdout:'pipe',stderr:'pipe'});if(await inv.exited!==0)throw Error('Client capacity unavailable');
 owned=true;await call('launch',{id,data_dir:profile,width:854,height:480,hidden:true,fps_cap:30,wait_for_menu:false});
 await Bun.sleep(6000); // controlled startup, excluded from timings; frame must pass classifier below
 const initial=await capture('calibration-main');
 const mainRegions=[[355,257,497,280],[355,288,497,312],[355,320,497,342]];
 const initialOCR=await decide({image:initial.path,regions:mainRegions,mode:'ocr'});
 if(localChoice(initialOCR.observation??'')!=='main_menu')throw Error('Unexpected initial screen; inspect calibration-main.png');
 await click(426,269);await capture('calibration-play');
 console.log(JSON.stringify({calibration:join(output,'calibration-play.png'),waiting_for:configPath}));
 // Up to 3 minutes for visual calibration; never operates another task's client.
 const deadline=performance.now()+180000;while(!await Bun.file(configPath).exists()){if(performance.now()>deadline)throw Error('Calibration timeout');await Bun.sleep(500);}
 const config=await Bun.file(configPath).json();
 await call('key',{key:'escape'});await Bun.sleep(1500);
 for(let trial=0;trial<trials;trial++)for(const mode of (trial%2?[...modes].reverse():modes)){
  const start=performance.now();const before=await capture(`${trial}-${mode}-before`);
  const d=await decide({image:before.path,regions:mainRegions,...(mode==='local'?{mode:'ocr'}:{})});
  const main=mode==='local'?localChoice(d.observation??''):d.choice;
  if(main!=='main_menu')throw Error(`Main screen classification failed: ${JSON.stringify(d)}`);
  await click(426,269);const after=await capture(`${trial}-${mode}-after`);
  const check=await decide({image:after.path,regions:config.play_regions,...(mode==='local'?{mode:'ocr'}:{})});
  const end=mode==='local'?localChoice(check.observation??''):check.choice;
  const row={trial,mode,total_ms:performance.now()-start,screenshot_ms:before.ms+after.ms,decisions:[d,check],success:end==='play_screen',before:before.path,after:after.path};
  rows.push(row);await Bun.write(join(output,'results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({trial,mode,total_ms:row.total_ms,success:row.success}));
  if(!row.success)throw Error('Play screen not verified; inspect saved frame');
  await call('key',{key:'escape'});await Bun.sleep(1500);
 }
}catch(error){
 await Bun.write(join(output,'failure.json'),JSON.stringify({error:String(error),completed_trials:rows.length},null,2));
 throw error;
}finally{
 if(owned)try{await call('stop');}catch{console.error('Owned client cleanup failed; inspect inventory');}
 helper.stdin.end();helper.kill();await client.close();
}
