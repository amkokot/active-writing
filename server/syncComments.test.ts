import test from "node:test";
import assert from "node:assert/strict";
import { mkdir,mkdtemp,writeFile,readFile } from "node:fs/promises";
import path from "node:path";
import { blankReviewStore,mergeCommentStores,unionCommentStores,commentContent,localCommentPresentation } from "./syncComments.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { makeReviewComment,makeReviewCommentReply,resolveReviewComment } from "../src/review.ts";
import { createPaperProject } from "./projectFiles.ts";
import { getProject,parseProject } from "./projects.ts";
import { initializeSyncDevice,readSyncSnapshot,syncStatus } from "./deviceSync.ts";
import { handleExchangeMessage,previewSshPeer,commitSshPeer } from "./syncSsh.ts";
import { syncWorkingCheckpoint } from "./syncExchange.ts";
import { previewSyncClone,commitSyncClone } from "./syncClone.ts";
import { configureAutoSync,autoSyncCycle,autoSyncStatus } from "./syncAuto.ts";
import { readWorkbench,writeWorkbench } from "./workbenchStore.ts";
import { reviewCommand } from "../scripts/awReview.ts";
import type { AttentionTask,AppState,WorkbenchStore } from "../src/types.ts";
import { validateAssistanceArtifact } from './syncAssistanceArtifacts.ts';
import { syncRecord } from './syncProtocol.ts';
import { enableBulkSync } from './syncBulkCapture.ts';
import { writeNotebook } from './notebookStore.ts';
import { projectStorage } from './projectStorage.ts';
import { receiveBlob,verifyBlob } from './syncBlobs.ts';
import { createReadStream } from 'node:fs';
import { stageSyncSnapshot } from './syncStaging.ts';

const stamp="2026-10-21T00:00:00Z";
const task=(id:string):AttentionTask=>({id,title:id,nodeId:'node',paragraphId:'p',route:'local',status:'queued',createdAt:stamp,updatedAt:stamp,
  sourceSnapshot:{version:1,projectId:'project',rootFile:'main.tex',revision:'hash',scope:'paragraph',nodeId:'node',nodeTitle:'Scope',paragraphs:[{id:'p',nodeId:'node',file:'main.tex',text:'The claim.'}]},
  review:{kind:'comment',author:'human',body:'Explain this.',quote:'claim',start:4,end:9}});
const store=(tasks:AttentionTask[]):WorkbenchStore=>({version:1,revision:1,...emptyWorkbench(),attentionTasks:tasks});

test('shared historical replies with revised captures cannot block new comments',()=>{
 const parent=task('parent'),reply=makeReviewCommentReply(parent,'Existing reply');
 reply.sourceSnapshot!.revision='later';reply.sourceSnapshot!.paragraphs[0].text+=' Revised explanation.';
 const history=store([parent,reply]),incoming=store([parent,reply,task('new')]);
 assert.deepEqual(mergeCommentStores('project',history,history,incoming).held,[]);
 const union=unionCommentStores('project',incoming,store([parent,reply,task('other')]));
 assert.equal(union.store.attentionTasks.length,4);assert.equal(union.duplicates,0);
 assert.deepEqual(union.store.attentionTasks.find(t=>t.id===reply.id)?.sourceSnapshot,reply.sourceSnapshot);
 const bodyEdit=structuredClone(parent);(bodyEdit.review as any).body='A revised comment';
 assert.equal(unionCommentStores('project',store([parent,reply,task('new')]),store([bodyEdit,reply,task('other')])).store.attentionTasks.length,5);
 assert.ok(mergeCommentStores('project',store([parent]),store([parent]),store([parent,reply])).held.length,'New mismatched captures still require review');
 assert.throws(()=>unionCommentStores('project',store([parent]),store([parent,reply])),/source identity/);
 const altered=structuredClone(reply);altered.sourceSnapshot!.paragraphs[0].text+=' Altered original capture.';
 assert.ok(mergeCommentStores('project',history,history,store([parent,altered])).held.length,'Existing immutable captures remain protected');
 const orphan=structuredClone(reply);(orphan.review as any).replyTo='missing';
 assert.throws(()=>unionCommentStores('project',store([parent,orphan]),store([parent,orphan])),/parent/);
 const foreign=structuredClone(reply);foreign.sourceSnapshot!.rootFile='another.tex';
 assert.throws(()=>unionCommentStores('project',store([parent,foreign]),store([parent,foreign])),/source identity/);
 const cyclic=structuredClone(parent);(cyclic.review as any).replyTo=reply.id;
 assert.throws(()=>unionCommentStores('project',store([cyclic,reply]),store([cyclic,reply])),/Cyclic/);
});

