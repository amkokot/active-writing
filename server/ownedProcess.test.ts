import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {ownedProcessHost} from './ownedProcess.ts';

test('native proxy refuses invalid targets and refuses an unowned connection', {skip:process.platform!=='win32'},async()=>{
  const host=await ownedProcessHost();
  for(const args of [['--ssh-proxy','-oBad','22','jump'],['--ssh-proxy','example.test','0','jump'],['--ssh-proxy','example.test','22','-oBad'],['--ssh-proxy','example.test','22','jump']]) {
    const result=spawnSync(host,args,{windowsHide:true,encoding:'utf8',timeout:5000});
    assert.equal(result.status,125,result.stderr);
    assert.match(result.stderr,/Expected proxy|No live OpenSSH ancestor/);
  }
});

async function waitFor(check:()=>Promise<boolean>,message:string) {
  const until=Date.now()+8000;
  do { if(await check())return;await new Promise(resolve=>setTimeout(resolve,40)); }while(Date.now()<until);
  assert.fail(message);
}
function alive(pid:number) { try{process.kill(pid,0);return true;}catch{return false;} }
async function fixture() {
  const folder=await mkdtemp(path.join(tmpdir(),'aw-owned-test-'));
  const output=path.join(folder,'tree.json'),script=path.join(folder,'tree.cjs');
  await writeFile(script,`const {spawn}=require('node:child_process');const fs=require('node:fs');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
fs.writeFileSync(process.argv[2],JSON.stringify({root:process.pid,child:child.pid,args:process.argv.slice(3)}));
${'setInterval(()=>{},1000);'}`);
  return {folder,output,script};
}

test('all three Aw SSH transports use one contained lifetime boundary without changing host trust',async()=>{
  for(const file of ['syncSsh.ts','syncReadingStream.ts','syncBlobSsh.ts']) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.match(source,/await spawnOwnedSsh\(/);
    assert.match(source,/StrictHostKeyChecking/);
    assert.doesNotMatch(source,/spawn\(['"]ssh['"]/);
  }
});

test('Windows ownership keeps pipes and exact arguments; killing the host removes the entire child tree', {skip:process.platform!=='win32'}, async()=>{
  const f=await fixture(),host=await ownedProcessHost();
  const args=['a b','quoted"value','end\\','mix\\"quote',''];
  const child=spawn(host,[String(process.pid),process.execPath,f.script,f.output,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const closed=once(child,'close');let ids:{root:number;child:number}|undefined;
  try {
    await waitFor(async()=>{try {const value=JSON.parse(await readFile(f.output,'utf8'));ids=value;assert.deepEqual(value.args,args);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}},'Contained child did not start');
    assert.ok(alive(ids!.root));assert.ok(alive(ids!.child));
    child.kill();await closed;
    await waitFor(async()=>!alive(ids!.root)&&!alive(ids!.child),'Owned descendants survived host cancellation');
  } finally {child.kill();await closed;await rm(f.folder,{recursive:true,force:true});}
});

test('Windows owner disappearance reaps helpers even when the Node worker is killed abruptly', {skip:process.platform!=='win32'},async()=>{
  const f=await fixture(),host=await ownedProcessHost(),ownerScript=path.join(f.folder,'owner.cjs');
  await writeFile(ownerScript,`require('node:child_process').spawn(${JSON.stringify(host)},[String(process.pid),process.execPath,${JSON.stringify(f.script)},${JSON.stringify(f.output)}],{windowsHide:true,stdio:'ignore'});setInterval(()=>{},1000);`);
  const owner=spawn(process.execPath,[ownerScript],{windowsHide:true,stdio:'ignore'}),closed=once(owner,'close');
  let ids:{root:number;child:number}|undefined;
  try {
    await waitFor(async()=>{try{ids=JSON.parse(await readFile(f.output,'utf8'));return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}},'Worker-owned child did not start');
    owner.kill();await closed;
    await waitFor(async()=>!alive(ids!.root)&&!alive(ids!.child),'Owned descendants survived worker crash');
  } finally {owner.kill();await closed;await rm(f.folder,{recursive:true,force:true});}
});

test('Windows normal exit forwards status and stdout, and kills an otherwise lingering helper', {skip:process.platform!=='win32'},async()=>{
  const f=await fixture(),host=await ownedProcessHost();
  await writeFile(f.script,`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});console.log(child.pid);process.stdin.on('data',bytes=>{process.stdout.write(bytes);process.exitCode=7;process.exit(7);});`);
  const child=spawn(host,[String(process.pid),process.execPath,f.script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>{output+=bytes.toString();});const closed=once(child,'close');
  try {
    await waitFor(async()=>/^\d+\r?\n/.test(output),'No inherited stdout');
    const helper=Number(output.trim());child.stdin.end('round trip');
    assert.equal((await closed)[0],7);assert.match(output,/round trip/);
    await waitFor(async()=>!alive(helper),'Normal SSH-style exit left a helper behind');
  } finally {child.kill();await closed;await rm(f.folder,{recursive:true,force:true});}
});
