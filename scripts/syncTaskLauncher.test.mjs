import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('multi-project reader shares one process, staggers connections and leaves slow transfers to existing workers',()=>{
 const pool=readFileSync(new URL('./awSyncPool.ts',import.meta.url),'utf8');
 const installer=readFileSync(new URL('./installSyncPool.ps1',import.meta.url),'utf8');
 assert.match(pool,/\{fastOnly:true\}/);assert.match(pool,/setTimeout\(resolve,400\)/);assert.match(pool,/excluded\.has\(item.name\)/);assert.match(pool,/new Set\(args\[3\]\.split\(','\)\)/);
 assert.doesNotMatch(pool,/spawn\(/);assert.match(installer,/MultipleInstances IgnoreNew/);assert.match(installer,/System32\/wscript.exe/);
});

test('scheduled sync enters through a windowless host and retains cycle ownership', () => {
  const installer = readFileSync(new URL('./installSyncTask.ps1', import.meta.url), 'utf8');
  const launcher = readFileSync(new URL('./runSyncHidden.vbs', import.meta.url), 'utf8');
  assert.match(installer, /System32\/wscript\.exe/);
  assert.match(installer, /New-ScheduledTaskAction -Execute \$scriptHost/);
  assert.match(installer, /\/\/B \/\/Nologo/);
  assert.match(installer, /launcher\.log/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /-DontStopIfGoingOnBatteries/);
  assert.match(launcher, /shell\.Run\(command, 0, True\)/);
  assert.match(launcher, /WScript\.Quit result/);
  assert.match(launcher, /shell\.CurrentDirectory = args\(2\)/);
});

test('windowless host waits for PowerShell and forwards a nonzero exit code', { skip: process.platform !== 'win32' }, () => {
  const system = path.join(process.env.SystemRoot, 'System32');
  const result = spawnSync(path.join(system, 'wscript.exe'), [
    '//B', '//Nologo', fileURLToPath(new URL('./runSyncHidden.vbs', import.meta.url)),
    path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
    Buffer.from('exit 7', 'utf16le').toString('base64'), process.cwd(),
  ], { windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 7, result.stderr?.toString());
});

test('standalone sync workers yield CPU without reprioritizing the app service', () => {
  const worker = readFileSync(new URL('./awSyncWatch.ts', import.meta.url), 'utf8');
  const cycle = readFileSync(new URL('../server/syncAuto.ts', import.meta.url), 'utf8');
  assert.match(worker, /if\(command==='once'\|\|command==='watch'\|\|command==='live'\)try\{setPriority\(0,osConstants.priority.PRIORITY_BELOW_NORMAL\)/);
  assert.doesNotMatch(cycle, /setPriority\(/);
});

test('reading pairs use one resident hidden worker with crash recovery and can catch up on battery', () => {
  const installer = readFileSync(new URL('./installSyncTask.ps1', import.meta.url), 'utf8');
  assert.match(installer, /if \(\$state.config.readingOnly\)/);
  assert.match(installer, /\$workerCommand = if \(\$state.config.readingOnly\) \{ 'live' \} else \{ 'once' \}/);
  assert.match(installer, /-RepetitionInterval \(New-TimeSpan -Minutes 3\)/);
  assert.doesNotMatch(installer, /MSFT_TaskEventTrigger/);
  assert.match(installer, /\$settings.DisallowStartIfOnBatteries = \$false/);
  assert.match(installer, /-Trigger \$trigger/);
  assert.doesNotMatch(installer, /-WakeToRun/);
});