test('own-save navigation anchors do not create comment edits or alter another device navigation',()=>{
 const a=task('same'),b=structuredClone(a);
 b.sourceSnapshot!.returnAnchor={paragraphId:'moved',paragraphText:'The claim. More context.',file:'main.tex',revision:'new',start:4,end:9};
 assert.deepEqual(commentContent(a),commentContent(b));
 assert.equal(mergeCommentStores('project',store([a]),store([a]),store([b])).held.length,0);
 const reply=makeReviewCommentReply(a,'A reply');
 assert.equal(mergeCommentStores('project',store([a]),store([b]),store([b,reply])).held.length,0,'Parent navigation need not match its immutable reply snapshot');
 assert.equal(localCommentPresentation(b,a).sourceSnapshot!.returnAnchor,undefined,'Never import a foreign navigation hint');
 assert.deepEqual(localCommentPresentation(a,b).sourceSnapshot!.returnAnchor,b.sourceSnapshot!.returnAnchor,'Keep this editor navigation');
 const changed=structuredClone(b);changed.sourceSnapshot!.paragraphs[0].text='The claim. A different original capture.';
 assert.ok(mergeCommentStores('project',store([a]),store([a]),store([changed])).held.length,'Original quotation remains protected');
});

test('identical shared legacy closures survive a union of new independent comments without authorizing closure import',()=>{
 const old=task('old');old.status='reviewed';(old.review as any).resolvedAt=stamp;
 const left=store([old,task('laptop')]),right=store([structuredClone(old),task('desktop')]);
 const result=unionCommentStores('project',left,right);
 assert.equal(result.store.attentionTasks.length,3);
 assert.deepEqual(commentContent(result.store.attentionTasks.find(t=>t.id==='old')!),commentContent(old));
 assert.deepEqual(unionCommentStores('project',result.store,left).store.attentionTasks.map(commentContent),result.store.attentionTasks.map(commentContent));
 assert.throws(()=>unionCommentStores('project',store([]),store([old])),/resolution/,'A closure not already present on both sides remains held');
 const foreign=structuredClone(old);foreign.sourceSnapshot!.projectId='elsewhere';
 assert.throws(()=>unionCommentStores('project',store([foreign]),store([foreign])),/foreign/);
 const executable=structuredClone(old);(executable as any).localJobId='run';
 assert.throws(()=>unionCommentStores('project',store([executable]),store([executable])),/Invalid|unknown|runnable/);
});

