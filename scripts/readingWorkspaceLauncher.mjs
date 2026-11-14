// Open an independent first-copy home without replacing the user's main Aw service.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {validateLaunchWorkspace,serverState,runWindowsCommand} from './desktopLauncher.mjs';

export function readingPort(home){return 4300+parseInt(createHash('sha256').update(path.resolve(home).toLowerCase()).digest('hex').slice(0,6),16)%700;}
export function readingOptions(args){
 if(args[0]!=='--workspace'||!args[1]||args[1].startsWith('--')||args.slice(2).some(x=>x!=='--no-browser')||args.length>3)throw Error('Use --workspace NEW_DATA_HOME [--no-browser]');
 return {workspace:path.resolve(args[1]),browser:!args.includes('--no-browser')};
}
export async function openReadingWorkspace(options){
 const home=validateLaunchWorkspace(options.workspace),port=readingPort(home),url=`http://127.0.0.1:${port}/`;
 const state=await serverState(url,home);
 if(state==='other')throw Error('The reading workspace port is occupied by a different service. Nothing stopped.');
 if(state==='offline'){
  const folder=path.join(home,'.paperfocus/launcher');mkdirSync(folder,{recursive:true});
  const out=openSync(path.join(folder,'server.stdout.log'),'a'),err=openSync(path.join(folder,'server.stderr.log'),'a');
  const code=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const child=spawn(process.execPath,[path.join(code,'scripts/desktopServer.mjs'),'--workspace',home,'--port',String(port)],{cwd:code,detached:true,windowsHide:true,stdio:['ignore',out,err]});
  closeSync(out);closeSync(err);
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  writeFileSync(path.join(folder,'server.pid'),String(child.pid));child.unref();
  let ready=false;
  for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));if(await serverState(url,home)==='ready'){ready=true;break;}}
  if(!ready)throw Error('Reading workspace did not become ready; inspect its launcher logs. No other service was restarted.');
 }
 if(options.browser){if(process.platform!=='win32')throw Error('Open the returned local URL in your browser. Automatic browser opening is Windows-only.');await runWindowsCommand(`Start-Process -FilePath '${url}' -WindowStyle Normal`);}
 return {workspace:home,url,reused:state==='ready'};
}
if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase())openReadingWorkspace(readingOptions(process.argv.slice(2))).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
