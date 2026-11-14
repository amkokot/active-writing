/** Comment transport is not revision authority, approval, or inferred resolution. */
import type { AttentionTask, WorkbenchStore, WorkbenchData } from "../src/types.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { canonical, syncHash } from "./syncProtocol.ts";
import { validateWorkbench } from "./workbenchStore.ts";

const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const comment = (t: AttentionTask) => t.review?.kind === "comment";
const ephemeral = ["updatedAt", "queuePosition", "queueOrderedAt", "queueHiddenAt", "deferredAt", "queueColorResetAt"];
const taskKeys = new Set(["id", "title", "nodeId", "paragraphId", "route", "status", "createdAt", "updatedAt", "sourceSnapshot", "review", ...ephemeral]);
const reviewKeys = new Set(["kind", "author", "body", "start", "end", "quote", "resolvedAt", "editedByHuman", "batchId", "externalId", "replyTo", "humanDecision"]);
/** The original capture is immutable; a return anchor is this editor's later
 * navigation hint, not a new quote, authored comment or synchronization edit. */
function originalCommentSnapshot(snapshot:AttentionTask['sourceSnapshot']) {
  if(!snapshot)return snapshot;
  const {returnAnchor:ignored,...original}=snapshot;
  return original;
}
export function commentContent(task: AttentionTask) {
  const value=Object.fromEntries(Object.entries(task).filter(([key]) => !ephemeral.includes(key)));
  if(task.sourceSnapshot)value.sourceSnapshot=originalCommentSnapshot(task.sourceSnapshot);
  return value;
}
export function localCommentPresentation(incoming:AttentionTask,current?:AttentionTask){
  const task=structuredClone(incoming) as any;
  for(const field of ephemeral.filter(k=>k!=='updatedAt')){delete task[field];if(current&&field in current)task[field]=(current as any)[field];}
  if(task.sourceSnapshot){
    delete task.sourceSnapshot.returnAnchor;
    if(current?.sourceSnapshot?.returnAnchor)task.sourceSnapshot.returnAnchor=structuredClone(current.sourceSnapshot.returnAnchor);
  }
  return task as AttentionTask;
}
export function normalizedReviewContent(store: WorkbenchData) {
  const value = structuredClone(store) as any;
  delete value.revision; delete value.queueLastActiveAt;
  value.attentionTasks = [...value.attentionTasks.filter((t:AttentionTask)=>!comment(t)),
    ...value.attentionTasks.filter(comment).map(commentContent).sort((a: any,b: any) => a.id.localeCompare(b.id))];
  return value;
}
function safe(task: AttentionTask, project: string, retainedLegacy=false) {
  if (!comment(task) || Object.keys(task).some(k => !taskKeys.has(k)) || Object.keys(task.review!).some(k => !reviewKeys.has(k))
    || task.sourceSnapshot?.projectId !== project) throw new Error("Comment contains unknown fields, a foreign anchor or runnable state");
  const review = task.review! as import("../src/types.ts").ReviewComment;
  if (task.status === "reviewed" && (review.humanDecision ? review.humanDecision.action !== "resolve" : !retainedLegacy)) throw new Error("Legacy/unattributed comment resolution needs explicit review");
}
function immutable(task: AttentionTask) {
  const r = task.review as import("../src/types.ts").ReviewComment;
  return { id:task.id,nodeId:task.nodeId,paragraphId:task.paragraphId,createdAt:task.createdAt,sourceSnapshot:originalCommentSnapshot(task.sourceSnapshot),
    author:r.author,start:r.start,end:r.end,quote:r.quote,replyTo:r.replyTo,batchId:r.batchId,externalId:r.externalId };
}
function protectedPart(store: WorkbenchStore) {
  const data = normalizedReviewContent(store);
  data.attentionTasks = data.attentionTasks.filter((t: AttentionTask) => !comment(t));
  return data;
}
export function mergeCommentStores(project: string, base: WorkbenchStore, local: WorkbenchStore, remote: WorkbenchStore, replyHistory: WorkbenchStore = base) {
  for (const store of [base,local,remote]) {
    validateWorkbench(store);
    if(store.version!==1 || !Number.isSafeInteger(store.revision) || store.revision<0)throw Error('Invalid review counters');
    if(Object.keys(store).some(k=>!['version','revision','queueLastActiveAt','attentionTasks','rewriteSessions','handoffDrafts','recoveredDrafts'].includes(k)))
      return {store:structuredClone(local),held:[{field:'metadata',reason:'Unknown review metadata is preserved; no comment-store replacement'}],changed:false};
  }
  const held: Array<{field:string;reason:string}> = [];
  if (!equal(protectedPart(remote),protectedPart(base)) && !equal(protectedPart(remote),protectedPart(local)))
    held.push({field:"protected",reason:"Non-comment review/request/wording/recovery state remains protected"});
  const result = structuredClone(local), maps = [base,local,remote].map(s => new Map(s.attentionTasks.map(t => [t.id,t])));
  const merged = new Map(result.attentionTasks.map(t => [t.id,t]));
  for (const id of new Set([...maps[0].keys(),...maps[1].keys(),...maps[2].keys()])) {
    const [b,l,r] = maps.map(m => m.get(id));
    if (![b,l,r].some(t => t && comment(t))) continue;
    const content = (t?:AttentionTask) => t ? commentContent(t) : undefined;
    if (equal(content(r),content(b)) || equal(content(r),content(l))) continue;
    try {
      if (!r || b && !l) throw new Error("Comment deletion/restoration requires explicit review");
      safe(r,project);
      if (l && !comment(l) || b && !comment(b)) throw new Error("Comment ID collides with a protected task");
      if (b && !equal(immutable(b),immutable(r))) throw new Error("Comment identity/quote/source anchor changed");
      if (!equal(content(l),content(b))) throw new Error("Concurrent edits to this comment need review; both variants are retained");
      // Preserve this host's queue presentation. Only explicit authored data crosses.
      const incoming = localCommentPresentation(r,l);
      merged.set(id,incoming);
    } catch (error) { held.push({field:id,reason:(error as Error).message}); }
  }
  result.attentionTasks = [...merged.values()].filter(t=>!comment(t)).concat([...merged.values()].filter(comment).sort((a,b)=>a.id.localeCompare(b.id)));
  const byId = new Map(result.attentionTasks.filter(comment).map(t=>[t.id,t]));
  const priorThreads = new Map(replyHistory.attentionTasks.filter(comment).map(t=>[t.id,t]));
  const unchangedIdentity = (task:AttentionTask) => {
    const prior=priorThreads.get(task.id);
    return prior && equal(immutable(prior),immutable(task));
  };
  for (const task of byId.values()) {
    let current = task; const seen = new Set<string>();
    while (current.review?.kind === "comment" && current.review.replyTo) {
      if (seen.has(current.id)) { held.push({field:task.id,reason:"Cyclic reply thread"}); break; }
      seen.add(current.id);
      const parent = byId.get(current.review.replyTo);
      // Old replies may capture a revised passage. Retain an already-known
      // edge without changing either original capture; never invent a new one.
      const retainedEdge=parent && unchangedIdentity(parent) && unchangedIdentity(current)
        && parent.sourceSnapshot?.projectId===project && current.sourceSnapshot?.projectId===project
        && parent.sourceSnapshot?.rootFile===current.sourceSnapshot?.rootFile;
      if (!parent || !equal(originalCommentSnapshot(parent.sourceSnapshot),originalCommentSnapshot(current.sourceSnapshot)) && !retainedEdge) { held.push({field:task.id,reason:"Reply parent is missing or its source identity differs"}); break; }
      current=parent;
    }
  }
  result.revision=local.revision+1;
  validateWorkbench(result);
  return {store:result,held,changed:!equal(normalizedReviewContent(result),normalizedReviewContent(local))};
}
export function blankReviewStore(): WorkbenchStore { return {version:1,revision:0,...emptyWorkbench()}; }

