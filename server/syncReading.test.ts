import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,symlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {createPaperProject} from './projectFiles.ts';
import {getProject,registry,saveRegistry} from './projects.ts';
import {initializeSyncDevice,captureSyncSnapshot,syncStatus,privateSyncPath} from './deviceSync.ts';
import {previewSyncClone,commitSyncClone} from './syncClone.ts';
import {previewSshPeer,commitSshPeer,handleExchangeMessage,type SshRunner} from './syncSsh.ts';
import {readingInventory,readingPacket,applyReadingPacket,syncReadingRecords,handleReadingMessage,fastReadingFigures,readingTransferPriority,validateReadingSelection,effectiveReadingSelection} from './syncReading.ts';
import {exchangeStatus} from './syncExchange.ts';
import {readNotebook,writeNotebook} from './notebookStore.ts';
import {readExperiments,writeExperiments} from './experiments.ts';
import {readWorkbench,writeWorkbench} from './workbenchStore.ts';
import {newExperimentNotebook} from '../src/experiments.ts';
import {acquireRecordLock} from './recordLock.ts';
import {projectDataPath} from './projectStorage.ts';
import {syncHash,canonical} from './syncProtocol.ts';
import {readingPins,mergeReadingPins,applyReadingPins} from './syncDocumentPins.ts';
import {applySlideChoice,slideChoice} from './slideDecks.ts';
import {configureAutoSync,followReadingSync,autoSyncCycle} from './syncAuto.ts';
import {listReadingSourceReviews,readReadingSourceReview,chooseReadingSource} from './syncReadingSource.ts';
import type {NotebookEntry} from '../src/types.ts';

const stamp='2026-10-24T00:00:00Z';
const original='\\documentclass{article}\n\\begin{document}\nOriginal source.\n\\end{document}\n';
test('conversations without experiments do not defer reading sync; lost saved notebooks remain held',async()=>{
 const f=await fixture();
 for(const home of [f.home,f.desktop]){const n=await readNotebook(home,f.id);await writeNotebook(home,f.id,n.revision,[...n.entries,{...n.entries[0],id:'no-experiments'}]);}
 const inv=await readingInventory(f.home,f.id);assert.ok(inv.absentNotebooks?.includes('notebook/no-experiments'));assert.ok(!inv.deferred.includes('notebook/no-experiments'));
 const clean=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(!clean.deferred.length);assert.ok(!clean.held.length);
 for(const home of [f.home,f.desktop])await (await import('node:fs/promises')).unlink(path.join(projectDataPath(home,f.id),'experiments/question/notebook.ipynb'));
 const missing=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(missing.held.includes('notebook/question'));
});
test('fast figure omission is deferred, while full reading and real binary conflicts stay guarded',async()=>{
 const f=await fixture(),key='source/figures/example.pdf';
 for(const root of [f.root,f.remoteRoot]){await mkdir(path.join(root,'figures'),{recursive:true});await writeFile(path.join(root,'figures/example.pdf'),'%PDF-synthetic original');}
 await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);
 await writeFile(path.join(f.root,'main.tex'),original.replace('Original source.','\\includegraphics{figures/example.pdf}'));
 const missing:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),response=JSON.parse((await f.runner(...args)).toString());if(request.action==='reading-inventory'&&request.fastOnly)response.inventory.figures=[];return Buffer.from(JSON.stringify(response));};
 const fast=await syncReadingRecords(f.home,f.id,f.peer.id,missing,{fastOnly:true});assert.ok(!fast.deferred.includes(key),'An unchanged figure outside the other selected root is not unfinished work');assert.ok(!fast.held.includes(key));
 assert.equal(await readFile(path.join(f.remoteRoot,'figures/example.pdf'),'utf8'),'%PDF-synthetic original');
 await writeFile(path.join(f.root,'figures/example.pdf'),'%PDF-local edit');
 const changed=await syncReadingRecords(f.home,f.id,f.peer.id,missing,{fastOnly:true});assert.ok(changed.deferred.includes(key));assert.ok(!changed.held.includes(key));
 await writeFile(path.join(f.remoteRoot,'figures/example.pdf'),'%PDF-remote edit');
 const full=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(full.held.includes(key));
 const both=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.ok(both.held.includes(key));
});
function commentTask(projectId:string,id:string,body=id){return {id,title:id,nodeId:'n',paragraphId:'p',route:'local' as const,status:'queued' as const,createdAt:stamp,updatedAt:stamp,sourceSnapshot:{version:1 as const,projectId,rootFile:'main.tex',revision:'hash',scope:'paragraph' as const,nodeId:'n',nodeTitle:'Note',paragraphs:[{id:'p',nodeId:'n',file:'main.tex',text:'Original source.'}]},review:{kind:'comment' as const,author:'human' as const,body,quote:'Original',start:0,end:8}};}
async function addComment(home:string,id:string,commentId:string,body=commentId){const wb=await readWorkbench(home,id);wb.attentionTasks.push(commentTask(id,commentId,body));await writeWorkbench(home,id,wb.revision,wb);}
async function fixture(){
 const parent=path.join(process.cwd(),'.paperfocus/trials');await mkdir(parent,{recursive:true});const home=await mkdtemp(path.join(parent,'reading-sync-'));
 const project=await createPaperProject(home,'Synthetic reading sync'),id=project.id,root=(await getProject(home,id)).root;
 await writeFile(path.join(root,'main.tex'),original);await initializeSyncDevice(home,'Laptop');
 const entry:NotebookEntry={id:'question',title:'A question',manuscriptFile:'main.tex',notes:'',question:'',reply:'',proposal:'',status:'open',route:'codex',effort:2,handoffs:[],appliedChanges:[],createdAt:stamp,updatedAt:stamp};
 await writeNotebook(home,id,0,[entry]);await writeExperiments(home,id,'question','',{...newExperimentNotebook(),cells:[{id:'note',cell_type:'markdown',source:'Initial evidence',metadata:{}}]});
 const base=await captureSyncSnapshot(home,id),desktop=path.join(home,'desktop'),options={destination:desktop,mainFile:'main.tex',label:'Desktop'},plan=await previewSyncClone(base,options);await commitSyncClone(base,options,plan.planId);
 const peerOptions={host:'synthetic-desktop',platform:'posix' as const,tool:'/opt/aw/scripts/awSync.ts',workspace:'/research',deviceId:(await syncStatus(desktop)).device!.id};const peer=await previewSshPeer(home,id,peerOptions);await commitSshPeer(home,id,peerOptions,peer.id);
 const remoteRoot=(await getProject(desktop,id)).root,calls:string[]=[];
 const runner:SshRunner=async(_host,_command,input)=>{const request=JSON.parse(input.toString());calls.push(request.action);return Buffer.from(JSON.stringify(await handleExchangeMessage(desktop,id,request)));};
 await syncReadingRecords(home,id,peer.id,runner);
 return {home,id,desktop,root,remoteRoot,peer,runner,calls};
}
async function changeNotebook(home:string,id:string,text:string){const n=await readExperiments(home,id,'question');n.notebook.cells[0].source=text;await writeExperiments(home,id,'question',n.revision,n.notebook);}

