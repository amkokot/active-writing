import path from 'node:path';
import {enrollJournalScope,setupPairedJournals} from '../server/syncJournalSetup.ts';
const args=process.argv.slice(2),command=args.shift();
if(!command||command==='--help')console.log(`Enroll a new paired project in both existing local change-journal daemons.
node scripts/awSyncJournalSetup.ts pair --workspace HOME --project ID --peer PEER_HASH
Repeat with --commit REVIEW_HASH after inspecting the preview.
Requires an already cloned/pinned Linux peer and one-time daemon installation on
both machines. Uses the campus/VPN gate. No research files are transferred, no
jobs started and no services restarted. New scopes activate within five seconds.
An interrupted enrollment is safe: preview again, then commit the fresh review.
The local command is for the pinned transport; it does not enable file sync.`);
else try{
 if(!['pair','local'].includes(command))throw Error('Use pair or --help.');
 const flags:Record<string,string>={};for(let n=0;n<args.length;n+=2){const name=args[n].slice(2),value=args[n+1];if(!args[n].startsWith('--')||!['workspace','project','commit',command==='pair'?'peer':'device'].includes(name)||flags[name]||!value||value.startsWith('--'))throw Error('Unknown/repeated/incomplete option.');flags[name]=value;}
 if(!flags.workspace||!flags.project||!flags[command==='pair'?'peer':'device'])throw Error('Use exact workspace, project and pinned peer/device.');
 if(flags.commit&&!/^[a-f0-9]{64}$/.test(flags.commit))throw Error('Use the exact preview hash.');
 const home=path.resolve(flags.workspace);console.log(JSON.stringify(command==='pair'
  ?await setupPairedJournals(home,flags.project,flags.peer,flags.commit)
  :await enrollJournalScope(home,flags.project,flags.device,flags.commit),null,2));
}catch(error){console.error((error as Error).message);process.exitCode=1;}
