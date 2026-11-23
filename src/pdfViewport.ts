export const pdfPageGap=18;
export interface PdfPageSize {page:number;width:number;height:number}
/** One page establishes the scrollbar immediately. Nearby pages refine their
 * own dimensions when loaded; a long PDF must not require N getPage calls. */
export async function initialPdfSizes(pages:number[],initial:number,load:(page:number)=>Promise<{width:number;height:number}>){
 if(!pages.length)return [];
 const first=pages.includes(initial)?initial:pages[0],size=await load(first);
 if(!(size.width>0&&size.height>0))throw Error('Invalid PDF page size.');
 return pages.map(page=>({page,width:size.width,height:size.height}));
}
export function pdfPageLayout(sizes:PdfPageSize[],scale:number){let top=0;return sizes.map(s=>{const row={...s,top,bottom:top+s.height*scale};top=row.bottom+pdfPageGap;return row;});}
export type PdfPageLayout=ReturnType<typeof pdfPageLayout>;
/** First page whose bottom is below the reading line, including mixed sizes. */
export function pdfPageIndex(layout:PdfPageLayout,y:number){let lo=0,hi=layout.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(layout[mid].bottom>y)hi=mid;else lo=mid+1;}return Math.max(0,lo);}
export function nearbyPdfPages(layout:PdfPageLayout,top:number,height:number){
 if(!layout.length)return new Set<number>();
 const start=Math.max(0,pdfPageIndex(layout,top)-1),end=Math.min(layout.length-1,pdfPageIndex(layout,top+height)+1);
 return new Set(layout.slice(start,end+1).map(s=>s.page));
}

/** Keep recent raster/text surfaces alive for backscroll, with a fixed memory
 * budget. Required viewport pages win; selected text is retained separately. */
export function retainedPdfPages(previous:number[],required:Set<number>,layout:PdfPageLayout,scale:number,pixelRatio:number){
 const sizes=new Map(layout.map(p=>[p.page,p]));
 const ordered=[...required,...previous.filter(p=>!required.has(p)&&sizes.has(p))];
 let pixels=0;
 return ordered.filter((page,index)=>{
  const size=sizes.get(page);if(!size)return false;
  const cost=Math.min(8_000_000,size.width*size.height*scale*scale*Math.min(pixelRatio,2)**2);
  if(!required.has(page)&&(index>=8||pixels+cost>20_000_000))return false;
  pixels+=cost;return true;
 });
}

/** PDF.js paints on the UI thread. Yield between its operator chunks and keep
 * new raster/text work out of an active scroll gesture. No worker or polling. */
export function pdfWorkQueue(clock:{now:()=>number;set:(fn:()=>void,ms:number)=>unknown;clear:(id:unknown)=>void}={now:()=>performance.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id as ReturnType<typeof setTimeout>)}){
 const pending=new Set<()=>void>();let timer:unknown,until=0,disposed=false;
 const paints=new Set<()=>Promise<void>>();let painting=false;
 const startPaint=()=>{if(disposed||painting)return;const next=paints.values().next().value;if(!next)return;paints.delete(next);painting=true;void Promise.resolve().then(next).catch(()=>{}).finally(()=>{painting=false;if(!disposed)schedule(startPaint);});};
 const arm=()=>{if(disposed||timer!==undefined||!pending.size)return;timer=clock.set(()=>{timer=undefined;if(clock.now()<until){arm();return;}const next=pending.values().next().value;if(next){pending.delete(next);next();}arm();},Math.max(8,until-clock.now()));};
 const schedule=(work:()=>void)=>{if(disposed)return ()=>{};pending.add(work);arm();return ()=>{pending.delete(work);};};
 return {
  schedule,
  // Serialize whole page paints, while their PDF.js continuations can still
  // yield through schedule(). A long page must not start eight parallel paints.
  paint(work:()=>Promise<void>){if(disposed)return ()=>{};paints.add(work);schedule(startPaint);return ()=>{paints.delete(work);};},
  pause(){until=clock.now()+140;if(timer!==undefined){clock.clear(timer);timer=undefined;}arm();},
  dispose(){disposed=true;pending.clear();paints.clear();if(timer!==undefined)clock.clear(timer);timer=undefined;},
 };
}