test('referenced small figures arrive in the fast pass with new TeX, excluding unrelated and oversized PDFs',async()=>{
 const f=await fixture();await mkdir(path.join(f.remoteRoot,'figures'));
 await writeFile(path.join(f.remoteRoot,'main.tex'),original.replace('Original source.','Original source.\\includegraphics{figures/new}\\includegraphics{figures/large.pdf}'));
 await writeFile(path.join(f.remoteRoot,'figures/new.pdf'),Buffer.from('%PDF-small-figure'));
 await writeFile(path.join(f.remoteRoot,'figures/large.pdf'),Buffer.alloc(2*1024**2+1));
 await writeFile(path.join(f.remoteRoot,'unrelated.pdf'),Buffer.from('%PDF-paper'));
 const inv=await readingInventory(f.desktop,f.id,true);
 assert.ok(inv.figures?.some(i=>i.key==='source/figures/new.pdf'));assert.ok(!inv.figures?.some(i=>i.key.endsWith('large.pdf')||i.key.endsWith('unrelated.pdf')));
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 assert.ok(result.copied.includes('source/figures/new.pdf'));assert.equal(await readFile(path.join(f.root,'figures/new.pdf'),'utf8'),'%PDF-small-figure');
});
test('figure discovery follows bounded literal includes and refuses traversal and macros',async()=>{
 const f=await fixture();await mkdir(path.join(f.root,'sections'));
 await writeFile(path.join(f.root,'main.tex'),'\\input{sections/detail}\n% \\includegraphics{secret.pdf}\n\\includegraphics{../escape}\n\\includegraphics{\\macro}');
 await writeFile(path.join(f.root,'sections/detail.tex'),'\\includegraphics{figures/a.pdf}\\input{../main}');
 const found=await fastReadingFigures(f.root,['main.tex']);assert.ok(found.includes('figures/a.pdf'));assert.ok(!found.some(p=>p.includes('..')||p.includes('secret')||p.includes('macro')));assert.ok(found.length<=64);
 assert.ok(readingTransferPriority('comments')<readingTransferPriority('source/figures/a.pdf'));
 assert.ok(readingTransferPriority('source/figures/a.pdf')<readingTransferPriority('source/main.pdf'));
});

test('source form-feed whitespace transfers byte-for-byte while NUL remains rejected',async()=>{
 const f=await fixture(),text=original.replace('Original source.','First paragraph.\fSecond paragraph.');
 await writeFile(path.join(f.remoteRoot,'main.tex'),text);
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 assert.equal(result.deferred.includes('source/main.tex'),false);
 assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),text);
 assert.equal(await readFile(path.join(f.remoteRoot,'main.tex'),'utf8'),text);
 await writeFile(path.join(f.remoteRoot,'main.tex'),text+'\0');
 assert.ok((await readingInventory(f.desktop,f.id,true)).deferred.includes('source/main.tex'));
 assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),text);
});
test('settled sources and existing notebooks advance while unrelated desktop reports keep changing',async()=>{
 const f=await fixture(),folder=path.join(projectDataPath(f.desktop,f.id),'research/hot');await mkdir(folder,{recursive:true});let tick=0;
 const runner:SshRunner=async(...args)=>{await writeFile(path.join(folder,'report.json'),JSON.stringify({tick:++tick}));return f.runner(...args);};
 const before=await exchangeStatus(f.home,f.id);await writeFile(path.join(f.remoteRoot,'main.tex'),'Desktop explanation.\n');await writeFile(path.join(f.remoteRoot,'new-note.tex'),'A new note.\n');await changeNotebook(f.desktop,f.id,'New notebook explanation');
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,runner);
 assert.deepEqual(result.held,[]);assert.deepEqual(result.deferred,[]);assert.ok(result.copied.includes('source/main.tex'));assert.ok(result.copied.includes('notebook/question'));
 assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'Desktop explanation.\n');assert.equal(await readFile(path.join(f.root,'new-note.tex'),'utf8'),'A new note.\n');assert.equal((await readExperiments(f.home,f.id,'question')).notebook.cells[0].source,'New notebook explanation');
 assert.deepEqual(await exchangeStatus(f.home,f.id),before);assert.equal(result.wholeProjectAcknowledged,false);assert.ok(f.calls.every(action=>action.startsWith('reading-')));
 await assert.rejects(stat(path.join(projectDataPath(f.home,f.id),'research/hot/report.json')),/ENOENT/);
});

test('fast TeX/comment passes leave notebook changes and large unrelated source assets for the slow lane',async()=>{
 const f=await fixture();await changeNotebook(f.desktop,f.id,'Slow notebook update');await writeFile(path.join(f.remoteRoot,'main.tex'),'Fast source update');await writeFile(path.join(f.remoteRoot,'raw.npy'),Buffer.alloc(1024));
 const requests:any[]=[];const runner:SshRunner=async(...args)=>{requests.push(JSON.parse(args[2].toString()));return f.runner(...args);};
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,runner,{fastOnly:true});assert.deepEqual(result.copied,['source/main.tex']);assert.equal(result.checked,4); // text, comments and the negotiated pin/slide-deck records
 assert.equal((await readExperiments(f.home,f.id,'question')).notebook.cells[0].source,'Initial evidence');assert.ok(requests.every(r=>!r.item?.key.startsWith('notebook/')));assert.equal(requests[0].fastOnly,true);
});

