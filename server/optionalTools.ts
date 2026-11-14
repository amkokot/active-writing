import {readFile,readdir} from 'node:fs/promises';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {syncHash} from './syncProtocol.ts';

const file='.paperfocus/optional-tools.json';
export async function readOptionalTools(home:string){
 try{
  const raw=await readFile(await guardedTarget(home,file));
  if(raw.length>2000)throw Error('Optional-tool settings are too large.');
  const value=JSON.parse(raw.toString());
  if(value.version!==1||typeof value.sync!=='boolean'||Object.keys(value).sort().join(',')!=='sync,version')throw Error('Invalid optional-tool settings.');
  return {revision:syncHash(raw),sync:value.sync};
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 // Preserve the visibility of already configured pairs. No SSH or project scan.
 let sync=false;
 const folder=await guardedTarget(home,'.paperfocus/device-sync/auto/placeholder');
 try{
  const entries=await readdir(folder.slice(0,-'placeholder'.length),{withFileTypes:true});
  for(const entry of entries.slice(0,200).filter(e=>e.isDirectory()&&!e.isSymbolicLink())){
   try{const raw=await readFile(await guardedTarget(home,`.paperfocus/device-sync/auto/${entry.name}/config.json`));if(raw.length<10000&&JSON.parse(raw.toString()).enabled===true){sync=true;break;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return {revision:'',sync};
}
export async function saveOptionalTools(home:string,revision:string,sync:boolean){
 if(typeof sync!=='boolean')throw Error('Choose whether to show two-computer tools.');
 const current=await readOptionalTools(home);if(current.revision!==revision)throw Error('Optional-tool settings changed. Reopen the menu.');
 const next=await saveGuardedFile(home,file,revision,Buffer.from(JSON.stringify({version:1,sync})+'\n'),2000);
 return {revision:next,sync};
}
