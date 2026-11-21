// Explicit inert-file transfers; never a file-triggered job or project synchronizer.
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {readdir,lstat,readFile,rename,rmdir,realpath,link} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {saveImmutableSyncArtifact} from './syncStaging.ts';
import {syncHash} from './syncProtocol.ts';
import {streamedHash} from './syncBlobs.ts';
import {linkedControl} from './linkedWorkspaces.ts';
import {requireSyncNetwork,readSyncNetworkPolicy} from './syncNetwork.ts';
import {spawnOwnedSsh} from './ownedProcess.ts';
import {acquireScheduleLease} from './syncScheduleLock.ts';
import {openExplorer} from './workspaceFolders.ts';

interface Config {version:1;enabled:boolean;host:string;remoteRoot:string;remoteFolder:string}
interface Item {path:string;bytes:number;fingerprint:string}
interface Result {path:string;status:'sent'|'pending';detail?:string;remotePath?:string;recoveryPath?:string}
const settings='.paperfocus/device-sync/transfer-inbox.json',stateFolder='.paperfocus/desktop-transfers';
const maxFile=1024**3,maxBatch=4*1024**3;
const active=new Set<string>();
const fingerprint=(s:Awaited<ReturnType<typeof lstat>>)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);
async function optional(file:string,max=512000){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('Unexpected or oversized transfer record.');return await readFile(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
async function context(workspace:string){
 const home=await linkedControl(await realpath(workspace)),raw=await optional(await guardedTarget(home,settings));
 if(!raw)return {home};const c=JSON.parse(raw.toString()) as Config;
 if(c.version!==1||!c.enabled||!/^[-A-Za-z0-9_]{1,100}$/.test(c.host)||!/^\/(?!\/)/.test(c.remoteRoot)||/[\x00-\x1f]/.test(c.remoteRoot)||c.remoteRoot.split('/').includes('..')||!c.remoteFolder||c.remoteFolder.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f]/.test(p)))throw Error('Desktop transfer settings are disabled or invalid.');
 const inboxTarget=await guardedTarget(home,'Desktop inbox/sentinel',true),inbox=path.dirname(inboxTarget);
 return {home,config:c,configHash:syncHash(raw),inbox};
}
export async function scanInbox(inbox:string){
 const files:Item[]=[],issues:string[]=[];let visited=0,total=0;
 async function walk(folder:string,relative='',depth=0){
  if(depth>8)throw Error('Inbox folders are too deep (limit 8).');
  for(const entry of await readdir(folder,{withFileTypes:true})){
   if(++visited>1000)throw Error('Inbox has more than 1,000 entries; send a smaller batch.');
   const name=relative?relative+'/'+entry.name:entry.name;
   try{
    const target=await guardedTarget(inbox,name),s=await lstat(target);
    if(s.isFile()){
     if(s.size>maxFile){issues.push(name+': larger than the 1 GiB per-file limit.');continue;}
     if((total+=s.size)>maxBatch)throw Error('Inbox exceeds the 4 GiB batch limit.');
     files.push({path:name,bytes:s.size,fingerprint:fingerprint(s)});
     if(files.length>100)throw Error('Send at most 100 files in one batch.');
    }
   }catch(e){
    if((e as NodeJS.ErrnoException).code==='ENOENT')continue;
    // guardedTarget deliberately rejects directory targets; validate the
    // complete parent chain via a child before traversing ordinary directories.
    const s=await lstat(path.join(folder,entry.name));
    if(s.isDirectory()&&!s.isSymbolicLink()){await guardedTarget(inbox,name+'/sentinel');await walk(path.join(folder,entry.name),name,depth+1);}
    else if(s.isFile()&&s.size<=maxFile)throw e;
    else issues.push(name+': linked or unsupported entry; left here.');
   }
  }
 }
 await walk(inbox);return {files,issues,totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
}
export async function desktopInboxStatus(workspace:string){
 const c=await context(workspace);if(!c.config)return {configured:false as const};
 const scan=await scanInbox(c.inbox!);let raw=await optional(await guardedTarget(c.home,stateFolder+'/status.json'));
 if(raw&&JSON.parse(raw.toString()).status==='sending'&&!active.has(c.home)){
  // A crashed service releases the OS lease. Recheck the saved job under that
  // lease before marking it interrupted; never steal a live worker's status.
  try{const release=await acquireScheduleLease(await guardedTarget(c.home,'.paperfocus/device-sync/auto/transfer-coordinator',true));try{
   raw=await optional(await guardedTarget(c.home,stateFolder+'/status.json'));
   if(raw&&JSON.parse(raw.toString()).status==='sending'){await saveJob(c.home,{...JSON.parse(raw.toString()),status:'needs-attention',detail:'Transfer interrupted. Pending files remain local; press Send to retry.'});raw=await optional(await guardedTarget(c.home,stateFolder+'/status.json'));}
  }finally{await release();}}catch{/* Another view owns the transfer. */}
 }
 return {configured:true as const,inbox:c.inbox,recovery:path.join(c.home,stateFolder,'sent'),destination:c.config.remoteRoot+'/'+c.config.remoteFolder,host:c.config.host,configHash:c.configHash,...scan,job:raw?JSON.parse(raw.toString()):undefined};
}

// Fixed receiver. Data/filenames are JSON, never executable input. Publication
// uses an exclusive hard link, and different existing names are preserved.
const receiver=String.raw`import pathlib,sys,os,json,hashlib,base64
m=json.loads(base64.b64decode(sys.argv[1]));root=pathlib.Path(m['root']);resolved=root.resolve(strict=True);folder=root
for part in m['folder'].split('/')+m['name'].split('/')[:-1]:
 if not part or part in ('.','..') or '/' in part or '\\' in part:raise RuntimeError('Invalid transfer folder')
 folder=folder/part
 if folder.is_symlink():raise RuntimeError('Linked transfer destination preserved')
 folder.mkdir(mode=0o700,exist_ok=True)
 if not folder.is_dir() or not folder.resolve().is_relative_to(resolved):raise RuntimeError('Destination escaped approved root')
name=m['name'].split('/')[-1]
if not name or name in ('.','..') or '/' in name or '\\' in name:raise RuntimeError('Invalid file name')
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def same(p):
 if p.is_symlink():raise RuntimeError('Linked destination preserved')
 return p.is_file() and p.stat().st_size==m['bytes'] and digest(p)==m['sha256']
target=folder/name
if target.exists() or target.is_symlink():
 if same(target):
  print(json.dumps({'state':'verified','path':str(target),'bytes':m['bytes'],'sha256':m['sha256']}),flush=True);sys.exit(0)
 stem=pathlib.Path(name).stem;suffix=pathlib.Path(name).suffix;target=folder/(stem+'--'+m['sha256'][:16]+suffix)
 if target.exists() or target.is_symlink():
  if not same(target):raise RuntimeError('Different destination preserved; manual filename choice needed')
  print(json.dumps({'state':'verified','path':str(target),'bytes':m['bytes'],'sha256':m['sha256']}),flush=True);sys.exit(0)
temp=folder/('.aw-upload-'+m['nonce']+'.part')
with temp.open('xb') as f:
 os.chmod(temp,0o600);print(json.dumps({'state':'ready'}),flush=True);h=hashlib.sha256();size=0
 while True:
  b=sys.stdin.buffer.read(1048576)
  if not b:break
  size+=len(b)
  if size>m['bytes']:raise RuntimeError('Transfer exceeded declared size')
  f.write(b);h.update(b)
 f.flush();os.fsync(f.fileno())
if size!=m['bytes'] or h.hexdigest()!=m['sha256']:raise RuntimeError('Incomplete transfer; partial retained')
os.link(temp,target)
if not same(target):raise RuntimeError('Final verification failed; local file must stay pending')
temp.unlink()
print(json.dumps({'state':'verified','path':str(target),'bytes':size,'sha256':h.hexdigest()}),flush=True)
`;
const quote=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'";
export async function sendInboxFile(c:Config,file:string,name:string,expected:{sha256:string;bytes:number}){
 const meta=Buffer.from(JSON.stringify({root:c.remoteRoot,folder:c.remoteFolder,name,...expected,nonce:randomUUID()})).toString('base64');
 const child=await spawnOwnedSsh(['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=30',c.host,'python3 -c '+quote(receiver)+' '+quote(meta)]);
 return await new Promise<{path:string;sha256:string;bytes:number}>((resolve,reject)=>{
  let buffer='',err='',verified:{state:string;path:string;sha256:string;bytes:number}|undefined,upload:Promise<void>|undefined,uploadError:Error|undefined;const digest=createHash('sha256');
  const timer=setTimeout(()=>{child.kill();reject(Error('Transfer timed out; local file retained.'));},15*60000);
  child.stderr.on('data',b=>{if(err.length<3000)err+=b.toString();});child.stdin.on('error',()=>{});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.stdout.on('data',(b:Buffer)=>{buffer+=b.toString();if(buffer.length>20000){child.kill();return;}
   let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
    const r=JSON.parse(line);if(r.state==='ready'&&!upload){const hashing=new Transform({transform(chunk,_enc,cb){digest.update(chunk);cb(null,chunk);}});upload=pipeline(createReadStream(file),hashing,child.stdin).catch(e=>{uploadError=e;child.kill();});}
    else if(r.state==='verified'){verified=r;if(!upload)child.stdin.end();}
    else throw Error('Unexpected desktop response');
   }catch(e){err=(e as Error).message;child.kill();}}
  });
  child.on('close',async code=>{clearTimeout(timer);await upload;
   if(code||uploadError||!verified||verified.sha256!==expected.sha256||verified.bytes!==expected.bytes||!verified.path.startsWith(c.remoteRoot+'/'+c.remoteFolder+'/'))return reject(Error(err||uploadError?.message||'Desktop verification failed; file retained.'));
   if(upload&&digest.digest('hex')!==expected.sha256)return reject(Error('Source changed during upload; file retained.'));
   resolve(verified);
  });
 });
}
export async function transferInboxBatch(home:string,inbox:string,config:Config,items:Item[],jobId:string,send=sendInboxFile,onProgress:((r:Result[])=>Promise<void>)=async()=>{}){
 const results:Result[]=[];
 for(const item of items){
  try{
   const file=await guardedTarget(inbox,item.path),stat=await lstat(file);if(fingerprint(stat)!==item.fingerprint)throw Error('File changed since sending began; left pending.');
   const hash=await streamedHash(file);const remote=await send(config,file,item.path,hash);
   if(remote.sha256!==hash.sha256||remote.bytes!==hash.bytes)throw Error('Desktop checksum did not match.');
   const after=await streamedHash(await guardedTarget(inbox,item.path));if(after.sha256!==hash.sha256||after.bytes!==hash.bytes||fingerprint(await lstat(file))!==item.fingerprint)throw Error('File changed during transfer; newest local version left pending.');
   const record=stateFolder+'/receipts/'+jobId+'/'+syncHash(item.path)+'.json';const target=await guardedTarget(home,record,true);
   await saveImmutableSyncArtifact(target,Buffer.from(JSON.stringify({version:1,path:item.path,...hash,remotePath:remote.path,verifiedAt:new Date().toISOString()})+'\n'),20000);
   const archiveName=stateFolder+'/sent/'+jobId+'/'+item.path,archive=await guardedTarget(home,archiveName,true);
   try{await lstat(archive);throw Error('Recovery destination already exists; local file retained.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   await rename(await guardedTarget(inbox,item.path),archive);
   const archived=await streamedHash(archive);if(archived.sha256!==hash.sha256||archived.bytes!==hash.bytes){
    try{await link(archive,file);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')await link(archive,await guardedTarget(inbox,item.path+'--pending-'+jobId.slice(0,8),true));else throw Error('Changed file kept in recovery: '+archive);}
    throw Error('File changed at collection; retained locally for another transfer.');
   }
   results.push({path:item.path,status:'sent',remotePath:remote.path,recoveryPath:archive});
  }catch(e){results.push({path:item.path,status:'pending',detail:(e as Error).message});}
  await onProgress([...results]);
 }
 // Remove only now-empty child directories; never recursively delete content.
 const parents=new Set<string>();for(const item of items){const parts=item.path.split('/');for(let n=1;n<parts.length;n++)parents.add(parts.slice(0,n).join('/'));}
 for(const name of [...parents].sort((a,b)=>b.split('/').length-a.split('/').length))try{const child=await guardedTarget(inbox,name+'/sentinel');await rmdir(path.dirname(child));}catch{/* New arrivals and linked/nonempty directories stay untouched. */}
 return results;
}
async function saveJob(home:string,value:unknown){const name=stateFolder+'/status.json',target=await guardedTarget(home,name,true),old=await optional(target);await saveGuardedFile(home,name,old?syncHash(old):'',Buffer.from(JSON.stringify(value)+'\n'),512000);}
export async function startInboxTransfer(workspace:string,expectedConfig:string){
 const c=await context(workspace);if(!c.config||c.configHash!==expectedConfig)throw Error('Transfer destination changed. Refresh before sending.');
 if(!await readSyncNetworkPolicy(c.home))throw Error('Set the campus/VPN gate before transferring.');await requireSyncNetwork(c.home);
 const release=await acquireScheduleLease(await guardedTarget(c.home,'.paperfocus/device-sync/auto/transfer-coordinator',true));
 try{
  const scan=await scanInbox(c.inbox!),id=randomUUID(),job={id,status:'sending',startedAt:new Date().toISOString(),total:scan.files.length,results:[] as Result[],issues:scan.issues};
  await saveJob(c.home,job);
  active.add(c.home);
  void (async()=>{try{
   const results=await transferInboxBatch(c.home,c.inbox!,c.config!,scan.files,id,async(...args)=>{await requireSyncNetwork(c.home);return sendInboxFile(...args);},async results=>{job.results=results;await saveJob(c.home,job);});
   await saveJob(c.home,{...job,results,status:results.some(r=>r.status==='pending')||scan.issues.length?'needs-attention':'complete',finishedAt:new Date().toISOString()});
  }catch(e){await saveJob(c.home,{...job,status:'needs-attention',detail:(e as Error).message});}finally{active.delete(c.home);await release();}})().catch(()=>{/* Saved files/receipts survive a status-write failure; next explicit retry checks them. */});
  return {id,status:'sending'};
 }catch(e){await release();throw e;}
}
export async function openInboxFolder(workspace:string,target:unknown){
 const c=await context(workspace);if(!c.config)throw Error('Desktop transfers are not configured.');
 const folder=target==='inbox'?c.inbox:target==='sent'?path.join(c.home,stateFolder,'sent'):undefined;if(!folder)throw Error('Choose Inbox or Sent recovery.');
 if(target==='sent')await guardedTarget(c.home,stateFolder+'/sent/sentinel',true);await openExplorer(folder!);return {opened:true};
}
