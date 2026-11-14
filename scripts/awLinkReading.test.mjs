import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLink,linkOptions} from './awLinkReading.mjs';
import {syncHash} from '../server/syncProtocol.ts';
test('reading setup binds approved host, desktop owner and exact baseline bytes',()=>{
 const bytes=Buffer.from('baseline'),s={projectId:'project',device:{id:'desktop'},id:'snapshot',ancestors:[],records:[]};
 const p={version:1,sshAlias:'approved',projectId:s.projectId,desktopDeviceId:'desktop',snapshotId:'snapshot',packetSha256:syncHash(bytes),packetBytes:bytes.length,desktopWorkspace:'/data/p',remoteTool:'/installed/scripts/awSync.ts',mainFile:'main.tex',rawArraysIncluded:false};
 assert.equal(checkLink(p,s,bytes,'approved').workspace,'/data/p');
 for(const change of [{sshAlias:'different'},{projectId:'other'},{desktopDeviceId:'other'},{packetSha256:'0'.repeat(64)},{packetBytes:99},{rawArraysIncluded:true},{remoteTool:'relative'},{desktopWorkspace:'/data\ncommand'}])assert.throws(()=>checkLink({...p,...change},s,bytes,'approved'));
 assert.throws(()=>checkLink(p,{...s,ancestors:['missing']},bytes,'approved'));
 assert.throws(()=>checkLink(p,{...s,records:[{external:true}]},bytes,'approved'));
});
test('setup commit requires exact review and explicit scopes',()=>{
 const args=['--workspace','control','--packet','p','--link-plan','l','--destination','new','--host','approved'];
 assert.equal(linkOptions(args).host,'approved');
 assert.throws(()=>linkOptions([...args,'--commit']));
 assert.throws(()=>linkOptions([...args,'--review','hash']));
 assert.throws(()=>linkOptions([...args,'--host','other']));
 assert.throws(()=>linkOptions([...args,'--run-code','yes']));
 assert.equal(linkOptions([...args,'--review','hash','--commit']).commit,true);
});