test('fast reading does not queue behind another project bulk scan and never contacts SSH outside the network gate',async()=>{
 const f=await fixture();await configureAutoSync(f.home,f.id,{peerId:f.peer.id,mode:'safe',savedDraftsConfirmed:true});await followReadingSync(f.home,f.id);
 const release=await acquireRecordLock(await privateSyncPath(f.home,'auto/coordinator',true),0);
 try{
  const count=f.calls.length,offline=await autoSyncCycle(f.home,f.id,{runner:f.runner,checkNow:true,fastOnly:true,networkCheck:async()=>({allowed:false,reason:'VPN down'})});
  assert.equal(offline.status,'waiting-network');assert.equal(f.calls.length,count);
  await writeFile(path.join(f.remoteRoot,'main.tex'),'Prompt source delivery');
  const online=await autoSyncCycle(f.home,f.id,{runner:f.runner,checkNow:true,fastOnly:true});assert.equal(online.status,'synced');assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'Prompt source delivery');
 }finally{await release();}
});
test('one moving record is deferred; another copies now and the moving one follows next pass',async()=>{
 const f=await fixture();await writeFile(path.join(f.remoteRoot,'main.tex'),'First revision');await writeFile(path.join(f.remoteRoot,'settled.tex'),'Settled note');let moved=false;
 const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString());if(request.action==='reading-get'&&request.item.key==='source/main.tex'&&!moved){moved=true;await writeFile(path.join(f.remoteRoot,'main.tex'),'Next revision');}return f.runner(...args);};
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,runner);assert.ok(first.deferred.includes('source/main.tex'));assert.ok(first.copied.includes('source/settled.tex'));assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),original);
 const second=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(second.copied.includes('source/main.tex'));assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'Next revision');
});
test('laptop edits go back to the desktop; competing edits and deletions never choose a winner',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'main.tex'),'Laptop note');assert.ok((await syncReadingRecords(f.home,f.id,f.peer.id,f.runner)).copied.includes('source/main.tex'));assert.equal(await readFile(path.join(f.remoteRoot,'main.tex'),'utf8'),'Laptop note');
 await writeFile(path.join(f.root,'main.tex'),'Human edit');await writeFile(path.join(f.remoteRoot,'main.tex'),'Desktop edit');const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.held.includes('source/main.tex'));assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'Human edit');assert.equal(await readFile(path.join(f.remoteRoot,'main.tex'),'utf8'),'Desktop edit');
});

test('different passages edited on both devices combine automatically inside the same TeX file',async()=>{
 const f=await fixture(),base='First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';await writeFile(path.join(f.root,'main.tex'),base);await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 await writeFile(path.join(f.root,'main.tex'),base.replace('First paragraph.','Human first paragraph.'));await writeFile(path.join(f.remoteRoot,'main.tex'),base.replace('Third paragraph.','Agent third paragraph.'));
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(result.held,[]);assert.ok(result.copied.includes('source/main.tex'));
 const expected=base.replace('First paragraph.','Human first paragraph.').replace('Third paragraph.','Agent third paragraph.');for(const root of [f.root,f.remoteRoot])assert.equal(await readFile(path.join(root,'main.tex'),'utf8'),expected);
 assert.deepEqual(await listReadingSourceReviews(f.home,f.id),[]);assert.ok(f.calls.every(action=>action.startsWith('reading-')));
});
test('overlapping revisions stay unchanged with a saved comparison; one human choice moves the selected text automatically',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'main.tex'),'My revision.\n');await writeFile(path.join(f.remoteRoot,'main.tex'),'Agent revision.\n');
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.ok(first.held.includes('source/main.tex'));
 const reviews=await listReadingSourceReviews(f.home,f.id);assert.equal(reviews.length,1);const review=await readReadingSourceReview(f.home,f.id,reviews[0].id);assert.equal(review.localText,'My revision.\n');assert.equal(review.remoteText,'Agent revision.\n');assert.equal(review.baseText,original);
 for(let n=0;n<2;n++)await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.equal((await listReadingSourceReviews(f.home,f.id))[0].id,review.id,'Repeated passes reuse the same comparison');
 await chooseReadingSource(f.home,f.id,review.id,'remote');assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'My revision.\n','Choosing queues an exact guarded sync, not an immediate source write');
 const applied=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(applied.held,[]);for(const root of [f.root,f.remoteRoot])assert.equal(await readFile(path.join(root,'main.tex'),'utf8'),'Agent revision.\n');assert.deepEqual(await listReadingSourceReviews(f.home,f.id),[]);
 assert.equal((await readReadingSourceReview(f.home,f.id,review.id)).localText,'My revision.\n','Originals remain readable');
});
test('a local choice and a stale choice never overwrite newer saved work or protected publication text',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'main.tex'),'Human revision');await writeFile(path.join(f.remoteRoot,'main.tex'),'Agent revision');await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});const review=(await listReadingSourceReviews(f.home,f.id))[0];
 await writeFile(path.join(f.root,'main.tex'),'Human newer revision');await assert.rejects(chooseReadingSource(f.home,f.id,review.id,'remote'),/saved text changed/);
 await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});const current=(await listReadingSourceReviews(f.home,f.id))[0];await chooseReadingSource(f.home,f.id,current.id,'local');
 await writeFile(path.join(f.remoteRoot,'main.tex'),'Agent newer revision');const stopped=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.ok(stopped.held.includes('source/main.tex'));assert.equal(await readFile(path.join(f.remoteRoot,'main.tex'),'utf8'),'Agent newer revision');
 const fresh=(await listReadingSourceReviews(f.home,f.id))[0];await chooseReadingSource(f.home,f.id,fresh.id,'local');const applied=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(applied.held,[]);assert.equal(await readFile(path.join(f.remoteRoot,'main.tex'),'utf8'),'Human newer revision');
 const r=await registry(f.home);r.projects.find(p=>p.id===f.id)!.manuscriptPurposes={'main.tex':'publication'};await saveRegistry(f.home,r);await assert.rejects(chooseReadingSource(f.home,f.id,fresh.id,'remote'),/no longer current|Publication/);
});
test('lost merge acknowledgement catches up without rollback or another full-project comparison',async()=>{
 const f=await fixture(),base='A\n\nB\n\nC\n';await writeFile(path.join(f.root,'main.tex'),base);await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});await writeFile(path.join(f.root,'main.tex'),base.replace('A','Human A'));await writeFile(path.join(f.remoteRoot,'main.tex'),base.replace('C','Agent C'));
 let dropped=false;const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),result=await f.runner(...args);if(request.action==='reading-put'&&request.packet.item.key==='source/main.tex'&&!dropped){dropped=true;throw Error('Connection dropped after source merge');}return result;};
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,runner,{fastOnly:true});assert.ok(first.deferred.includes('source/main.tex'));
 const retry=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(retry.held,[]);for(const root of [f.root,f.remoteRoot])assert.equal(await readFile(path.join(root,'main.tex'),'utf8'),'Human A\n\nB\n\nAgent C\n');
});
test('an edit made during a source merge is preserved, never replaced with the earlier proposal',async()=>{
 const f=await fixture(),base='A\n\nB\n\nC\n';await writeFile(path.join(f.root,'main.tex'),base);await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});await writeFile(path.join(f.root,'main.tex'),base.replace('A','Human A'));await writeFile(path.join(f.remoteRoot,'main.tex'),base.replace('C','Agent C'));
 let changed=false;const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),result=await f.runner(...args);if(request.action==='reading-get'&&request.item.key==='source/main.tex'&&!changed){changed=true;await writeFile(path.join(f.root,'main.tex'),'New human draft saved meanwhile.');}return result;};
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,runner,{fastOnly:true});assert.ok(result.deferred.includes('source/main.tex'));assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'New human draft saved meanwhile.');
});
test('comments copy without request/queue-state replacement or inferred resolution',async()=>{
 const f=await fixture(),wb=await readWorkbench(f.desktop,f.id);
 wb.attentionTasks.push({id:'comment',title:'Clarify',nodeId:'n',paragraphId:'p',route:'local',status:'queued',createdAt:stamp,updatedAt:stamp,sourceSnapshot:{version:1,projectId:f.id,rootFile:'main.tex',revision:'hash',scope:'paragraph',nodeId:'n',nodeTitle:'Note',paragraphs:[{id:'p',nodeId:'n',file:'main.tex',text:'Original source.'}]},review:{kind:'comment',author:'human',body:'Explain this',quote:'Original',start:0,end:8}});
 await writeWorkbench(f.desktop,f.id,wb.revision,wb);
 const local=await readWorkbench(f.home,f.id);local.queueLastActiveAt=stamp;await writeWorkbench(f.home,f.id,local.revision,local);
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.copied.includes('comments'));const saved=await readWorkbench(f.home,f.id);assert.equal(saved.attentionTasks[0].status,'queued');assert.equal(saved.queueLastActiveAt,stamp);assert.equal(saved.attentionTasks[0].review?.kind,'comment');if(saved.attentionTasks[0].review?.kind==='comment')assert.equal(saved.attentionTasks[0].review.body,'Explain this');
});

