// Local-light storage tools. No server, model call, notebook execution or public listener.
import {readFile,realpath} from 'node:fs/promises';
import {desktopFiles,planDesktopStorage,commitDesktopStorage,fetchDesktopFile,proveDesktopFiles,enableDesktopFirst} from '../server/syncColdStore.ts';
import {configureSyncNetwork,readSyncNetworkPolicy,syncNetworkAllowed} from '../server/syncNetwork.ts';
import {enableBulkSync} from '../server/syncBulkCapture.ts';
const argv=process.argv.slice(2),command=argv.shift(),flags:Record<string,string>={};
try{
 if(!command||command==='--help'){console.log('Aw desktop-backed files (no server or model calls)\nnode scripts/awStore.ts status --workspace HOME --project ID\nnode scripts/awStore.ts offload --workspace HOME --project ID --peer HASH\nnode scripts/awStore.ts offload --workspace HOME --project ID --plan HASH --commit\nnode scripts/awStore.ts fetch --workspace HOME --project ID --path EXACT_PATH\nnode scripts/awStore.ts enable --workspace HOME\nnode scripts/awStore.ts network --workspace HOME [--file POLICY.json | --check]\nOffload requires verified immutable desktop copies; source/notes/notebooks/figures stay local. Fetch pins the restored file locally. Never edit a remote-only path by creating an empty placeholder.');process.exit(0);}
 const allowed=new Set(['workspace','project','peer','plan','path','file','commit','check']);
 while(argv.length){const key=argv.shift()!;if(!key.startsWith('--')||!allowed.has(key.slice(2))||key.slice(2) in flags)throw new Error('Unknown/duplicate storage option.');flags[key.slice(2)]=['--commit','--check'].includes(key)?'yes':argv.shift()??'';}
 const home=await realpath(flags.workspace??'.');let result;
 if(command==='status')result=await desktopFiles(home,flags.project);
 else if(command==='enroll')result=await enableBulkSync(home,flags.project);
 else if(command==='enable'){await enableDesktopFirst(home);result={desktopFirst:true};}
 else if(command==='network')result=flags.file?await configureSyncNetwork(home,JSON.parse(await readFile(flags.file,'utf8'))):flags.check?await syncNetworkAllowed(home):await readSyncNetworkPolicy(home)??{configured:false};
 else if(command==='offload')result=flags.commit?await commitDesktopStorage(home,flags.project,flags.plan):await planDesktopStorage(home,flags.project,flags.peer);
 else if(command==='fetch')result=await fetchDesktopFile(home,flags.project,flags.path);
 else if(command==='proof'){let size=0;const chunks:Buffer[]=[];for await(const b of process.stdin){if((size+=b.length)>8*1024**2)throw new Error('Proof request too large.');chunks.push(b);}const r=JSON.parse(Buffer.concat(chunks).toString());result=await proveDesktopFiles(home,flags.project,r.expectedDeviceId,r.records);}
 else throw new Error('Unknown storage command.');
 console.log(JSON.stringify(result));
}catch(e){console.error((e as Error).message);process.exitCode=1;}
