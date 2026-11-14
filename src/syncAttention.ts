export interface SyncHealth {
  config?: {enabled:boolean;pauseReason?:string};
  state?: {status:string;detail?:string;failures?:number;syncId?:string;maintenance?:{phase:string;detail?:string;updatedAt:string}};
  locks?: {project?:{status:string};coordinator?:{status:string}};
}
/** Read-only display window, never a merge or source-range write target. */
export function syncSourceComparison(local:string,remote:string){
  const a=local.split('\n'),b=remote.split('\n');let first=0,lastA=a.length,lastB=b.length;
  while(first<lastA&&first<lastB&&a[first]===b[first])first++;
  while(lastA>first&&lastB>first&&a[lastA-1]===b[lastB-1]){lastA--;lastB--;}
  const start=Math.max(0,first-3),endA=Math.min(a.length,lastA+3),endB=Math.min(b.length,lastB+3);
  return {local:a.slice(start,endA).join('\n'),remote:b.slice(start,endB).join('\n'),firstLine:start+1,localLastLine:endA,remoteLastLine:endB,excerpt:start>0||endA<a.length||endB<b.length};
}
export function syncAttention(health:SyncHealth,pending:Array<{id:string}>=[]){
  if(health.locks?.project?.status==='active')return;
  const state=health.state;
  let detail:string|undefined,title='Sync needs attention';
  if([health.locks?.project,health.locks?.coordinator].some(lock=>['owner-missing','invalid'].includes(lock?.status??'')))detail='A sync coordinator stopped unexpectedly. Its saved lock needs inspection; your work is kept.';
  else if(health.config?.enabled===false&&health.config.pauseReason)detail=health.config.pauseReason;
  else if(pending.length||state?.status==='interrupted')detail='A transfer was interrupted. Inspect the saved operation before resuming it.';
  else if(state?.status==='held')detail='Some changes need review before both copies can sync.';
  else if(state?.status==='unavailable'&&(/budget|limit|linked|symlink|checksum|identity|invalid|history|storage/i.test(state.detail??'')||(state.failures??0)>=3))detail=state.detail??'Sync has failed repeatedly. Check its saved details.';
  if(!detail)return;
  const repair=state?.maintenance;
  if(repair&&['queued','working','waiting','deployed'].includes(repair.phase)&&Date.now()-Date.parse(repair.updatedAt)<(repair.phase==='waiting'?24*60:15)*60000){
    return {key:JSON.stringify(['maintenance',repair.phase,state?.syncId]),title:repair.phase==='waiting'?'Maintenance waiting for compute':repair.phase==='deployed'?'Repair applied · checking sync':'Maintenance in progress',detail:repair.detail??'The desktop worker is checking this issue. You can continue working.',severity:'working' as const};
  }
  if(health.config?.enabled===false)title='Sync paused · needs attention';
  return {key:JSON.stringify([title,detail,state?.syncId??pending[0]?.id??'']),title:repair?'Needs attention':title,detail:repair?.detail??detail,severity:'attention' as const};
}