test('independent comments and replies added on both machines sync in one fast pass without full reconciliation',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'laptop');await addComment(f.desktop,f.id,'desktop');
 for(const [home,position] of [[f.home,5],[f.desktop,9]] as const){const wb=await readWorkbench(home,f.id);wb.attentionTasks[0].queuePosition=position;await writeWorkbench(home,f.id,wb.revision,wb);}
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(result.held,[]);assert.ok(result.copied.includes('comments'));
 for(const home of [f.home,f.desktop])assert.deepEqual((await readWorkbench(home,f.id)).attentionTasks.map(t=>t.id).sort(),['desktop','laptop']);
 assert.equal((await readWorkbench(f.home,f.id)).attentionTasks.find(t=>t.id==='laptop')!.queuePosition,5);assert.equal((await readWorkbench(f.desktop,f.id)).attentionTasks.find(t=>t.id==='desktop')!.queuePosition,9);
 assert.equal((await readWorkbench(f.desktop,f.id)).attentionTasks.find(t=>t.id==='laptop')!.queuePosition,undefined);
 for(const [home,replyId] of [[f.home,'reply-laptop'],[f.desktop,'reply-desktop']]){const wb=await readWorkbench(home,f.id),reply=commentTask(f.id,replyId);(reply.review as any).replyTo='laptop';wb.attentionTasks.push(reply);await writeWorkbench(home,f.id,wb.revision,wb);}
 assert.deepEqual((await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true})).held,[]);
 assert.equal((await readWorkbench(f.home,f.id)).attentionTasks.length,4);assert.equal((await readWorkbench(f.desktop,f.id)).attentionTasks.length,4);
 assert.ok(f.calls.every(action=>action.startsWith('reading-')));
});
test('simultaneous edits to one comment keep both wordings and retries do not make more copies',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'same','Initial');await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);
 for(const [home,text] of [[f.home,'Laptop revision'],[f.desktop,'Desktop revision']]){const wb=await readWorkbench(home,f.id);(wb.attentionTasks[0].review as any).body=text;await writeWorkbench(home,f.id,wb.revision,wb);}
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(result.held,[]);
 for(const home of [f.home,f.desktop]){const wb=await readWorkbench(home,f.id);assert.equal(wb.attentionTasks.length,2);assert.deepEqual(new Set(wb.attentionTasks.map(t=>(t.review as any).body)),new Set(['Laptop revision','Desktop revision']));assert.ok(wb.attentionTasks.every(t=>t.status==='queued'));}
 const again=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(again.copied,[]);assert.equal((await readWorkbench(f.home,f.id)).attentionTasks.length,2);
});
test('lost union acknowledgement retries without dropping a comment, multiplying variants or touching protected state',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'laptop');await addComment(f.desktop,f.id,'desktop');
 const wb=await readWorkbench(f.home,f.id);wb.queueLastActiveAt=stamp;wb.handoffDrafts['codex:n']={effort:1,scope:'none',includeProject:false,instruction:'Keep this private'};await writeWorkbench(f.home,f.id,wb.revision,wb);
 let dropped=false;const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),result=await f.runner(...args);if(request.action==='reading-put'&&request.packet.commentUnion&&!dropped){dropped=true;throw Error('Connection dropped after comment save');}return result;};
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,runner,{fastOnly:true});assert.ok(first.deferred.includes('comments'));assert.equal((await readWorkbench(f.desktop,f.id)).attentionTasks.length,2);
 const retry=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(retry.held,[]);const saved=await readWorkbench(f.home,f.id);assert.equal(saved.attentionTasks.length,2);assert.equal(saved.queueLastActiveAt,stamp);assert.deepEqual(saved.handoffDrafts,wb.handoffDrafts);
});
test('a comment edit during union collection is preserved and followed on the next pass',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'laptop');await addComment(f.desktop,f.id,'desktop');let edited=false;
 const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),result=await f.runner(...args);if(request.action==='reading-get'&&request.item.key==='comments'&&!edited){edited=true;await addComment(f.home,f.id,'late');}return result;};
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,runner,{fastOnly:true});assert.ok(first.deferred.includes('comments'));assert.ok((await readWorkbench(f.home,f.id)).attentionTasks.some(t=>t.id==='late'));
 assert.deepEqual((await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true})).held,[]);for(const home of [f.home,f.desktop])assert.equal((await readWorkbench(home,f.id)).attentionTasks.length,3);
});
test('busy notebook owners defer without stealing leases or blocking source; provenance and deletions stay guarded',async()=>{
 const f=await fixture();await changeNotebook(f.desktop,f.id,'New evidence');await writeFile(path.join(f.remoteRoot,'main.tex'),'Fresh text');const release=await acquireRecordLock(path.join(projectDataPath(f.home,f.id),'experiments/question/python-run'),0);
 try{const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.deferred.includes('notebook/question'));assert.ok(result.copied.includes('source/main.tex'));assert.equal((await readExperiments(f.home,f.id,'question')).notebook.cells[0].source,'Initial evidence');}finally{await release();}
 assert.ok((await syncReadingRecords(f.home,f.id,f.peer.id,f.runner)).copied.includes('notebook/question'));
 const nb=await readExperiments(f.desktop,f.id,'question');nb.notebook.cells=[];await writeExperiments(f.desktop,f.id,'question',nb.revision,nb.notebook);assert.ok((await syncReadingRecords(f.home,f.id,f.peer.id,f.runner)).held.includes('notebook/question'));assert.equal((await readExperiments(f.home,f.id,'question')).notebook.cells.length,1);
});
test('publication, foreign identities, traversal and tampered content refuse source writes',async()=>{
 const f=await fixture(),inv=await readingInventory(f.desktop,f.id),item=inv.items.find(i=>i.key==='source/main.tex')!,value=await readingPacket(f.desktop,f.id,item);value.data=Buffer.from('Tampered').toString('base64');await assert.rejects(applyReadingPacket(f.home,f.id,value,item),/checksum/);
 await assert.rejects(handleReadingMessage(f.home,f.id,{version:1,action:'reading-inventory',maxBytes:16*1024**2,expectedDeviceId:'wrong'}),/Invalid scoped/);
 await assert.rejects(readingPacket(f.home,f.id,{...item,key:'source/../escape.tex'}),/supported reading/);
 const r=await registry(f.desktop);r.projects.find(p=>p.id===f.id)!.manuscriptPurposes={'main.tex':'publication'};await saveRegistry(f.desktop,r);await writeFile(path.join(f.remoteRoot,'main.tex'),'Publication proposal');const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.held.includes('source/main.tex'));assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),original);
});
test('safe scheduled follow mode uses reading records, never whole-project capture of busy research',async()=>{
 const f=await fixture();await configureAutoSync(f.home,f.id,{peerId:f.peer.id,mode:'safe',savedDraftsConfirmed:true});await followReadingSync(f.home,f.id);await writeFile(path.join(f.remoteRoot,'main.tex'),'Scheduled update');
 const state=await autoSyncCycle(f.home,f.id,{runner:f.runner,checkNow:true});assert.equal(state.status,'synced');assert.ok('scope' in state);assert.equal(state.scope,'reading');assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),'Scheduled update');
});

