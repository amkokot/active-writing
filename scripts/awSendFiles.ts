// Manual file inbox bridge; no app server or automatic upload watcher required.
import {desktopInboxStatus,startInboxTransfer} from '../server/desktopInbox.ts';
import {setTimeout} from 'node:timers/promises';
const [command,flag,home,...extra]=process.argv.slice(2);
if(command==='--help')console.log('Aw file inbox (explicit send only)\nnode scripts/awSendFiles.ts status --workspace AW_HOME\nnode scripts/awSendFiles.ts send --workspace AW_HOME\nUses the approved private inbox settings and campus/VPN gate. Verified files leave the inbox for local Sent recovery. No experiment or transferred code runs.');
else try{
 if(!['status','send'].includes(command)||flag!=='--workspace'||!home||extra.length)throw Error('Use status|send --workspace AW_HOME');
 const state=await desktopInboxStatus(home);
 if(command==='status')console.log(JSON.stringify(state,null,2));
 else{
  if(!state.configured)throw Error('Desktop inbox is not configured.');
  const job=await startInboxTransfer(home,state.configHash!);console.log(JSON.stringify(job));
  for(;;){await setTimeout(1500);const latest=await desktopInboxStatus(home);if(!latest.configured||latest.job?.id!==job.id)throw Error('Another transfer replaced the displayed status; inspect saved receipts.');if(latest.job.status!=='sending'){console.log(JSON.stringify(latest,null,2));if(latest.job.status!=='complete')process.exitCode=1;break;}}
 }
}catch(e){console.error((e as Error).message);process.exitCode=1;}
