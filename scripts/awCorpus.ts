// Server-independent audience selection; never publishes or changes other projects.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createResearchCorpus,readCorpus,saveCorpus} from '../server/researchCorpus.ts';
import {parseProject} from '../server/projects.ts';
import {readNotebook} from '../server/notebookStore.ts';

export async function corpusCommand(argv:string[]){
 const [command,...args]=argv;
 if(!command||command==='--help')return `Aw research list — offline, no uploads
create --workspace HOME --file SEED.json
list --workspace HOME --project ID
hide|show --workspace HOME --project ID --key PROJECT_KEY
audience --workspace HOME --project ID --key AUDIENCE_ID [--name NAME]
export --workspace HOME --project ID --format pdf|html|web --output NEW_FILE
Run with node scripts/awCorpus.ts COMMAND. A new audience copies the current selection.
Hide/show affects only that audience's new sharing copies. Source and other projects remain available.
Already shared files/hosted pages require a deliberate new export/deployment; no link is revoked.
The master source ZIP contains all summaries. Share through this command or Share list.`;
 const flags:Record<string,string>={};for(let i=0;i<args.length;i+=2){const k=args[i].replace(/^--/,'');if(!args[i].startsWith('--')||!['workspace','project','file','key','name','format','output'].includes(k)||flags[k]||!args[i+1])throw Error('Use --help for options.');flags[k]=args[i+1];}
 if(!flags.workspace)throw Error('Confirm --workspace.');const home=path.resolve(flags.workspace);
 if(command==='create'){if(!flags.file)throw Error('Provide --file.');return createResearchCorpus(home,JSON.parse(await readFile(flags.file,'utf8')));}
 if(!flags.project)throw Error('Confirm --project.');const current=await readCorpus(home,flags.project);if(!current)throw Error('This is not a research-list project.');
 if(command==='list')return current;
 if(command==='hide'||command==='show')return saveCorpus(home,flags.project,current.revision,{action:'visibility',key:flags.key,visible:command==='show'});
 if(command==='audience')return saveCorpus(home,flags.project,current.revision,{action:'profile',profile:flags.key,name:flags.name});
 if(command==='export'){
  if(!flags.output||!['pdf','html','web'].includes(flags.format))throw Error('Choose --format pdf|html|web and a new --output file.');
  const doc=await parseProject(home,flags.project),notebook=await readNotebook(home,flags.project),{collaboratorExport}=await import('../server/collaboratorExport.ts');
  const result=await collaboratorExport(home,{projectId:flags.project,mainFile:doc.project.mainFile,revision:doc.revision,notebookRevision:notebook.revision,corpusRevision:current.revision,format:flags.format==='pdf'?'overview':flags.format as 'html'|'web',overviewFile:current.corpus.mainFile,includeNotebook:false,includeSource:false});
  await writeFile(flags.output,result.data,{flag:'wx'});return {file:path.resolve(flags.output),format:result.extension,audience:current.corpus.activeProfile,published:false};
 }
 throw Error('Unknown research-list command. Use --help.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))corpusCommand(process.argv.slice(2)).then(value=>console.log(typeof value==='string'?value:JSON.stringify(value,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