test('lost acknowledgement after an atomic remote write is observed next pass without replay or lost progress',async()=>{
 const f=await fixture();await writeFile(path.join(f.root,'main.tex'),'Laptop continuation');let lost=false;
 const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),result=await f.runner(...args);if(request.action==='reading-put'&&!lost){lost=true;throw Error('Connection dropped after atomic file save');}return result;};
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,runner);assert.ok(first.deferred.includes('source/main.tex'));assert.equal(await readFile(path.join(f.remoteRoot,'main.tex'),'utf8'),'Laptop continuation');
 const calls=f.calls.length,second=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.deepEqual(second.held,[]);assert.deepEqual(second.deferred,[]);assert.deepEqual(second.copied,[]);assert.deepEqual(f.calls.slice(calls),['reading-inventory']);
});

test('new notebook output requires exact settled run evidence; importing it never runs Python',async()=>{
 const f=await fixture(),nb=await readExperiments(f.desktop,f.id,'question');
 nb.notebook.cells.push({id:'calc',cell_type:'code',source:'raise RuntimeError("DO NOT EXECUTE")',metadata:{paperfocus:{runId:'saved-run'}},execution_count:1,outputs:[{output_type:'stream',name:'stdout',text:'Saved output'}]});
 await writeExperiments(f.desktop,f.id,'question',nb.revision,nb.notebook);
 const missing=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);
 assert.ok(missing.held.includes('notebook/question'));
 assert.ok(!missing.deferred.includes('notebook/question'));
 assert.match(missing.issues?.find(i=>i.key==='notebook/question')?.reason??'',/run provenance is missing/);
 assert.equal(missing.codeExecuted,false);
 assert.equal((await readExperiments(f.home,f.id,'question')).notebook.cells.length,1,'missing run evidence never reaches the receiving notebook');
 const runs=path.join(projectDataPath(f.desktop,f.id),'experiments/question/runs');await mkdir(runs,{recursive:true});await writeFile(path.join(runs,'saved-run.json'),JSON.stringify({id:'saved-run',cellId:'calc',status:'ready',source:'raise RuntimeError("DO NOT EXECUTE")'}));
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.copied.includes('notebook/question'));assert.equal(result.codeExecuted,false);assert.equal((await readExperiments(f.home,f.id,'question')).notebook.cells[1].source,'raise RuntimeError("DO NOT EXECUTE")');
 assert.equal(JSON.parse(await readFile(path.join(projectDataPath(f.home,f.id),'experiments/question/runs/saved-run.json'),'utf8')).cellId,'calc');
});

