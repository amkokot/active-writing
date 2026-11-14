import test from 'node:test';
import assert from 'node:assert/strict';
import {readingOptions,readingPort} from './readingWorkspaceLauncher.mjs';
test('reading launch refuses extra scope and command options',()=>{
 for(const args of [[],['--workspace'],['--workspace','--no-browser'],['--workspace','x','--port','4173'],['--workspace','x','--dangerously-skip-permissions']])assert.throws(()=>readingOptions(args));
 assert.equal(readingOptions(['--workspace','x','--no-browser']).browser,false);
});
test('reading home has stable separate loopback port',()=>{
 const n=readingPort('example-home');assert.equal(n,readingPort('example-home'));assert(n>=4300&&n<5000);assert.notEqual(n,4173);
});
