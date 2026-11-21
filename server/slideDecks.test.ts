import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPaperProject} from './projectFiles.ts';
import {getProject,parseProject,registry,saveRegistry} from './projects.ts';
import {applySlideChoice,slideChoice,setSlideDeck,mergeSlideChoice,validateSlideChoice} from './slideDecks.ts';
import {canonical,syncHash} from './syncProtocol.ts';
import {createManuscriptVersion} from './manuscriptVersions.ts';
import {readNotebook} from './notebookStore.ts';

const deck='\\documentclass[aspectratio=169,14pt]{beamer}\n\\begin{document}\n\\begin{frame}{Start}A talk.\\end{frame}\n\\end{document}\n';
async function fixture(t:{after:(fn:()=>Promise<unknown>)=>void}){
 const home=await mkdtemp(path.join(tmpdir(),'aw-slides-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const upload=(path:string,text:string)=>({path,data:Buffer.from(text).toString('base64')});
 const p=await createPaperProject(home,'Slide trial',[upload('main.tex','\\documentclass{article}\n\\begin{document}Notes.\\end{document}'),upload('talk.tex',deck),upload('old-talk.tex',deck),upload('fake.tex','% \\documentclass{beamer}\n\\section{Not a deck}')]);
 return {home,id:p.id};
}
test('slide discovery and guarded pin keep source, root selection and writing roles intact',async t=>{
 const f=await fixture(t),doc=await parseProject(f.home,f.id),root=(await getProject(f.home,f.id)).root;
 assert.deepEqual(doc.slideFiles?.sort(),['old-talk.tex','talk.tex']);
 const source=await readFile(path.join(root,'talk.tex'),'utf8');
 const input={projectId:f.id,mainFile:doc.project.mainFile,revision:doc.revision,file:'talk.tex',expectedFile:''};
 const saved=await setSlideDeck(f.home,input);assert.equal(saved.document.project.slideDeck,'talk.tex');
 const p=(await getProject(f.home,f.id)).project;assert.equal(p.mainFile,doc.project.mainFile);assert.deepEqual(p.manuscriptPins,doc.project.manuscriptPins);assert.deepEqual(p.manuscriptPurposes,doc.project.manuscriptPurposes);assert.equal(await readFile(path.join(root,'talk.tex'),'utf8'),source);
 await assert.rejects(setSlideDeck(f.home,{...input,file:'old-talk.tex'}),/changed/);
 await assert.rejects(setSlideDeck(f.home,{...input,expectedFile:'talk.tex',file:'main.tex'}),/Beamer/);
 await assert.rejects(setSlideDeck(f.home,{...input,expectedFile:'talk.tex',revision:'0'.repeat(64)}),/changed/);
 await applySlideChoice(f.home,f.id,{version:1,file:null},syncHash(canonical(slideChoice(p))));assert.equal((await getProject(f.home,f.id)).project.slideDeck,undefined);
});
test('slide choices combine one-sided changes and preserve genuinely competing deck selections',()=>{
 const empty={version:1 as const,file:null},a={version:1 as const,file:'talk.tex'},b={version:1 as const,file:'other.tex'};
 assert.deepEqual(mergeSlideChoice(undefined,empty,a),a);assert.deepEqual(mergeSlideChoice(a,empty,a),empty);assert.deepEqual(mergeSlideChoice(empty,empty,a),a);
 assert.throws(()=>mergeSlideChoice(empty,a,b),/Conflicting/);assert.throws(()=>validateSlideChoice({...a,file:'../outside.tex'}),/Invalid/);
});
test('a new version of the current deck advances its pin and keeps the old deck',async t=>{
 const f=await fixture(t),r=await registry(f.home),p=r.projects.find(p=>p.id===f.id)!;p.mainFile='talk.tex';p.slideDeck='talk.tex';await saveRegistry(f.home,r);
 const doc=await parseProject(f.home,f.id),notes=await readNotebook(f.home,f.id);
 const result=await createManuscriptVersion(f.home,{projectId:f.id,mainFile:'talk.tex',revision:doc.revision,notebookRevision:notes.revision,file:'talk-v2.tex'});
 assert.equal(result.document.project.slideDeck,'talk-v2.tex');assert.equal((await getProject(f.home,f.id)).project.slideDeck,'talk-v2.tex');assert.ok(result.document.rootFiles.includes('talk.tex'));assert.ok(result.document.slideFiles?.includes('talk-v2.tex'));
});