test('reading comment union keeps independent threads and both text variants with stable repeatable copy IDs',()=>{
 const a=task('same'),b=structuredClone(a);(a.review as any).body='Laptop wording';(b.review as any).body='Desktop wording';
 const l=store([a,task('laptop')]),r=store([b,task('desktop')]),merged=unionCommentStores('project',l,r);
 assert.equal(merged.store.attentionTasks.length,4);assert.equal(merged.duplicates,1);
 assert.deepEqual(unionCommentStores('project',r,l).store,merged.store);
 assert.deepEqual(new Set(merged.store.attentionTasks.map(t=>(t.review as any).body)),new Set(['Laptop wording','Desktop wording','Explain this.']));
 assert.ok(merged.store.attentionTasks.some(t=>t.id.startsWith('comment-copy-')&&t.title.endsWith('(other version)')));
 for(const other of [l,r,merged.store])assert.deepEqual(unionCommentStores('project',other,merged.store).store.attentionTasks.map(commentContent),merged.store.attentionTasks.map(commentContent));
});
test('comment union preserves explicit decisions and rejects foreign/runnable/invalid reply records',()=>{
 const a=task('same'),closed=structuredClone(a);closed.status='reviewed';(closed.review as any).resolvedAt=stamp;(closed.review as any).humanDecision={action:'resolve',at:stamp};
 const result=unionCommentStores('project',store([a]),store([closed]));assert.equal(result.store.attentionTasks.length,2);assert.equal(result.store.attentionTasks.filter(t=>t.status==='queued').length,1);
 const bad=task('bad');bad.sourceSnapshot!.projectId='foreign';assert.throws(()=>unionCommentStores('project',store([a]),store([bad])),/foreign/);
 const executable=task('bad');(executable as any).localJobId='job';assert.throws(()=>unionCommentStores('project',store([a]),store([executable])));
 const orphan=task('reply');(orphan.review as any).replyTo='absent';assert.throws(()=>unionCommentStores('project',store([a]),store([orphan])),/parent/);
});
test('an edited existing copy and another version of its original both survive without multiplying on retries',()=>{
 const a=task('same'),b=structuredClone(a);(a.review as any).body='First';(b.review as any).body='Second';
 const base=unionCommentStores('project',store([a]),store([b])).store,left=structuredClone(base),right=structuredClone(base);
 const copy=left.attentionTasks.find(t=>t.id.startsWith('comment-copy-'))!;
 const original=right.attentionTasks.find(t=>t.id==='same')!;
 (original.review as any).body=(copy.review as any).body;(copy.review as any).body='Edited copy';
 const result=unionCommentStores('project',left,right).store;
 for(const body of ['First','Second','Edited copy'])assert.ok(result.attentionTasks.some(t=>(t.review as any).body===body));
 assert.deepEqual(unionCommentStores('project',result,result).store.attentionTasks.map(commentContent),result.attentionTasks.map(commentContent));
 assert.deepEqual(unionCommentStores('project',right,left).store.attentionTasks.map(commentContent),result.attentionTasks.map(commentContent));
 assert.deepEqual(unionCommentStores('project',left,result).store.attentionTasks.map(commentContent),result.attentionTasks.map(commentContent));
});
test('inert local-helper receipts have bounded owner-checked schemas, not arbitrary JSON approval',()=>{
 const packet={version:1,task:'extract',instruction:'Summarize',context:[{id:'log',text:'A fact'}],owner:{project:'project',entry:'entry',notebook:'owner'}};
 const catalogues=[{entries:[{id:'entry',experimentNotebookId:'owner'}]}] as any;
 const name='data/research/delegate-request-12345678-1234-1234-1234-123456789012.json';
 validateAssistanceArtifact(syncRecord(name,'record',Buffer.from(JSON.stringify(packet))),'project',catalogues);
 assert.throws(()=>validateAssistanceArtifact(syncRecord(name,'record',Buffer.from(JSON.stringify({...packet,owner:{...packet.owner,project:'foreign'}}))),'project',catalogues),/owner/);
 const key='a'.repeat(64),receipt={key,request:packet,model:'qwen3:8b',modelDigest:'b'.repeat(64),backend:'desktop-loopback',status:'proposal',createdAt:stamp,executedSuggestions:false,answer:{summary:'Fact',findings:[{source:'log',detail:'A fact'}],checks:[]}};
 const file='data/research/local-assistance/'+key+'.json';
 validateAssistanceArtifact(syncRecord(file,'record',Buffer.from(JSON.stringify(receipt))),'project',catalogues);
 assert.throws(()=>validateAssistanceArtifact(syncRecord(file,'record',Buffer.from(JSON.stringify({...receipt,executedSuggestions:true}))),'project',catalogues),/provenance/);
 assert.throws(()=>validateAssistanceArtifact(syncRecord('data/research/run.json','record',Buffer.from(JSON.stringify(receipt))),'project',catalogues),/bounded/);
});

