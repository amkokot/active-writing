import test from 'node:test';
import assert from 'node:assert/strict';
import {newExperimentCell} from '../src/experiments.ts';
import {cellFolder,notebookFolders,notebookCellMatches,withinNotebookFolder} from '../src/notebookFolders.ts';
function cell(folder:string,title:string,text=''){const c=newExperimentCell('markdown');c.metadata.paperfocus={folder,title};c.source=text;return c;}
test('notebook folders count descendants, preserve cells and distinguish similarly named paths',()=>{
 const cells=[cell('Solomon / Resampling','One'),cell('Solomon / Geometry','Two'),cell('Solomon2','Three'),cell('Start here','Index')],before=JSON.stringify(cells),tree=notebookFolders(cells);
 assert.equal(tree[0].path,'Start here');assert.equal(tree.find(n=>n.path==='Solomon')?.count,2);assert.equal(tree.find(n=>n.path==='Solomon')?.children.length,2);assert.equal(cellFolder(cells[0]),'Solomon/Resampling');assert.equal(withinNotebookFolder('Solomon2','Solomon'),false);assert.equal(JSON.stringify(cells),before);
});
test('folder search finds titles and note text without altering saved visibility or execution',()=>{
 const c=cell('Jaakkola/Calibration','Rare response','The nonlinear cost remains unresolved.');c.metadata.paperfocus!.filed=true;
 assert.equal(notebookCellMatches(c,'Jaakkola','nonlinear RARE'),true);assert.equal(notebookCellMatches(c,'Jaakkola','solved missing'),false);assert.equal(notebookCellMatches(c,'Solomon',''),false);assert.equal(c.metadata.paperfocus?.filed,true);
});
