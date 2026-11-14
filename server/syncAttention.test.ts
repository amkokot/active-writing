import test from 'node:test';
import assert from 'node:assert/strict';
import {syncAttention,syncSourceComparison} from '../src/syncAttention.ts';
import {readFile} from 'node:fs/promises';
test('maintenance progress is quiet while fresh and red when escalated or stale',()=>{
 const health={state:{status:'held',maintenance:{phase:'working',updatedAt:new Date().toISOString()}}};
 assert.equal(syncAttention(health)?.severity,'working');
 health.state.maintenance.phase='attention';assert.equal(syncAttention(health)?.severity,'attention');
 health.state.maintenance.phase='working';health.state.maintenance.updatedAt='2020-01-01T00:00:00Z';assert.equal(syncAttention(health)?.severity,'attention');
});

test('source comparison opens around the changed lines rather than the top of a long manuscript',()=>{
 const before=Array.from({length:100},(_,n)=>'Line '+n).join('\n'),after=before.replace('Line 70','Changed explanation');
 const view=syncSourceComparison(before,after);assert.equal(view.firstLine,68);assert.equal(view.excerpt,true);assert.match(view.remote,/Changed explanation/);assert.doesNotMatch(view.remote,/Line 0\n/);assert.match(view.local,/Line 70/);
});
test('sync attention distinguishes manual intervention from ordinary waiting or an active cycle',()=>{
 for(const status of ['synced','aligned','disabled','waiting-network','busy','staged'])assert.equal(syncAttention({state:{status}}),undefined);
 assert.equal(syncAttention({state:{status:'unavailable',detail:'SSH temporarily unavailable',failures:1}}),undefined);
 assert.equal(syncAttention({state:{status:'unavailable',detail:'SSH exchange timed out. Staged/checkpoint files are retained; nothing was retried or executed.',failures:1}}),undefined);
 assert.ok(syncAttention({state:{status:'unavailable',detail:'Bulk transfer exceeds budget',failures:1}}));
 assert.ok(syncAttention({state:{status:'unavailable',failures:3}}));
 assert.ok(syncAttention({state:{status:'held'}}));
 assert.ok(syncAttention({},[{id:'exact-interrupted-sync'}]));
 assert.ok(syncAttention({locks:{coordinator:{status:'owner-missing'}}}));
 assert.equal(syncAttention({locks:{project:{status:'active'}},state:{status:'held'}}),undefined);
 assert.match(syncAttention({config:{enabled:false},state:{status:'held'}})!.title,/paused/);
 assert.equal(syncAttention({config:{enabled:false,pauseReason:'Review two conflicting edits.'}})!.detail,'Review two conflicting edits.');
 assert.equal(syncAttention({state:{status:'held'}})!.key,syncAttention({state:{status:'held'}})!.key);
});
test('notice polls only compact local status and opens review without replaying sync',async()=>{
 const source=await readFile('src/components/SyncAttentionNotice.tsx','utf8');
 assert.match(source,/device-sync\/attention/);assert.match(source,/30000/);assert.match(source,/document.hidden/);assert.match(source,/sessionStorage/);
 assert.doesNotMatch(source,/sync-commit|sync-preview|window\.location|autoFocus/);
 assert.match(source,/onClick=\{onReview\}/);
 assert.match(source,/createPortal/);assert.match(source,/document\.body/);
 assert.match(source,/Compare revisions/);assert.match(source,/source-review/);assert.match(source,/Save any unfinished edits/);assert.match(source,/choice\}\)/);assert.doesNotMatch(source,/force.*merge|approve.*publication/);
});