test('comment additions, body edits and replies merge; no resolution is inferred',()=>{
 const b=store([task('a')]),l=store([...b.attentionTasks,task('l')]),r=store([...b.attentionTasks,task('r')]);
 const result=mergeCommentStores('project',b,l,r);assert.equal(result.held.length,0);assert.equal(result.store.attentionTasks.length,3);
 assert.ok(result.store.attentionTasks.every(t=>t.status==='queued'));
 const assistant=task('assistant');assistant.route='codex';(assistant.review as any).author='assistant';
 assert.equal(mergeCommentStores('project',b,b,store([...b.attentionTasks,assistant])).held.length,0,'A comment origin label is not an executable model request');
 const edited=structuredClone(b);if(edited.attentionTasks[0].review?.kind==='comment')edited.attentionTasks[0].review.body='A clearer question';
 assert.equal(mergeCommentStores('project',b,b,edited).held.length,0);
 const reply=makeReviewCommentReply(b.attentionTasks[0],'A proposed answer');if(reply.review?.kind==='comment')reply.review.author='assistant';
 assert.equal(mergeCommentStores('project',b,b,store([...b.attentionTasks,reply])).held.length,0);
});
test('competing edits, deletions, unknown/runnable fields and legacy closure stay held',()=>{
 const b=store([task('a')]),l=structuredClone(b),r=structuredClone(b);
 (l.attentionTasks[0].review as any).body='Laptop';(r.attentionTasks[0].review as any).body='Desktop';
 assert.ok(mergeCommentStores('project',b,l,r).held.length);
 assert.ok(mergeCommentStores('project',b,b,store([])).held.length);
 const closed=structuredClone(b);closed.attentionTasks[0].status='reviewed';(closed.attentionTasks[0].review as any).resolvedAt=stamp;
 assert.match(mergeCommentStores('project',b,b,closed).held[0].reason,/resolution/);
 const foreign=task('foreign');foreign.sourceSnapshot!.projectId='other';
 assert.ok(mergeCommentStores('project',b,b,store([...b.attentionTasks,foreign])).held.length);
 const unknown=task('unknown');(unknown as any).futureExecution='run';
 assert.ok(mergeCommentStores('project',b,b,store([...b.attentionTasks,unknown])).held.length);
});
test('explicit human resolve/reopen copies exactly; concurrent text prevents stale closure',()=>{
 const b=store([task('a')]);
 const state=resolveReviewComment({attentionTasks:b.attentionTasks} as AppState,'a');
 const r=store(state.attentionTasks),merged=mergeCommentStores('project',b,b,r);
 assert.equal(merged.held.length,0);assert.equal(merged.store.attentionTasks[0].status,'reviewed');
 const reopened=resolveReviewComment({attentionTasks:r.attentionTasks} as AppState,'a',false);
 assert.equal(mergeCommentStores('project',r,r,store(reopened.attentionTasks)).held.length,0);
 const changed=structuredClone(b);(changed.attentionTasks[0].review as any).body='New question';
 assert.ok(mergeCommentStores('project',b,changed,r).held.length);
});
test('reply cycles/foreign anchors and non-comment decisions cannot slip through',()=>{
 const a=task('a'),b=task('b');(a.review as any).replyTo='b';(b.review as any).replyTo='a';
 assert.ok(mergeCommentStores('project',blankReviewStore(),blankReviewStore(),store([a,b])).held.length);
 const base=store([]),remote=structuredClone(base);remote.handoffDrafts['codex:node']={effort:1,scope:'none',includeProject:false,instruction:'new'};
 assert.match(mergeCommentStores('project',base,base,remote).held[0].reason,/protected/);
});

