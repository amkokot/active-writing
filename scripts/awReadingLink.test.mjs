import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateConfig,validateOffer,collectLinks,options,requestLink,prepareLink,pendingLinks,acknowledgeLink} from './awReadingLink.mjs';
import {makeSnapshot,syncRecord,syncHash,canonical} from '../server/syncProtocol.ts';
import {configureSyncNetwork} from '../server/syncNetwork.ts';
import {previewSyncClone,commitSyncClone} from '../server/syncClone.ts';
const base={version:1,enabled:true,host:'approved',projectsRoot:'/projects',queue:'/queue',remoteTool:'/installed/scripts/awReadingLink.mjs',producerConfig:'/installed/producer.json',maxPacketBytes:96*1024**2};
const encoded=v=>Buffer.from(JSON.stringify(v)+'\n');
function offer(){const projectId='new-project',home='/projects/new',id=syncHash(canonical({home,projectId}));
 const snapshot=makeSnapshot(projectId,{version:1,id:'desktop-id',label:'Desktop'},[syncRecord('source/main.tex','source',Buffer.from('\\documentclass{article}\n\\begin{document}Hello\\end{document}')),syncRecord('project/manuscripts.json','policy',encoded({name:'New project',createdAt:new Date().toISOString(),manuscriptPurposes:{},manuscriptVersions:[],manuscriptOverviewTargets:{}}))]);
 const packet=encoded(snapshot),plan={version:1,sshAlias:base.host,projectId,desktopDeviceId:snapshot.device.id,snapshotId:snapshot.id,packetSha256:syncHash(packet),packetBytes:packet.length,desktopWorkspace:home,remoteTool:'/installed/scripts/awSync.ts',mainFile:'main.tex',rawArraysIncluded:false};return {id,plan,snapshot,packet};}
