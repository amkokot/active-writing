import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCorpusPdf,printedCorpusPages,corpusReadingCss} from './corpusPresentation.ts';
test('one-page single-column copy is kept without a second print',async()=>{
 const calls:string[]=[];const r=await renderCorpusPdf(n=>Buffer.from(String(n)),async b=>{calls.push(b.toString());return Buffer.from('%PDF-1.7\n<</Type /Pages /Count 1 /Kids [4 0 R]>>');});
 assert.equal(r.columns,1);assert.deepEqual(calls,['1']);
});
test('overflow tries two columns; an unknown page tree never claims a single-page fit',async()=>{
 for(const first of ['%PDF-1.7 <</Type /Pages /Count 2>>','unknown PDF format']){
  const calls:string[]=[];const r=await renderCorpusPdf(n=>Buffer.from(String(n)),async b=>{calls.push(b.toString());return Buffer.from(calls.length===1?first:'%PDF-1.7 <</Type /Pages /Count 1>>');});
  assert.equal(r.columns,2);assert.deepEqual(calls,['1','2']);
 }
 assert.equal(printedCorpusPages(Buffer.from('<</Type /Pages /Count 1>><</Type /Pages /Count 3>>')),3);
});
test('linked titles have their own color and short lists retain one column in print',()=>{
 assert.match(corpusReadingCss,/strong:first-child a[^}]+color:#24628d/);
 assert.match(corpusReadingCss,/@media print\{main\.corpus-single\{column-count:1/);
});
test('five or more projects force two columns and skip the single-column print',async()=>{
 for(const count of [5,10]){const calls:string[]=[];const r=await renderCorpusPdf(n=>Buffer.from(String(n)),async b=>{calls.push(b.toString());return Buffer.from('%PDF-1.7 <</Type /Pages /Count 1>>');},count);assert.equal(r.columns,2);assert.deepEqual(calls,['2']);}
 const r=await renderCorpusPdf(n=>Buffer.from(String(n)),async()=>Buffer.from('%PDF-1.7 <</Type /Pages /Count 1>>'),4);assert.equal(r.columns,1);
});
