import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inflateRawSync} from 'node:zlib';
import {createResearchCorpus,readCorpus,saveCorpus,changeCorpus,corpusCompileSource} from './researchCorpus.ts';
import {parseProject,registry} from './projects.ts';
import {readNotebook} from './notebookStore.ts';
import {collaboratorExport} from './collaboratorExport.ts';

async function fixture(){
 const home=await mkdtemp(path.join(os.tmpdir(),'aw-corpus-'));
 const result=await createResearchCorpus(home,{name:'Research overview',entries:[{key:'first',title:'Visible result',summary:'A short explanation. A second useful sentence.',overviewUrl:'https://visible.example/overview'},{key:'second',title:'HIDDEN_PROJECT_TITLE',summary:'HIDDEN_PROJECT_SUMMARY',overviewUrl:'https://hidden.example/PRIVATE_LINK'}]});
 return {home,id:result.project.id,...result};
}
async function request(f:Awaited<ReturnType<typeof fixture>>){const d=await parseProject(f.home,f.id);return {projectId:f.id,mainFile:d.project.mainFile,revision:d.revision,notebookRevision:(await readNotebook(f.home,f.id)).revision,corpusRevision:(await readCorpus(f.home,f.id))!.revision,overviewFile:'main.tex',includeNotebook:false,includeSource:false};}
function unzip(b:Buffer){const out:Buffer[]=[];let pos=0;while(b.readUInt32LE(pos)===0x04034b50){const size=b.readUInt32LE(pos+18),len=b.readUInt16LE(pos+26),extra=b.readUInt16LE(pos+28);out.push(inflateRawSync(b.subarray(pos+30+len+extra,pos+30+len+extra+size)));pos+=30+len+extra+size;}return out;}

test('compiler selection is a private wrapper with original source paths',async()=>{
 const f=await fixture(),c=(await readCorpus(f.home,f.id))!;
 const before=await readFile(path.join(f.sourceRoot,'main.tex'));
 const hidden=changeCorpus(c.corpus,{action:'visibility',key:'second',visible:false});
 const wrapper=corpusCompileSource(hidden,path.join(f.sourceRoot,'main.tex'));
 assert.match(wrapper,/\\AtBeginDocument\{\\hideproject\{second\}\}/);
 assert.doesNotMatch(wrapper,/\\showproject/); // Preserve deliberate source-level hides.
 assert.ok(wrapper.includes(path.join(f.sourceRoot,'main.tex').replaceAll('\\','/')));
 assert.notEqual(wrapper,corpusCompileSource(c.corpus,path.join(f.sourceRoot,'main.tex')));
 assert.deepEqual(await readFile(path.join(f.sourceRoot,'main.tex')),before);
 assert.throws(()=>corpusCompileSource(hidden,'bad%path.tex'),/safely/);
});

test('audiences copy the current selection, persist independently, and reject stale saves',async()=>{
 const f=await fixture(),initial=(await readCorpus(f.home,f.id))!;
 const privateSelection=await saveCorpus(f.home,f.id,initial.revision,{action:'visibility',key:'second',visible:false});
 const other=await saveCorpus(f.home,f.id,privateSelection.revision,{action:'profile',profile:'collaborator',name:'A collaborator'});
 assert.deepEqual(other.corpus.profiles.collaborator.hidden,['second']);
 const show=await saveCorpus(f.home,f.id,other.revision,{action:'visibility',key:'second',visible:true});
 assert.deepEqual(show.corpus.profiles.all.hidden,['second']);assert.deepEqual(show.corpus.profiles.collaborator.hidden,[]);
 await assert.rejects(saveCorpus(f.home,f.id,other.revision,{action:'visibility',key:'first',visible:false}),/changed/);
 assert.throws(()=>changeCorpus(show.corpus,{action:'profile',profile:'__proto__'}),/audience name/);
 assert.equal((await registry(f.home)).projects.find(p=>p.id===f.id)?.manuscriptPins?.overview,'main.tex');
});

