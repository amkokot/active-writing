import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
export async function maintenanceEnabled(){
 if(process.platform!=='linux'||!process.getuid)return false;
 try{return JSON.parse(await readFile(`/var/tmp/aw-maintenance-${process.getuid()}/enabled.json`,'utf8')).enabled===true;}catch{return false;}
}
export async function maintenanceReport(projectId:string,detail:string){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)||typeof detail!=='string'||detail.length>6000)throw Error('Invalid maintenance incident');
 if(!await maintenanceEnabled())return {phase:'attention',detail:'Desktop maintenance is unavailable',updatedAt:new Date().toISOString()};
 const tool=fileURLToPath(new URL('../scripts/awMaintenance.py',import.meta.url));
 return await new Promise<any>((resolve,reject)=>{
  const child=spawn('python3',['-B',tool,'report'],{cwd:path.dirname(tool),stdio:['pipe','pipe','pipe'],shell:false});let output='',error='';
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Maintenance submission timed out'));},5000);
  child.stdout.on('data',b=>{output+=b;if(output.length>16000)child.kill('SIGTERM');});child.stderr.on('data',b=>{error=(error+b).slice(-1000);});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);try{if(code!==0||output.length>16000)throw Error(error||'Maintenance submission failed');const value=JSON.parse(output);if(!['queued','working','waiting','attention','deployed','done'].includes(value.phase))throw Error('Invalid maintenance state');resolve(value);}catch(e){reject(e);}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({version:1,projectId,observedAt:new Date().toISOString(),status:'held',detail}));
 });
}