async function fixture(streaming=false){
 await mkdir('.paperfocus/trials',{recursive:true});const laptop=await mkdtemp(path.resolve('.paperfocus/trials/comment-sync-'));
 const project=await createPaperProject(laptop,'Synthetic comments'),projectId=project.id;
 const root=(await getProject(laptop,projectId)).root;
 await writeFile(path.join(root,'main.tex'),'\\documentclass{article}\n\\begin{document}\n\\section{Scope}\nThe claim needs an explanation.\n\\end{document}\n');
 await initializeSyncDevice(laptop,'Laptop');
 if(streaming)await enableBulkSync(laptop,projectId);
 const checkpoint=await syncWorkingCheckpoint(laptop,projectId),snapshot=await readSyncSnapshot(checkpoint.path),desktop=path.join(laptop,'desktop');
 const options={destination:desktop,mainFile:'main.tex',label:'Desktop'},clone=await previewSyncClone(snapshot,options);await commitSyncClone(snapshot,options,clone.planId);
 const peerOptions={host:'test-desktop',platform:'posix' as const,tool:'/code/scripts/awSync.ts',workspace:'/data/aw',deviceId:(await syncStatus(desktop)).device!.id};
 const peer=await previewSshPeer(laptop,projectId,peerOptions);await commitSshPeer(laptop,projectId,peerOptions,peer.id);
 await configureAutoSync(laptop,projectId,{peerId:peer.id,mode:'safe',intervalSeconds:120,savedDraftsConfirmed:true});
 const runner=async(_h:string,_c:string,input:Buffer)=>Buffer.from(JSON.stringify(await handleExchangeMessage(desktop,projectId,JSON.parse(input.toString()))));
 let time=Date.now();const cycle=()=>autoSyncCycle(laptop,projectId,{runner,now:()=>time+=130000});
 const doc=await parseProject(laptop,projectId),p=doc.paragraphs.find(p=>p.text.includes('claim needs'))!;
 const c=makeReviewComment(doc,{}, {paragraphId:p.id,nodeId:p.nodeId,start:0,end:p.text.length,text:p.text},'Please explain the claim.');
 await writeWorkbench(laptop,projectId,0,{...emptyWorkbench(),attentionTasks:[c]});
 return {laptop,desktop,projectId,root,c,cycle,runner};
}
test('automatic laptop comment -> desktop CLI reply -> laptop queue, then manual resolve, without a server',async()=>{
 const f=await fixture();assert.equal((await f.cycle()).status,'synced');
 const list:any=await reviewCommand(['list','--workspace',f.desktop,'--project',f.projectId]);assert.equal(list.comments[0].id,f.c.id);assert.ok(list.comments[0].currentTarget);
 assert.match(list.comments[0].currentSourceRevision,/^[a-f0-9]{64}$/);
 assert.match(list.next,/Recheck its revision before applying/);
 const body=path.join(f.laptop,'answer.txt');await writeFile(body,'I propose a more explicit explanation; human review is still needed.');
 const args=['reply','--workspace',f.desktop,'--project',f.projectId,'--comment',f.c.id,'--revision',String(list.revision),'--file',body];
 assert.equal((await reviewCommand(args) as any).planned,true);
 const reply:any=await reviewCommand([...args,'--commit']);assert.equal(reply.commentResolved,false);
 assert.equal((await reviewCommand([...args,'--commit']) as any).alreadySaved,true);
 assert.equal((await f.cycle()).status,'synced');
 let wb=await readWorkbench(f.laptop,f.projectId);assert.equal(wb.attentionTasks.length,2);assert.ok(wb.attentionTasks.every(t=>t.status==='queued'));
 assert.equal(wb.attentionTasks.find(t=>t.id===reply.replyId)?.review?.kind,'comment');
 const state=resolveReviewComment({attentionTasks:wb.attentionTasks} as AppState,f.c.id);
 await writeWorkbench(f.laptop,f.projectId,wb.revision,{...wb,attentionTasks:state.attentionTasks});
 assert.equal((await f.cycle()).status,'synced');
 wb=await readWorkbench(f.desktop,f.projectId);assert.ok(wb.attentionTasks.every(t=>t.status==='reviewed'));
 assert.match(await readFile(path.join(f.root,'main.tex'),'utf8'),/The claim needs an explanation/);
});
test('stale reply revision and exact-byte save fences preserve new human comments',async()=>{
 const f=await fixture(),wb=await readWorkbench(f.laptop,f.projectId),body=path.join(f.laptop,'reply.txt');await writeFile(body,'A reply');
 await assert.rejects(()=>reviewCommand(['reply','--workspace',f.laptop,'--project',f.projectId,'--comment',f.c.id,'--revision','0','--file',body,'--commit']),/changed/);
 await assert.rejects(()=>writeWorkbench(f.laptop,f.projectId,wb.revision,wb,'0'.repeat(64)),/bytes changed/);
 assert.equal((await readWorkbench(f.laptop,f.projectId)).attentionTasks.length,1);
});
test('new saved comments get the next connected check without waiting for the long source interval',async()=>{
 const f=await fixture();assert.equal((await f.cycle()).status,'synced');
 const prior=(await autoSyncStatus(f.laptop,f.projectId)).state!,wb=await readWorkbench(f.laptop,f.projectId),next=structuredClone(f.c);
 next.id='second-comment';if(next.review?.kind==='comment')next.review.body='A second question';
 await writeWorkbench(f.laptop,f.projectId,wb.revision,{...wb,attentionTasks:[...wb.attentionTasks,next]});
 const now=()=>Date.parse(prior.checkedAt)+30000;
 const result=await autoSyncCycle(f.laptop,f.projectId,{runner:f.runner,now});assert.equal(result.status,'synced');
 assert.ok((await readWorkbench(f.desktop,f.projectId)).attentionTasks.some(t=>t.id===next.id));
});
test('streaming helper receipt blobs do not block the paired comment workflow',async()=>{
 const f=await fixture(true);
 await writeNotebook(f.desktop,f.projectId,0,[{id:'helper-owner',manuscriptFile:'main.tex',title:'Synthetic helper context',question:'Fixture only',notes:'',reply:'',proposal:'',status:'open',route:'codex',effort:1,handoffs:[],appliedChanges:[],createdAt:stamp,updatedAt:stamp}]);
 const data=await projectStorage(f.desktop,f.projectId);await mkdir(path.join(data.folder,'research'),{recursive:true});
 const packet={version:1,task:'logs',instruction:'Summarize fixture',context:[{id:'log',text:'No execution'}],owner:{project:f.projectId,entry:'helper-owner',notebook:'helper-owner'}};
 const name='delegate-request-12345678-1234-1234-1234-123456789012.json';
 await writeFile(path.join(data.folder,'research',name),JSON.stringify(packet));
 // This fixture mocks JSON SSH messages, not binary SSH. Pre-stage verified
 // content-addressed bytes only; the real SSH trial separately checks the wire.
 const captured=await syncWorkingCheckpoint(f.desktop,f.projectId),snapshot=await readSyncSnapshot(captured.path);
 for(const record of snapshot.records)if(record.external)await receiveBlob(f.laptop,record,createReadStream(await verifyBlob(f.desktop,record)));
 await stageSyncSnapshot(f.laptop,f.projectId,snapshot);
 const result=await f.cycle();assert.equal(result.status,'synced');
 const local=await projectStorage(f.laptop,f.projectId);assert.deepEqual(JSON.parse(await readFile(path.join(local.folder,'research',name),'utf8')),packet);
 assert.ok((await readWorkbench(f.desktop,f.projectId)).attentionTasks.some(t=>t.id===f.c.id));
});
