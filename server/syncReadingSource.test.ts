import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createPaperProject} from './projectFiles.ts';
import {getProject,registry,saveRegistry} from './projects.ts';
import {syncHash} from './syncProtocol.ts';
import {saveReadingSourceReview,readReadingSourceReview,readingSourceChoice,chooseReadingSource,listReadingSourceReviews,clearReadingSourceReview,rememberReadingSource,readingSourceBase} from './syncReadingSource.ts';
import {desktopServer} from '../scripts/desktopServer.mjs';
import {syncCommand,syncOptions} from '../scripts/awSync.ts';
async function fixture(){const parent=path.resolve('.paperfocus/trials');await mkdir(parent,{recursive:true});const home=await mkdtemp(path.join(parent,'source-choices-')),p=await createPaperProject(home,'Saved source comparison trial'),root=(await getProject(home,p.id)).root;const local='Human saved text.\n',remote='Agent saved text.\n';await writeFile(path.join(root,'main.tex'),local);const review=await saveReadingSourceReview(home,p.id,{version:1,projectId:p.id,peerId:'a'.repeat(64),key:'source/main.tex',binding:'b'.repeat(64),baseHash:syncHash('Original.\n'),baseText:'Original.\n',localHash:syncHash(local),remoteHash:syncHash(remote),localText:local,remoteText:remote,reason:'Overlapping source edits'});return {home,id:p.id,root,review};}
test('source baseline caches validate exact bytes and never invent a missing baseline',async()=>{
 const f=await fixture(),data=Buffer.from('A common version.\n');assert.equal(await readingSourceBase(f.home,f.id,syncHash(data)),undefined);await rememberReadingSource(f.home,f.id,syncHash(data),data);assert.equal(await readingSourceBase(f.home,f.id,syncHash(data)),data.toString());await assert.rejects(rememberReadingSource(f.home,f.id,'c'.repeat(64),data),/checksum/);
});
test('agents can read exact saved comparisons offline without authority to choose or change source',async()=>{
 const f=await fixture(),args=['source-reviews','--workspace',f.home,'--project',f.id];assert.equal(((await syncCommand([...args])) as any).reviews[0].id,f.review.id);
 const exact=await syncCommand([...args,'--review',f.review.id]);assert.equal((exact as any).remoteText,f.review.remoteText);assert.equal(await readingSourceChoice(f.home,f.id,f.review),undefined);
 assert.throws(()=>syncOptions([...args,'--commit']),/Unknown or incomplete/);assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),f.review.localText);
});
test('comparison records are stable, retained after alignment, guarded against stale choices and publication changes',async()=>{
 const f=await fixture();assert.equal((await listReadingSourceReviews(f.home,f.id))[0].id,f.review.id);await chooseReadingSource(f.home,f.id,f.review.id,'local');assert.equal(await readingSourceChoice(f.home,f.id,f.review),'local');assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),f.review.localText);
 const r=await registry(f.home);r.projects.find(p=>p.id===f.id)!.manuscriptPurposes={'main.tex':'publication'};await saveRegistry(f.home,r);await assert.rejects(chooseReadingSource(f.home,f.id,f.review.id,'remote'),/Publication/);
 await clearReadingSourceReview(f.home,f.id,'source/main.tex');assert.deepEqual(await listReadingSourceReviews(f.home,f.id),[]);assert.equal((await readReadingSourceReview(f.home,f.id,f.review.id)).remoteText,f.review.remoteText);await assert.rejects(chooseReadingSource(f.home,f.id,f.review.id,'remote'),/no longer current/);
});
test('local comparison endpoints require the editor origin for choices and never write source on selection',async()=>{
 const f=await fixture(),server=desktopServer(f.home);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number},origin=`http://127.0.0.1:${address.port}`;
 try{
  const status=await (await fetch(`${origin}/api/paperfocus/device-sync/attention?projectId=${f.id}`)).json();assert.equal(status.sourceReviews[0].id,f.review.id);
  const endpoint=origin+'/api/paperfocus/device-sync/source-review',get=await fetch(`${endpoint}?projectId=${f.id}&reviewId=${f.review.id}`);assert.equal(get.status,200);assert.equal((await get.json()).remoteText,f.review.remoteText);
  const body=JSON.stringify({projectId:f.id,reviewId:f.review.id,choice:'remote'}),foreign=await fetch(endpoint,{method:'POST',headers:{Origin:'https://foreign.invalid','Content-Type':'application/json'},body});assert.equal(foreign.status,403);assert.equal(await readingSourceChoice(f.home,f.id,f.review),undefined);
  const chosen=await fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});assert.equal(chosen.status,200);assert.equal((await chosen.json()).sourceEdited,false);assert.equal(await readFile(path.join(f.root,'main.tex'),'utf8'),f.review.localText);
  await writeFile(path.join(f.root,'main.tex'),'New human text');assert.equal((await fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body})).status,400);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