test('bounded passes continue through a backlog; settings changes prevent new writes after a read',async()=>{
 const f=await fixture();for(let i=0;i<35;i++)await writeFile(path.join(f.remoteRoot,`note-${i}.tex`),'A small note');
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.equal(first.copied.length,32);assert.equal(first.deferred.length,3);assert.ok(first.transferredBytes<32*1024**2);
 const second=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.equal(second.copied.length,3);assert.deepEqual(second.deferred,[]);
 await writeFile(path.join(f.remoteRoot,'main.tex'),'Pending text');let permission=true;
 const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),result=await f.runner(...args);if(request.action==='reading-get')permission=false;return result;};
 const stopped=await syncReadingRecords(f.home,f.id,f.peer.id,runner,{mayWrite:async()=>permission});assert.ok(stopped.deferred.includes('source/main.tex'));assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),original);
});

test('source figures preserve exact bytes; unsupported code and invalid text never enter the reading lane',async()=>{
 const f=await fixture(),picture=Buffer.from([137,80,78,71,13,10,26,10,0,255]);await writeFile(path.join(f.remoteRoot,'figure.png'),picture);await writeFile(path.join(f.remoteRoot,'helper.py'),'raise RuntimeError("never run")');
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.copied.includes('source/figure.png'));assert.deepEqual(await readFile(path.join(f.root,'figure.png')),picture);await assert.rejects(stat(path.join(f.root,'helper.py')),/ENOENT/);
 const item=(await readingInventory(f.desktop,f.id)).items.find(i=>i.key==='source/main.tex')!,value=await readingPacket(f.desktop,f.id,item),bad=Buffer.from([0,255]);value.data=bad.toString('base64');value.item={...item,bytes:bad.length,raw:syncHash(bad),digest:syncHash(bad)};
 await assert.rejects(applyReadingPacket(f.home,f.id,value,item),/encoded data|UTF-8|encoding/i);assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),original);
});

test('ordinary reading pins follow their source files while unrelated purpose metadata stays local',async()=>{
 const f=await fixture(),r=await registry(f.desktop),project=r.projects.find(p=>p.id===f.id)!;project.manuscriptPurposes={...project.manuscriptPurposes,'another-note.tex':'notes'};project.manuscriptPins={notes:'another-note.tex'};await saveRegistry(f.desktop,r);
 project.manuscriptPurposes['unrelated.tex']='overview';await saveRegistry(f.desktop,r);
 await writeFile(path.join(f.remoteRoot,'another-note.tex'),original.replace('Original source.','Another research note'));
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(result.copied.includes('source/another-note.tex'));
 await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);
 const local=(await getProject(f.home,f.id)).project;assert.equal(local.manuscriptPins?.notes,'another-note.tex');assert.equal(local.manuscriptPurposes?.['unrelated.tex'],undefined);assert.equal(local.mainFile,'main.tex');
});

test('old peers without a document-pin capability still sync source without importing pins',async()=>{
 const f=await fixture(),r=await registry(f.desktop),p=r.projects.find(p=>p.id===f.id)!;p.manuscriptPins={notes:'main.tex'};await saveRegistry(f.desktop,r);
 await writeFile(path.join(f.remoteRoot,'other.tex'),'Ordinary text');
 const old:SshRunner=async(...args)=>{const v=JSON.parse((await f.runner(...args)).toString());if(v.inventory)delete v.inventory.documentPins;return Buffer.from(JSON.stringify(v));};
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,old);assert.ok(result.copied.includes('source/other.tex'));assert.equal((await getProject(f.home,f.id)).project.manuscriptPins,undefined);
});

test('slide deck pins negotiate separately, follow new source and retain old-peer compatibility',async()=>{
 const f=await fixture(),text='\\documentclass{beamer}\n\\begin{document}\\begin{frame}Talk.\\end{frame}\\end{document}';
 await writeFile(path.join(f.remoteRoot,'talk.tex'),text);
 await applySlideChoice(f.desktop,f.id,{version:1,file:'talk.tex'},syncHash(canonical(slideChoice((await getProject(f.desktop,f.id)).project))));
 // Older peers ignore this side capability; they still get ordinary source.
 const old:SshRunner=async(...args)=>{const v=JSON.parse((await f.runner(...args)).toString());if(v.inventory)delete v.inventory.slideDeck;return Buffer.from(JSON.stringify(v));};
 await syncReadingRecords(f.home,f.id,f.peer.id,old,{fastOnly:true});assert.equal((await getProject(f.home,f.id)).project.slideDeck,undefined);
 let result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.ok(result.copied.includes('slide-deck'));assert.equal((await getProject(f.home,f.id)).project.slideDeck,'talk.tex');
 const baseline=JSON.parse(await readFile(await privateSyncPath(f.home,`reading/${f.id}/${f.peer.id}.json`),'utf8'));assert.ok(baseline.slideDeck);assert.equal(baseline.files['slide-deck'],undefined,'Old clients must not encounter an unknown key in files');
 await applySlideChoice(f.home,f.id,{version:1,file:null},syncHash(canonical(slideChoice((await getProject(f.home,f.id)).project))));
 result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(!result.held.length);assert.equal((await getProject(f.desktop,f.id)).project.slideDeck,undefined);
});

