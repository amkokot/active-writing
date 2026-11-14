// Only Aw's own child is contained; never enumerate/kill by process name.
import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {readFile,mkdtemp,writeFile,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
let host:Promise<string>|undefined;

/** Compile installed source once per worker. No downloads, admin rights or daemon. */
export function ownedProcessHost():Promise<string> {
  if(process.platform!=='win32')throw Error('The process job host is Windows-only.');
  if(!host)host=(async()=>{
    const source=fileURLToPath(new URL('../scripts/OwnedProcessHost.cs',import.meta.url));
    if((await lstat(source)).isSymbolicLink())throw Error('Aw process host source cannot be a link.');
    const folder=await mkdtemp(path.join(tmpdir(),'aw-owned-process-'));
    try {
      const copy=path.join(folder,'OwnedProcessHost.cs'),executable=path.join(folder,'OwnedProcessHost.exe');
      await writeFile(copy,await readFile(source),{flag:'wx'});
      const system=process.env.SystemRoot || 'C:\\Windows';
      const compiler=path.join(system,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
      await promisify(execFile)(compiler,['/nologo','/target:exe','/optimize+','/out:'+executable,copy],{windowsHide:true,timeout:30000,maxBuffer:32000});
      // Private OS temporary storage; no per-connection compilation or scan.
      return executable;
    } catch(error) { await rm(folder,{recursive:true,force:true});throw Error('Aw SSH containment could not start; sync is waiting. '+(error as Error).message); }
  })().catch(error=>{host=undefined;throw error;});
  return host;
}

export async function spawnOwnedSsh(args:string[]):Promise<ChildProcessWithoutNullStreams> {
  if(process.platform!=='win32')return spawn('ssh',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const executable=await ownedProcessHost();
  const ssh=path.join(process.env.SystemRoot || 'C:\\Windows','System32','OpenSSH','ssh.exe');
  return spawn(executable,[String(process.pid),ssh,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
}
