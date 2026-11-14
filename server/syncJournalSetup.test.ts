import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createPaperProject} from './projectFiles.ts';
import {initializeSyncDevice} from './deviceSync.ts';
import {enrollJournalScope,setupPairedJournals} from './syncJournalSetup.ts';
import {previewSshPeer,commitSshPeer} from './syncSsh.ts';
async function fixture(){const parent=path.resolve('.paperfocus/trials');await mkdir(parent,{recursive:true});const home=await mkdtemp(path.join(parent,'journal-enroll-'));const p=await createPaperProject(home,'Enrollment fixture');const d=await initializeSyncDevice(home,'Enrollment laptop');const config=path.join(home,'config.json');await writeFile(config,JSON.stringify({version:1,projects:[]}));return {home,id:p.id,device:d.device.id,config};}
test('enrollment previews without writing, exact commit adds one scope and repeats are idempotent',async()=>{
 const f=await fixture(),before=await readFile(f.config,'utf8'),plan=await enrollJournalScope(f.home,f.id,f.device,undefined,f.config);assert.equal(plan.registered,false);assert.equal(await readFile(f.config,'utf8'),before);
 await enrollJournalScope(f.home,f.id,f.device,plan.review,f.config);assert.equal(JSON.parse(await readFile(path.join(f.home,'.paperfocus/project-data',f.id,'project.json'),'utf8')).projectId,f.id);const next=await enrollJournalScope(f.home,f.id,f.device,undefined,f.config);assert.equal(next.registered,true);await enrollJournalScope(f.home,f.id,f.device,next.review,f.config);assert.equal(JSON.parse(await readFile(f.config,'utf8')).projects.length,1);
});
test('changed config, wrong device, unknown project and invalid scopes cannot be enrolled',async()=>{
 const f=await fixture(),plan=await enrollJournalScope(f.home,f.id,f.device,undefined,f.config);await writeFile(f.config,JSON.stringify({version:1,projects:[]})+'\n');
 await assert.rejects(enrollJournalScope(f.home,f.id,f.device,plan.review,f.config),/changed/);await assert.rejects(enrollJournalScope(f.home,f.id,'wrong',undefined,f.config),/device mismatch/);
 await writeFile(f.config,JSON.stringify({version:1,projects:[{workspace:f.home,projectId:'../bad'}]}));await assert.rejects(enrollJournalScope(f.home,f.id,f.device,undefined,f.config),/Invalid/);
});
test('paired setup validates both pinned devices, commits remote first and preserves partial enrollment safely',async()=>{
 const f=await fixture(),opts={host:'test-desktop',platform:'posix' as const,tool:'/aw/scripts/awSync.ts',workspace:'/data/trial',deviceId:'remote-device'},peer=await previewSshPeer(f.home,f.id,opts);await commitSshPeer(f.home,f.id,opts,peer.id);
 let remoteRegistered=false,fail=false,calls=0;const runner=async(_host:string,command:string)=>{calls++;assert.match(command,/awSyncJournalSetup\.ts/);if(command.includes('--commit')){if(fail)throw Error('Connection dropped');remoteRegistered=true;}return Buffer.from(JSON.stringify({projectId:f.id,workspace:opts.workspace,deviceId:opts.deviceId,review:(remoteRegistered?'b':'a').repeat(64),registered:remoteRegistered,committed:command.includes('--commit')}));};
 const plan=await setupPairedJournals(f.home,f.id,peer.id,undefined,{runner,configFile:f.config});assert.equal(calls,1);assert.equal(JSON.parse(await readFile(f.config,'utf8')).projects.length,0);
 fail=true;await assert.rejects(setupPairedJournals(f.home,f.id,peer.id,plan.review,{runner,configFile:f.config}),/Connection dropped/);assert.equal(JSON.parse(await readFile(f.config,'utf8')).projects.length,0);
 fail=false;const result=await setupPairedJournals(f.home,f.id,peer.id,plan.review,{runner,configFile:f.config});assert.equal(result.committed,true);assert.equal(remoteRegistered,true);assert.equal(JSON.parse(await readFile(f.config,'utf8')).projects.length,1);assert.equal(result.researchStarted,false);
 const repeat=await setupPairedJournals(f.home,f.id,peer.id,undefined,{runner,configFile:f.config});await setupPairedJournals(f.home,f.id,peer.id,repeat.review,{runner,configFile:f.config});assert.equal(JSON.parse(await readFile(f.config,'utf8')).projects.length,1);
});