test('reading pins combine independent roles, follow explicit unpinning and hold competing choices',async()=>{
 const f=await fixture();
 for(const name of ['overview.tex','note.tex','other.tex'])for(const root of [f.root,f.remoteRoot])await writeFile(path.join(root,name),original);
 let l=await registry(f.home),r=await registry(f.desktop);
 l.projects.find(p=>p.id===f.id)!.manuscriptPins={overview:'overview.tex'};
 l.projects.find(p=>p.id===f.id)!.manuscriptPurposes={'overview.tex':'overview'};
 r.projects.find(p=>p.id===f.id)!.manuscriptPins={notes:'note.tex'};
 await saveRegistry(f.home,l);await saveRegistry(f.desktop,r);
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.ok(first.copied.includes('document-pins'));
 for(const home of [f.home,f.desktop]){const p=(await getProject(home,f.id)).project;assert.deepEqual(p.manuscriptPins,{overview:'overview.tex',notes:'note.tex'});assert.equal(p.manuscriptPurposes?.['overview.tex'],'overview');assert.equal(p.mainFile,'main.tex');}
 l=await registry(f.home);delete l.projects.find(p=>p.id===f.id)!.manuscriptPins!.notes;await saveRegistry(f.home,l);
 await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.equal((await getProject(f.desktop,f.id)).project.manuscriptPins?.notes,undefined);
 l=await registry(f.home);r=await registry(f.desktop);l.projects.find(p=>p.id===f.id)!.manuscriptPins!.notes='note.tex';r.projects.find(p=>p.id===f.id)!.manuscriptPins!.notes='other.tex';await saveRegistry(f.home,l);await saveRegistry(f.desktop,r);
 const conflict=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(conflict.held.includes('document-pins'));assert.equal((await getProject(f.home,f.id)).project.manuscriptPins?.notes,'note.tex');assert.equal((await getProject(f.desktop,f.id)).project.manuscriptPins?.notes,'other.tex');
});

test('pin import cannot relabel publication, invent paths, or overwrite a newer choice',async()=>{
 const f=await fixture(),r=await registry(f.home),p=r.projects.find(p=>p.id===f.id)!;p.manuscriptPurposes={'main.tex':'publication'};p.manuscriptPins={publication:'main.tex'};await saveRegistry(f.home,r);
 const empty=readingPins(p),digest=syncHash(canonical(empty));
 await assert.rejects(applyReadingPins(f.home,f.id,{...empty,notes:'main.tex'},digest),/Publication/);
 await assert.rejects(applyReadingPins(f.home,f.id,{...empty,notes:'../foreign.tex'},digest),/Invalid/);
 await assert.rejects(applyReadingPins(f.home,f.id,empty,'0'.repeat(64)),/changed/);
 assert.equal((await getProject(f.home,f.id)).project.manuscriptPurposes?.['main.tex'],'publication');assert.equal((await getProject(f.home,f.id)).project.manuscriptPins?.publication,'main.tex');
 assert.throws(()=>mergeReadingPins(undefined,{...empty,notes:'one.tex'},{...empty,notes:'two.tex'}),/Conflicting/);
});

test('a dropped VPN stops later SSH calls in the pass, retaining earlier confirmed progress',async()=>{
 const f=await fixture();await writeFile(path.join(f.remoteRoot,'a.tex'),'First note');await writeFile(path.join(f.remoteRoot,'b.tex'),'Second note');await writeFile(path.join(f.remoteRoot,'c.tex'),'Third note');let dropped=false,callsAfterDrop=0;
 const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString());if(dropped){callsAfterDrop++;throw Error('Connection closed');}if(request.action==='reading-get'&&request.item.key==='source/b.tex'){dropped=true;throw Error('SSH exchange unavailable (255). Connection closed');}return f.runner(...args);};
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,runner);assert.ok(first.copied.includes('source/a.tex'));assert.ok(first.deferred.includes('source/b.tex'));assert.ok(first.deferred.includes('source/c.tex'));assert.equal(callsAfterDrop,0);
 const next=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.ok(next.copied.includes('source/b.tex'));assert.ok(next.copied.includes('source/c.tex'));assert.ok(!next.copied.includes('source/a.tex'));
});

test('cross-platform case collisions stop before any reading record is copied',async()=>{
 const f=await fixture();const runner:SshRunner=async(...args)=>{const request=JSON.parse(args[2].toString()),response=JSON.parse((await f.runner(...args)).toString());if(request.action==='reading-inventory'){const item=response.inventory.items.find((i:any)=>i.key==='source/main.tex');response.inventory.items.push({...item,key:'source/MAIN.tex'});}return Buffer.from(JSON.stringify(response));};
 await assert.rejects(syncReadingRecords(f.home,f.id,f.peer.id,runner),/letter case/);assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),original);
});
test('inventory policy reuse never authorizes a later write after publication protection changes',async()=>{
 const f=await fixture();
 await writeFile(path.join(f.remoteRoot,'main.tex'),'An incoming ordinary note');
 // Several source files share one inventory observation, not a persistent policy cache.
 for(let index=0;index<12;index++)await writeFile(path.join(f.remoteRoot,`note-${index}.tex`),`Note ${index}`);
 const incoming=await readingInventory(f.desktop,f.id,true);
 const item=incoming.items.find(item=>item.key==='source/main.tex')!;
 const packet=await readingPacket(f.desktop,f.id,item);
 const r=await registry(f.home);r.projects.find(p=>p.id===f.id)!.manuscriptPurposes={'main.tex':'publication'};await saveRegistry(f.home,r);
 const before=await readFile(path.join(f.root,'main.tex'),'utf8');
 await assert.rejects(applyReadingPacket(f.home,f.id,packet,(await readingInventory(f.home,f.id,true)).items.find(item=>item.key==='source/main.tex')),/Publication|locked|protected/i);
 assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),before);
});
test('own-save return hints stay local and do not hold the next real comment edit',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'same');await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 const wb=await readWorkbench(f.home,f.id),task=wb.attentionTasks.find(t=>t.id==='same')!;
 task.sourceSnapshot!.returnAnchor={paragraphId:'new-position',paragraphText:'Original source. Extra text.',file:'main.tex',revision:'new',start:0,end:8};
 await writeWorkbench(f.home,f.id,wb.revision,wb);
 const aligned=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 assert.deepEqual(aligned.held,[]);assert.ok(!aligned.copied.includes('comments'));
 assert.equal((await readWorkbench(f.desktop,f.id)).attentionTasks[0].sourceSnapshot!.returnAnchor,undefined);
 const next=await readWorkbench(f.home,f.id);(next.attentionTasks[0].review as any).body='A revised human comment';await writeWorkbench(f.home,f.id,next.revision,next);
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(result.held,[]);assert.ok(result.copied.includes('comments'));
 const received=(await readWorkbench(f.desktop,f.id)).attentionTasks[0].review;
 assert.equal(received?.kind==='comment'?received.body:undefined,'A revised human comment');
 assert.ok((await readWorkbench(f.home,f.id)).attentionTasks[0].sourceSnapshot!.returnAnchor);
 assert.equal((await readWorkbench(f.desktop,f.id)).attentionTasks[0].sourceSnapshot!.returnAnchor,undefined);
});

