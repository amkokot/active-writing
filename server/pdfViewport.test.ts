import test from 'node:test';import assert from 'node:assert/strict';
import {initialPdfSizes,pdfPageLayout,pdfPageIndex,nearbyPdfPages,retainedPdfPages,pdfWorkQueue} from '../src/pdfViewport.ts';

test('large PDF pages paint one at a time while continuations remain responsive',async()=>{
 const q=pdfWorkQueue(),events:string[]=[];
 let release!:()=>void,started!:()=>void,continued!:()=>void,finished!:()=>void;
 const hold=new Promise<void>(r=>{release=r;}),first=new Promise<void>(r=>{started=r;}),chunk=new Promise<void>(r=>{continued=r;}),last=new Promise<void>(r=>{finished=r;});
 q.paint(async()=>{events.push('first');started();await hold;events.push('first done');});
 const cancel=q.paint(async()=>{events.push('canceled');});cancel();
 q.paint(async()=>{events.push('second');finished();});
 await first;
 q.schedule(()=>{events.push('continuation');continued();});await chunk;
 assert.deepEqual(events,['first','continuation']);release();await last;
 assert.deepEqual(events,['first','continuation','first done','second']);q.dispose();
});
test('a thousand-page PDF opens at its resume page with only one metadata request',async()=>{
 const calls:number[]=[];const s=await initialPdfSizes(Array.from({length:1000},(_,i)=>i+1),720,async p=>{calls.push(p);return {width:600,height:800};});assert.deepEqual(calls,[720]);assert.equal(s.length,1000);assert.equal(s[719].page,720);
});

test('recent PDF surfaces survive backscroll without retaining every page or unbounded bitmaps',()=>{
 const layout=pdfPageLayout(Array.from({length:1000},(_,i)=>({page:i+1,width:600,height:800})),1);
 let retained:number[]=[];
 for(let page=1;page<1000;page++)retained=retainedPdfPages(retained,new Set([page]),layout,1,2);
 assert.equal(retained.length,8);assert.deepEqual(retained.slice(0,3),[999,998,997]);
 const back=retainedPdfPages(retained,new Set([998]),layout,1,2);assert.ok(back.includes(999));assert.ok(back.includes(997));
 const huge=pdfPageLayout(Array.from({length:20},(_,i)=>({page:i+1,width:2000,height:2000})),1);
 assert.equal(retainedPdfPages([1,2,3,4,5],new Set([6]),huge,1,2).length,2);
});

test('PDF paint continuations yield and wait for scrolling to stop; canceled work never runs',()=>{
 let now=0,serial=0;const timers=new Map<number,{fn:()=>void;at:number}>();
 const queue=pdfWorkQueue({now:()=>now,set:(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;},clear:id=>{timers.delete(id as number);}});
 const advance=(ms:number)=>{const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
 const ran:string[]=[];queue.schedule(()=>ran.push('paint'));const cancel=queue.schedule(()=>ran.push('unmounted'));cancel();queue.pause();
 advance(100);queue.pause();advance(139);assert.deepEqual(ran,[]);advance(1);assert.deepEqual(ran,['paint']);
 queue.schedule(()=>{ran.push('chunk');queue.schedule(()=>ran.push('next chunk'));});advance(8);assert.equal(ran.at(-1),'chunk');advance(8);assert.equal(ran.at(-1),'next chunk');
 queue.schedule(()=>ran.push('disposed'));queue.dispose();advance(1000);assert.equal(ran.at(-1),'next chunk');assert.equal(timers.size,0);
});
test('mixed page sizes and page gaps preserve positions and bound the canvas window',()=>{
 const sizes=[{page:1,width:600,height:800},{page:2,width:800,height:450},{page:3,width:600,height:900}],l=pdfPageLayout(sizes,2);
 assert.equal(l[1].top,1618);assert.equal(pdfPageIndex(l,1605),1);assert.equal(pdfPageIndex(l,1700),1);assert.equal(pdfPageIndex(l,9000),2);
 const long=pdfPageLayout(Array.from({length:1000},(_,i)=>({page:i+1,width:600,height:800})),1);const near=nearbyPdfPages(long,long[719].top+20,600);assert.deepEqual([...near],[719,720,721]);
});
