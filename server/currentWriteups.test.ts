import test from 'node:test';
import assert from 'node:assert/strict';
import {newExperimentNotebook,newExperimentCell} from '../src/experiments.ts';
import {parseWriteups,replaceWriteups,writeupCellId,hasWriteupList,professorWriteups,pinProfessorReport} from '../src/currentWriteups.ts';
const source=JSON.stringify({version:1,items:[{id:'candidate',person:'A researcher',title:'Current idea',file:'notes.tex',related:[{title:'Evidence',file:'evidence.tex'}]}]});
test('current writeups require distinct explicit project-local TeX targets',()=>{
 assert.equal(parseWriteups(source).items[0].file,'notes.tex');
 for(const file of ['../private.tex','https://host/paper.tex','C:\\private.tex','notes.html','folder//note.tex'])assert.throws(()=>parseWriteups(source.replace('notes.tex',file)));
 const duplicate=JSON.parse(source);duplicate.items.push({...duplicate.items[0]});assert.throws(()=>parseWriteups(JSON.stringify(duplicate)));
});
test('reading-list saves retain evidence, order and metadata and refuse stale source',()=>{
 const n=newExperimentNotebook(),c=newExperimentCell('raw'),e=newExperimentCell('code');c.id=writeupCellId;c.source=source;e.source='print(1)';e.outputs=[{output_type:'stream',name:'stdout',text:'1'}];n.cells=[e,c];const before=JSON.stringify(n),next=replaceWriteups(n,source,source.replace('notes.tex','new.tex'));
 assert.equal(JSON.stringify(n),before);assert.deepEqual(next.cells[0],e);assert.deepEqual(next.cells.map(c=>c.id),n.cells.map(c=>c.id));assert.throws(()=>replaceWriteups(n,'stale',source),/changed/);
});
test('an existing navigation cell can be reused without new cells or changed IDs',()=>{
 const n=newExperimentNotebook(),c=newExperimentCell('markdown');c.id='existing-index';c.source=source;n.cells=[c];const next=replaceWriteups(n,source,source.replace('notes.tex','current.tex'),c.id);
 assert.equal(next.cells.length,1);assert.equal(next.cells[0].id,c.id);assert.equal(next.cells[0].cell_type,'markdown');
 assert.equal(hasWriteupList({folder:'Renamed folder',readingListCellId:c.id}),true);
 assert.equal(hasWriteupList({readingListCellId:c.id,recoveryKey:'old-copy'}),false);
});

test('professor shelves sort dated reports, deduplicate files and retain per-professor pins',()=>{
 const list=parseWriteups(JSON.stringify({version:1,items:[
  {id:'a',person:'A',title:'Old main',file:'old.tex',updatedAt:'2026-01-01',related:[{title:'New report',file:'new.tex',updatedAt:'2026-11-24'},{title:'Old duplicate',file:'old.tex'}]},
  {id:'b',person:'B',title:'Other',file:'new.tex',updatedAt:'2026-02-01'}]}));
 assert.deepEqual(professorWriteups(list)[0].reports.map(r=>r.file),['new.tex','old.tex']);
 const next=pinProfessorReport(list,'A','new.tex',true);
 assert.equal(professorWriteups(next)[0].reports[0].pinned,true);
 assert.ok(!professorWriteups(next)[1].reports[0].pinned);
 assert.ok(!professorWriteups(list)[0].reports[0].pinned);
 assert.equal(professorWriteups(pinProfessorReport(next,'A','new.tex',false))[0].reports[0].pinned,false);
});
test('large existing report histories remain readable with validated dates and pins',()=>{
 const list=JSON.parse(source);list.items[0].related=Array.from({length:32},(_,i)=>({title:'Report '+i,file:'report'+i+'.tex'}));
 assert.equal(parseWriteups(JSON.stringify(list)).items[0].related?.length,32);
 for(const extra of [{updatedAt:'yesterday'},{pinned:'yes'}])assert.throws(()=>parseWriteups(JSON.stringify({...list,items:[{...list.items[0],...extra}]})));
});
