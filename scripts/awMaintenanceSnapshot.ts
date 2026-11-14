// Explicit saved-state capture only: no SSH, source edits, or model call.
import {writeFile} from 'node:fs/promises';
import {autoSyncStatus} from '../server/syncAuto.ts';
import {getProject} from '../server/projects.ts';
const args=process.argv.slice(2),flags:Record<string,string>={};
if(args.includes('--help'))console.log('node scripts/awMaintenanceSnapshot.ts --workspace HOME --project ID --output NEW.json\nSaved sync evidence only. Transfer the bounded incident to the desktop maintenance runner explicitly.');
else{
 for(let i=0;i<args.length;i+=2){const k=args[i].slice(2);if(!args[i].startsWith('--')||!['workspace','project','output'].includes(k)||flags[k]||!args[i+1])throw Error('Use explicit workspace/project/output');flags[k]=args[i+1];}
 if(!flags.workspace||!flags.project||!flags.output)throw Error('Use explicit workspace/project/output');
 await getProject(flags.workspace,flags.project);
 const saved=await autoSyncStatus(flags.workspace,flags.project),s=saved.state;
 if(!s)throw Error('No saved sync observation; do not invent an incident');
 const statuses=['held','error','offline','following','aligned','busy'];
 const status=statuses.includes(s.status)?s.status:'busy';
 await writeFile(flags.output,JSON.stringify({version:1,projectId:flags.project,observedAt:s.checkedAt,status,detail:(s.detail??'').slice(0,6000)},null,2),{flag:'wx'});
 console.log(JSON.stringify({file:flags.output,projectId:flags.project,status,networkContacted:false}));
}