test('all reader bytes and PDF input omit hidden projects, links and summaries; master stays editable',async()=>{
 const f=await fixture(),before=await readFile(path.join(f.sourceRoot,'projects/second.tex'));
 const current=(await readCorpus(f.home,f.id))!;await saveCorpus(f.home,f.id,current.revision,{action:'visibility',key:'second',visible:false});
 const req=await request(f);
 for(const format of ['html','web','overview'] as const){
  const result=await collaboratorExport(f.home,{...req,format},async html=>Buffer.concat([Buffer.from('%PDF-TEST\n'),html]));
  const parts=format==='web'?unzip(result.data):[result.data];
  for(const bytes of parts)assert.doesNotMatch(bytes.toString(),/HIDDEN_PROJECT|hidden\.example|PRIVATE_LINK|projects\/second/);
  assert.ok(parts.some(bytes=>bytes.includes('Visible result')));
  if(format==='html')assert.doesNotMatch(result.data.toString(),/reader-contents|<h2>Document<\/h2>|Questions and model replies/);
 }
 assert.deepEqual(await readFile(path.join(f.sourceRoot,'projects/second.tex')),before);
 await assert.rejects(collaboratorExport(f.home,{...req,format:'zip'}),/selected summaries/);
 await assert.rejects(collaboratorExport(f.home,{...req,format:'html',includeSource:true}),/selected summaries/);
});

test('an audience change during a slow PDF render fences the export',async()=>{
 const f=await fixture(),req=await request(f);
 await assert.rejects(collaboratorExport(f.home,{...req,format:'overview'},async()=>{const c=(await readCorpus(f.home,f.id))!;await saveCorpus(f.home,f.id,c.revision,{action:'visibility',key:'second',visible:false});return Buffer.from('%PDF-test');}),/audience selection changed/);
});

test('an unlisted include is held rather than leaked through corpus sharing',async()=>{
 const f=await fixture();await writeFile(path.join(f.sourceRoot,'secret.tex'),'\\section{PRIVATE}Unlisted private material.');
 const main=path.join(f.sourceRoot,'main.tex');await writeFile(main,(await readFile(main,'utf8')).replace('\\end{document}','\\input{secret.tex}\n\\end{document}'));
 await assert.rejects(collaboratorExport(f.home,{...await request(f),format:'html'}),/unlisted source/);
});

test('a stale second window cannot export a different audience than the one it displayed',async()=>{
 const f=await fixture(),req=await request(f),c=(await readCorpus(f.home,f.id))!;
 await saveCorpus(f.home,f.id,c.revision,{action:'visibility',key:'second',visible:false});
 await assert.rejects(collaboratorExport(f.home,{...req,format:'html'}),/audience selection changed/);
 const current=await request(f);await assert.rejects(collaboratorExport(f.home,{...current,corpusRevision:undefined,format:'html'}),/not confirmed/);
});

test('run-in linked names and source hide/show work without changing summary text',async()=>{
 const f=await fixture(),main=path.join(f.sourceRoot,'main.tex'),before=await readFile(main,'utf8');
 let doc=await parseProject(f.home,f.id);assert.equal(doc.nodes.length,1);assert.match(doc.paragraphs[0].text,/^\\paragraph\{\\href/);
 const result=await collaboratorExport(f.home,{...await request(f),format:'html'});const html=result.data.toString();assert.match(html,/<strong><a[^>]+visible.example\/overview[^>]*>Visible result<\/a><\/strong>/);assert.doesNotMatch(html,/<h[1-6]>/);
 await writeFile(main,before.replace('\\begin{document}','\\hideproject{second}\n\\begin{document}'));doc=await parseProject(f.home,f.id);assert.ok(doc.paragraphs.every(p=>p.file!=='projects/second.tex'));
 await writeFile(main,before.replace('\\begin{document}','\\hideproject{second}\n\\showproject{second}\n\\begin{document}'));doc=await parseProject(f.home,f.id);assert.ok(doc.paragraphs.some(p=>p.file==='projects/second.tex'));
});
