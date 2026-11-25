import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {getProject} from '../server/projects.ts';
import {privateSyncPath,readSyncBytes} from '../server/deviceSync.ts';
import {readingSelection,validateReadingSelection} from '../server/syncReading.ts';
import {canonical,syncHash} from '../server/syncProtocol.ts';
import {guardedTarget,saveGuardedFile} from '../server/guardedFile.ts';
import {saveImmutableSyncArtifact} from '../server/syncStaging.ts';
const args=process.argv.slice(2),command=args.shift(),flags:Record<string,string>={};
for(let i=0;i<args.length;i++){if(args[i]==='--commit')flags.commit='yes';else if(args[i].startsWith('--')&&args[i+1]&&!args[i+1].startsWith('--'))flags[args[i].slice(2)]=args[++i];else throw Error('Use status|set --workspace HOME --project ID [--file SELECTION.json --review HASH --commit].');}
if(!flags.workspace||!flags.project||!['status','set'].includes(command??''))throw Error('Use status|set --workspace HOME --project ID [--file SELECTION.json --review HASH --commit].');
const home=path.resolve(flags.workspace),id=flags.project,{root}=await getProject(home,id),target=await privateSyncPath(home,`reading/${id}/selection.json`,true);
if(command==='status')console.log(JSON.stringify({projectId:id,selection:await readingSelection(home,id)??null,note:'No selection means the ordinary full reading lane. This command never transfers files.'},null,2));
else{
 if(!flags.file)throw Error('Provide the explicit file/notebook selection JSON.');
 const selection=JSON.parse(await readFile(flags.file,'utf8'));validateReadingSelection(selection);
 for(const file of selection.files)await guardedTarget(root,file);
 let raw:Buffer|undefined;try{raw=await readSyncBytes(target,100000);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const expected=raw?syncHash(raw):'',review=syncHash(canonical({projectId:id,expected,selection}));
 if(flags.commit){if(flags.review!==review)throw Error('Reading selection changed; preview again.');
  await saveImmutableSyncArtifact(await privateSyncPath(home,`reading/${id}/selection-history/${review}.json`,true),Buffer.from(JSON.stringify({projectId:id,before:raw?.toString()??null,after:selection})),200000);
  await saveGuardedFile(path.dirname(target),path.basename(target),expected,Buffer.from(JSON.stringify(selection,null,2)),100000);
 }
 console.log(JSON.stringify({projectId:id,review,committed:!!flags.commit,files:selection.files.length,notebooks:selection.notebooks.length,transferStarted:false,note:'Install the same chosen scope on both paired homes. Archives and excluded records are not deleted or acknowledged.'},null,2));
}
