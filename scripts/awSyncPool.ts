// One laptop process shares the already guarded followers; no worker per tab.
import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {setPriority,constants} from 'node:os';
import {autoSyncStatus} from '../server/syncAuto.ts';
import {followLiveReading} from '../server/syncLive.ts';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--workspace'||args[2]!=='--exclude'||!/^[-A-Za-z0-9_]{1,100}(?:,[-A-Za-z0-9_]{1,100}){0,31}$/.test(args[3]))throw Error('Use --workspace HOME --exclude EXISTING_LIVE_PROJECT[,PROJECT]');
const home=path.resolve(args[1]),excluded=new Set(args[3].split(',')),controller=new AbortController();
try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const projects=await readdir(path.join(home,'.paperfocus/device-sync/auto'),{withFileTypes:true});
const work=[];
for(const item of projects){
 if(!item.isDirectory()||excluded.has(item.name)||!/^[A-Za-z0-9_-]{1,100}$/.test(item.name))continue;
 const {config}=await autoSyncStatus(home,item.name);
 if(!config?.enabled||!config.readingOnly||config.mode!=='safe')continue;
 work.push(followLiveReading(home,item.name,controller.signal,value=>console.log(JSON.stringify({projectId:item.name,...value as object})),{fastOnly:true}));
 // Stagger initial SSH setup; ongoing passes share the single fast slot.
 await new Promise(resolve=>setTimeout(resolve,400));
}
await Promise.all(work);