/** Lossless comment-only union. Deterministic copy IDs prevent reconnect storms
 * from duplicating the same variant again. Does not merge or approve source. */
export function unionCommentStores(project:string,left:WorkbenchStore,right:WorkbenchStore){
  const other=new Map(right.attentionTasks.map(task=>[task.id,task]));
  const retained={...blankReviewStore(),attentionTasks:left.attentionTasks.filter(task=>{
    const match=other.get(task.id);return match&&equal(commentContent(task),commentContent(match));
  })};
  const retainedIds=new Set(retained.attentionTasks.map(task=>task.id));
  // Authored body changes need not invalidate a thread's stable source IDs.
  // Both copies must already contain each historical identity.
  const sharedThreads={...blankReviewStore(),attentionTasks:left.attentionTasks.filter(task=>{
    const match=other.get(task.id);return match&&comment(task)&&comment(match)&&equal(immutable(task),immutable(match));
  })};
  for(const store of [left,right]){
    validateWorkbench(store);
    if(store.attentionTasks.some(t=>!comment(t))||store.rewriteSessions.length||Object.keys(store.handoffDrafts).length||store.recoveredDrafts.length)
      throw Error('Only comments can enter the comment union.');
    // Only an exact, already-present record on BOTH copies may retain an old
    // unmarked closure. No new closure, deletion or unknown field is imported.
    for(const task of store.attentionTasks)safe(task,project,retainedIds.has(task.id));
    const checked=mergeCommentStores(project,retained,retained,store,sharedThreads);
    if(checked.held.length)throw Error('Invalid/protected comment data: '+checked.held.map(h=>h.reason).join('; '));
  }
  const groups=new Map<string,AttentionTask[]>();
  for(const task of [...left.attentionTasks,...right.attentionTasks]){
    const values=groups.get(task.id)??[];
    if(!values.some(t=>equal(commentContent(t),commentContent(task))))values.push(task);
    groups.set(task.id,values);
  }
  const tasks=new Map<string,AttentionTask>();let duplicates=0;
  const contentHash=(task:AttentionTask)=>syncHash(canonical(commentContent(task)));
  const copyOf=(task:AttentionTask)=>({...structuredClone(task),id:'comment-copy-'+syncHash(canonical([task.id,commentContent(task)])),title:task.title.slice(0,99980)+' (other version)'});
  const put=(task:AttentionTask,depth=0):void=>{
    if(depth>32||tasks.size>=2000&&!tasks.has(task.id))throw Error('Comment copy budget reached; preserve both stores.');
    const prior=tasks.get(task.id);
    if(prior&&!equal(commentContent(prior),commentContent(task))){
      const values=[prior,task].sort((a,b)=>contentHash(a).localeCompare(contentHash(b)));
      tasks.set(task.id,structuredClone(values[0]));put(copyOf(values[1]),depth+1);duplicates++;return;
    }
    tasks.set(task.id,structuredClone(task));
  };
  // Original ID assignment is storage bookkeeping only; every authored variant
  // survives. No "best" wording or latest timestamp is chosen.
  for(const [,values] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    values.sort((a,b)=>syncHash(canonical(commentContent(a))).localeCompare(syncHash(canonical(commentContent(b)))));
    put(values[0]);
    for(const value of values.slice(1)){
      put(copyOf(value));duplicates++;
    }
  }
  const result={...blankReviewStore(),attentionTasks:[...tasks.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  const checked=mergeCommentStores(project,retained,retained,result,sharedThreads);
  if(checked.held.length)throw Error('Invalid/protected comment thread: '+checked.held.map(h=>h.reason).join('; '));
  return {store:result,duplicates};
}
