/** Server-independent comment review: inspect and append proposals, never resolve. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readWorkbench, writeWorkbench } from "../server/workbenchStore.ts";
import { getProject, parseProject } from "../server/projects.ts";
import { reviewCommentTarget, makeReviewCommentReply } from "../src/review.ts";
import { manuscriptWritingPolicy, manuscriptPurpose } from "../src/manuscripts.ts";
import { canonical } from "../server/syncProtocol.ts";

export async function reviewCommand(argv:string[]) {
  if(!argv.length || argv.includes('--help'))return 'Aw comments, offline; no server, models or source changes.\nnode scripts/awReview.ts list --workspace HOME --project ID [--manuscript ROOT.tex] [--all]\nnode scripts/awReview.ts inspect --workspace HOME --project ID --comment ID\nnode scripts/awReview.ts reply --workspace HOME --project ID --comment ID --revision REV --file BODY.txt [--commit]\nReplies preview by default, append once and leave the thread open. Read project guidance/current writing policy before revision. No resolve, source-edit, task execution or approval command.';
  const [command,...args]=argv,flags:Record<string,string>={};
  if(!['list','inspect','reply'].includes(command))throw Error('Use list, inspect or reply');
  for(let i=0;i<args.length;i++){
    const key=args[i].slice(2);
    if(!args[i].startsWith('--') || !['workspace','project','manuscript','all','comment','revision','file','commit'].includes(key) || key in flags)throw Error('Unknown/repeated option');
    if(['all','commit'].includes(key))flags[key]='true';
    else {if(!args[i+1] || args[i+1].startsWith('--'))throw Error('Missing option value');flags[key]=args[++i];}
  }
  if(!flags.workspace || !flags.project)throw Error('Confirm --workspace and --project');
  if(command==='list' && ['comment','revision','file','commit'].some(k=>flags[k]) || command==='inspect' && ['manuscript','all','revision','file','commit'].some(k=>flags[k]) || command==='reply' && ['all','manuscript'].some(k=>flags[k]))throw Error('Option does not apply to this command');
  const project=await getProject(flags.workspace,flags.project);
  const store=await readWorkbench(flags.workspace,flags.project),comments=store.attentionTasks.filter(t=>t.review?.kind==='comment');
  if(command==='reply'){
    if(!flags.comment || !flags.file || !/^(0|[1-9]\d*)$/.test(flags.revision??''))throw Error('Reply needs exact --comment, --revision and --file');
    const parent=comments.find(t=>t.id===flags.comment);
    if(!parent)throw Error('Comment not found; no task inferred');
    const bytes=await readFile(flags.file); if(bytes.length>24000)throw Error('Reply is too large');
    const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
    const id='review-reply-'+createHash('sha256').update(canonical({project:flags.project,parent:parent.id,body})).digest('hex').slice(0,32);
    const existing=store.attentionTasks.find(t=>t.id===id);
    if(existing){if(existing.review?.kind!=='comment' || existing.review.body!==body || existing.review.replyTo!==parent.id || existing.review.author!=='assistant')throw Error('Reply identity collision; preserved');return {saved:true,alreadySaved:true,revision:store.revision,replyId:id,sourceChanged:false,commentResolved:false};}
    if(store.revision!==Number(flags.revision))throw Error('Review changed: inspect new comments before replying; do not force the revision');
    const reply=makeReviewCommentReply(parent,body);reply.id=id;
    if(reply.review?.kind==='comment')reply.review.author='assistant';
    if(!flags.commit)return {planned:true,replyId:id,revision:store.revision,body,commentResolved:false,sourceChanged:false};
    const result=await writeWorkbench(flags.workspace,flags.project,store.revision,{...store,attentionTasks:[...store.attentionTasks,reply]});
    return {saved:true,alreadySaved:false,revision:result.revision,replyId:id,sourceChanged:false,commentResolved:false};
  }
  if(command==='inspect' && !flags.comment)throw Error('Provide --comment ID');
  const selected=command==='inspect'?comments.filter(t=>t.id===flags.comment):comments.filter(t=>(flags.all || t.status!=='reviewed') && (!flags.manuscript || t.sourceSnapshot?.rootFile===flags.manuscript));
  if(command==='inspect' && !selected.length)throw Error('Comment not found');
  const docs=new Map<string,Awaited<ReturnType<typeof parseProject>>|undefined>(),errors=new Map<string,string>();
  const rows=[];
  for(const task of selected.slice(0,100)){
    const root=task.sourceSnapshot!.rootFile;
    if(!docs.has(root)){try{docs.set(root,await parseProject(flags.workspace,flags.project,false,root));}catch(error){docs.set(root,undefined);errors.set(root,(error as Error).message);}}
    const doc=docs.get(root),target=doc?reviewCommentTarget(task,doc):undefined,review=task.review!;
    if(review.kind!=='comment')continue;
    rows.push({id:task.id,root,currentSourceRevision:doc?.revision,policy:manuscriptWritingPolicy(manuscriptPurpose(project.project,root)),author:review.author,body:review.body,quote:review.quote,
      replyTo:review.replyTo,status:task.status==='reviewed'?'resolved':'open',currentTarget:target??null,
      sourceSnapshot:command==='inspect'?task.sourceSnapshot:undefined,
      sourceError:errors.get(root),note:target?'Exact quoted range is still available; scope/locks still apply.':'Source changed or anchor unavailable: inspect current text, do not apply stale offsets.'});
  }
  return {projectId:flags.project,revision:store.revision,comments:rows,total:selected.length,truncated:selected.length>100,
    next:'Read current source, not just the comment snapshot. Recheck its revision before applying a revision; if it changed while drafting, reread and preserve new human wording. A reply/comment arrival alone does not acknowledge source sync. Reply with a brief change summary or remaining concern; leave comments open for human review.',serverRequired:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await reviewCommand(process.argv.slice(2));console.log(typeof result==='string'?result:JSON.stringify(result,null,2));}
  catch(error){console.error((error as Error).message);process.exitCode=1;}
}