async function recipient(){const home=await mkdtemp(path.join(tmpdir(),'aw-inbox-'));await configureSyncNetwork(home,{version:1,profiles:['campus'],vpnDescriptions:[],host:'gateway.example',port:22});return {...base,workspace:home,destinationRoot:path.join(home,'readers')};}
test('inbox config and offers fence host, roots, installed tool, exact bytes and identity',()=>{
 const f=offer();assert.equal(validateConfig(base,'desktop'),base);assert.equal(validateOffer(base,f.id,f.plan,f.snapshot,f.packet),'new-project');
 for(const c of [{enabled:false},{host:'host;evil'},{projectsRoot:'/projects/../outside'},{remoteTool:'/other'},{maxPacketBytes:1e10}])assert.throws(()=>validateConfig({...base,...c},'desktop'));
 for(const p of [{desktopWorkspace:'/projects-neighbor/new'},{desktopWorkspace:'/projects/../other'},{remoteTool:'/other/scripts/awSync.ts'},{packetBytes:1},{desktopDeviceId:'foreign'},{rawArraysIncluded:true}])assert.throws(()=>validateOffer(base,f.id,{...f.plan,...p},f.snapshot,f.packet));
 assert.throws(()=>validateOffer(base,'0'.repeat(64),f.plan,f.snapshot,f.packet));assert.throws(()=>options(['request','--project','x','--project','y']));
});
test('offline gate stops before contacting the inbox or creating a reading home',async()=>{
 const c=await recipient();let contacts=0;
 await assert.rejects(collectLinks(c,{gate:async()=>{throw Error('offline');},remote:async()=>{contacts++;}}),/offline/);assert.equal(contacts,0);
});
test('collector completes once, retries a lost acknowledgement without rerunning clone, and keeps receipts',async()=>{
 const c=await recipient(),f=offer();let commits=0,acks=0,failAck=true;
 const remote=async(action,id,part,input)=>{
  if(action==='list')return encoded([{id:f.id}]);if(action==='get')return part==='plan'?encoded(f.plan):f.packet;
  assert.equal(action,'ack');acks++;assert.equal(JSON.parse(input).snapshotId,f.snapshot.id);if(failAck)throw Error('disconnected after import');return encoded({status:'linked'});
 };
 const link=async o=>{if(!o.commit)return {review:'a'.repeat(64)};commits++;return {committed:true,journalsEnrolled:true,projectChooserRegistered:true,cloneReceipt:{deviceId:'laptop-id'},peerId:'b'.repeat(64),home:o.destination,url:'http://127.0.0.1/'};};
 const first=await collectLinks(c,{gate:async()=>{},remote,link});assert.equal(first.results[0].status,'pending');assert.equal(commits,1);
 const status=path.join(c.workspace,'.paperfocus/device-sync/reading-inbox',f.id,'status.json'),s=JSON.parse(await readFile(status));s.retryAt=new Date(0).toISOString();await writeFile(status,encoded(s));failAck=false;
 const next=await collectLinks(c,{gate:async()=>{},remote,link});assert.equal(next.results[0].alreadyComplete,true);assert.equal(next.pending,0);assert.equal(commits,1);assert.equal(acks,2);
});
test('occupied destinations and changed interrupted reviews are held, not overwritten',async()=>{
 const c=await recipient(),f=offer(),home=path.join(c.destinationRoot,'reading-'+f.plan.projectId);await mkdir(home,{recursive:true});await writeFile(path.join(home,'keep.txt'),'human');
 const remote=async(action,id,part)=>action==='list'?encoded([{id:f.id}]):part==='plan'?encoded(f.plan):f.packet;
 // Exercise the native clone guard without contacting a real peer.
 const native=async o=>{const cloneOptions={destination:o.destination,mainFile:'main.tex',label:'Laptop'},p=await previewSyncClone(f.snapshot,cloneOptions);if(!o.commit)return {review:p.planId};return commitSyncClone(f.snapshot,cloneOptions,o.review);};
 const result=await collectLinks(c,{gate:async()=>{},remote,link:native});assert.equal(result.results[0].status,'pending');assert.match(result.results[0].detail,/NEW data home/);assert.equal(await readFile(path.join(home,'keep.txt'),'utf8'),'human');
 const d=await recipient(),folder=path.join(d.workspace,'.paperfocus/device-sync/reading-inbox',f.id);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'review.json'),encoded({review:'old'}));let commits=0;
 const changed=await collectLinks(d,{gate:async()=>{},remote,link:async o=>{if(o.commit)commits++;return {review:'changed'};}});assert.match(changed.results[0].detail,/inputs changed/);assert.equal(commits,0);
});
test('producer prepares a native baseline once, queues idempotently, and records validated completion',{skip:process.platform==='win32'},async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'aw-producer-')),projects=path.join(parent,'projects'),home=path.join(projects,'idea'),queue=path.join(parent,'queue');await mkdir(path.join(home,'.paperfocus'),{recursive:true});await mkdir(path.join(home,'paper'));await mkdir(queue);
 const c={...base,projectsRoot:projects,queue},id='idea';await writeFile(path.join(home,'paper/main.tex'),'\\documentclass{article}\n\\begin{document}An idea.\\end{document}');await writeFile(path.join(home,'.paperfocus/projects.json'),encoded({activeId:id,projects:[{id,name:'Idea',folder:'paper',mainFile:'main.tex',createdAt:new Date().toISOString()}]}));
 const request=await requestLink(c,home,id);assert.equal((await requestLink(c,home,id)).alreadyRequested,true);assert.equal((await pendingLinks(c)).length,1);
 const b=await prepareLink(c,request.id);assert.equal(b.plan.rawArraysIncluded,false);assert.deepEqual(await prepareLink(c,request.id),b);
 await assert.rejects(acknowledgeLink(c,request.id,{version:1,id:request.id,committed:true}),/receipt/);
 await acknowledgeLink(c,request.id,{version:1,id:request.id,projectId:id,snapshotId:b.snapshot.id,committed:true,laptopDevice:'another-device',peerId:'a'.repeat(64)});assert.equal((await pendingLinks(c)).length,0);
 await assert.rejects(requestLink(c,home+'/../elsewhere',id),/outside|escapes|ordinary/);
});
