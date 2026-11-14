// Private SSH stdio only. No listener, source save, archive extraction or execution.
import {BlobReader,readBlobs,sendBlobs,validateBlobList} from '../server/syncBlobWire.ts';
import {syncStatus} from '../server/deviceSync.ts';
import {safeSyncId,validateSyncJson} from '../server/syncProtocol.ts';
const args=process.argv.slice(2);
try{
 if(args.length!==2||args[0]!=='--workspace')throw new Error('Use --workspace EXACT_HOME.');
 const home=args[1],reader=new BlobReader(process.stdin),header=JSON.parse(await reader.line());validateSyncJson(header);
 const device=(await syncStatus(home)).device;
 if(header.version!==1||!safeSyncId(header.projectId)||header.expectedDeviceId!==device?.id||!['read','write'].includes(header.action)||Object.keys(header).some(k=>!['version','projectId','expectedDeviceId','action','refs'].includes(k)))throw new Error('Bulk peer identity/scope mismatch.');
 validateBlobList(header.refs);
 if(header.action==='write'){await readBlobs(home,header.refs,reader);console.log(JSON.stringify({version:1,stored:header.refs.length,liveImport:false}));}
 else{await reader.end();await sendBlobs(home,header.refs,process.stdout);}
}catch(e){console.error((e as Error).message);process.exitCode=1;}