test('shared historical resolved comments cannot block unrelated new comments on both devices',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'old');await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 for(const home of [f.home,f.desktop]){const wb=await readWorkbench(home,f.id);wb.attentionTasks[0].status='reviewed';(wb.attentionTasks[0].review as any).resolvedAt=stamp;await writeWorkbench(home,f.id,wb.revision,wb);}
 await addComment(f.home,f.id,'human-new');await addComment(f.desktop,f.id,'desktop-new');
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(result.held,[]);
 for(const home of [f.home,f.desktop]){const wb=await readWorkbench(home,f.id);assert.equal(wb.attentionTasks.length,3);assert.equal(wb.attentionTasks.find(t=>t.id==='old')!.status,'reviewed');assert.ok(wb.attentionTasks.filter(t=>t.id!=='old').every(t=>t.status==='queued'));}
});

test('shared old reply captures do not block subsequent one-sided and independent comments',async()=>{
 const f=await fixture();await addComment(f.home,f.id,'parent');await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});
 for(const home of [f.home,f.desktop]){
  const wb=await readWorkbench(home,f.id),reply=commentTask(f.id,'old-reply','An existing historical reply');
  (reply.review as any).replyTo='parent';reply.sourceSnapshot.revision='later-source';reply.sourceSnapshot.paragraphs[0].text+=' Revised passage.';
  wb.attentionTasks.push(reply);await writeWorkbench(home,f.id,wb.revision,wb);
 }
 await addComment(f.home,f.id,'human-new');
 const first=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(first.held,[]);
 await addComment(f.home,f.id,'laptop-next');await addComment(f.desktop,f.id,'desktop-next');
 const next=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner,{fastOnly:true});assert.deepEqual(next.held,[]);
 for(const home of [f.home,f.desktop]){const wb=await readWorkbench(home,f.id);assert.equal(wb.attentionTasks.length,5);assert.equal(wb.attentionTasks.find(t=>t.id==='old-reply')!.sourceSnapshot!.revision,'later-source');assert.ok(wb.attentionTasks.every(t=>t.status==='queued'));}
});

test('requested reading selection excludes desktop leads and keeps selected TeX and comments live',async()=>{
 const f=await fixture();
 await writeFile(path.join(f.remoteRoot,'unrequested.tex'),original.replace('Original source.','Desktop lead.'));
 const selection={version:1,files:['main.tex'],notebooks:['question']};
 for(const home of [f.home,f.desktop]){const target=await privateSyncPath(home,`reading/${f.id}/selection.json`,true);await writeFile(target,JSON.stringify(selection));}
 const inv=await readingInventory(f.desktop,f.id);assert.ok(!inv.items.some(i=>i.key==='source/unrequested.tex'));assert.ok(inv.items.some(i=>i.key==='comments'));assert.ok(!inv.documentPins);
 await writeFile(path.join(f.remoteRoot,'main.tex'),original.replace('Original source.','Requested edit.'));
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.deepEqual(result.held,[]);assert.ok(result.copied.includes('source/main.tex'));
 assert.equal((await readFile(path.join(f.root,'main.tex'),'utf8')).includes('Requested edit.'),true);
 await assert.rejects(readFile(path.join(f.root,'unrequested.tex')),/ENOENT/);
 for(const value of [{...selection,files:['../private.tex']},{...selection,notebooks:['../owner']}])assert.throws(()=>validateReadingSelection(value));
});

test('requested reports follow new literal figures and included TeX without importing unrelated leads',async()=>{
 const f=await fixture();const selection={version:1,files:['main.tex'],notebooks:['question'],roots:['main.tex']};
 for(const home of [f.home,f.desktop])await writeFile(await privateSyncPath(home,`reading/${f.id}/selection.json`,true),JSON.stringify(selection));
 await mkdir(path.join(f.remoteRoot,'figures'),{recursive:true});await mkdir(path.join(f.remoteRoot,'parts'),{recursive:true});
 const updated=original.replace('Original source.',String.raw`Updated retained report.\input{parts/detail}\includegraphics{figures/new}
\href{unrequested.tex}{Other lead}
% \includegraphics{figures/secret.pdf}`);
 await writeFile(path.join(f.remoteRoot,'main.tex'),updated);await writeFile(path.join(f.remoteRoot,'parts/detail.tex'),'An included derivation.');await writeFile(path.join(f.remoteRoot,'figures/new.pdf'),'%PDF-new');await writeFile(path.join(f.remoteRoot,'unrequested.tex'),original);
 const allowed=await effectiveReadingSelection(f.desktop,f.id);assert.ok(allowed?.files.includes('figures/new.pdf'));assert.ok(allowed?.files.includes('parts/detail.tex'));assert.ok(!allowed?.files.includes('unrequested.tex'));assert.ok(!allowed?.files.includes('figures/secret.pdf'));
 await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);
 const result=await syncReadingRecords(f.home,f.id,f.peer.id,f.runner);assert.deepEqual(result.held,[],JSON.stringify(result));
 assert.equal(await readFile(path.join(f.root,'figures/new.pdf'),'utf8'),'%PDF-new');assert.equal(await readFile(path.join(f.root,'parts/detail.tex'),'utf8'),'An included derivation.');await assert.rejects(readFile(path.join(f.root,'unrequested.tex')),/ENOENT/);
 assert.deepEqual((JSON.parse(await readFile(await privateSyncPath(f.home,`reading/${f.id}/selection.json`),'utf8'))).files,['main.tex'],'dependency discovery does not broaden the explicit report selection');
});
