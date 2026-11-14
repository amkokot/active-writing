// UI choices only: never installs, pairs, stops workers or executes research.
import path from 'node:path';
import {readOptionalTools,saveOptionalTools} from '../server/optionalTools.ts';
const args=process.argv.slice(2);
if(!args.length||args.includes('--help'))console.log('node scripts/awModules.mjs status|sync-on|sync-off --workspace HOME\nShows/hides two-computer tools. Existing jobs and data are preserved. Other optional integrations: docs/MODULES.md.');
else{
 const [action,flag,home]=args;
 if(args.length!==3||flag!=='--workspace'||!home||!['status','sync-on','sync-off'].includes(action))throw Error('Use --help for the exact optional-tool command.');
 const workspace=path.resolve(home),current=await readOptionalTools(workspace);
 console.log(JSON.stringify(action==='status'?current:await saveOptionalTools(workspace,current.revision,action==='sync-on'),null,2));
}
