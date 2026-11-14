/** At most four independent reads; preserve order and settle before any error. */
export async function boundedSyncReads<T,R>(items:readonly T[],read:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 const result=new Array<R>(items.length);let cursor=0,failed=false,failure:unknown;
 await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{
  while(!failed&&cursor<items.length){const index=cursor++;try{result[index]=await read(items[index],index);}catch(error){if(!failed){failed=true;failure=error;}}}
 }));
 if(failed)throw failure;return result;
}
