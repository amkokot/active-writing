param(
  [Parameter(Mandatory=$true)][string]$WorkspacePath,
  [Parameter(Mandatory=$true)][string]$ProjectId,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
if ($ProjectId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$') { throw 'Use an exact Aw project ID.' }
$watchTool = Join-Path $PSScriptRoot 'awSyncWatch.ts'
$runtimePath = (Get-Command node -ErrorAction Stop).Source
$hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$resolvedWorkspace|$ProjectId"))
$shortHash = ([BitConverter]::ToString($hashBytes)).Replace('-', '').Substring(0, 12)
$taskName = "Aw sync $shortHash"
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed scheduled sync task $taskName. Saved project work and sync history are unchanged."
  exit
}
$stateText = & $runtimePath $watchTool status --workspace $resolvedWorkspace --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'Could not read the pinned sync settings.' }
$state = ($stateText | ConvertFrom-Json)
if (-not $state.config.enabled) { throw 'Enable the exact project/peer with awSyncWatch.ts first.' }
if ($watchTool.Contains('"') -or $resolvedWorkspace.Contains('"')) { throw 'Unsupported quote in path.' }
# PowerShell's own Hidden switch hides too late to prevent a console flash.
# Enter through Windows Script Host's GUI executable, and wait for completion.
$hiddenLauncher = Join-Path $PSScriptRoot 'runSyncHidden.vbs'
if (-not (Test-Path -LiteralPath $hiddenLauncher)) { throw 'The windowless sync launcher is missing.' }
$logPath = Join-Path $resolvedWorkspace ".paperfocus/device-sync/auto/$ProjectId/launcher.log"
$quotePS = { param([string]$value) "'" + $value.Replace("'", "''") + "'" }
$workerCommand = if ($state.config.readingOnly) { 'live' } else { 'once' }
$commandText = '& ' + (& $quotePS $runtimePath) + ' ' + (& $quotePS $watchTool) + ' ' + $workerCommand + ' --workspace ' + (& $quotePS $resolvedWorkspace) + ' --project ' + (& $quotePS $ProjectId) + ' > ' + (& $quotePS $logPath) + ' 2>&1; exit $LASTEXITCODE'
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($commandText))
$powerShellPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$scriptHost = Join-Path $env:SystemRoot 'System32/wscript.exe'
$action = New-ScheduledTaskAction -Execute $scriptHost -Argument "//B //Nologo `"$hiddenLauncher`" `"$powerShellPath`" $encodedCommand `"$resolvedWorkspace`"" -WorkingDirectory $resolvedWorkspace
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3)
# No password, elevation, wake request, public listener or destructive timeout.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
if ($state.config.readingOnly) { $settings.DisallowStartIfOnBatteries = $false }
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Sync saved Aw research with one verified SSH peer. Conflicts/protected changes wait for review. Does not run experiments.' -Force | Select-Object TaskName, State
if ($state.config.readingOnly) { Write-Output 'Live reading sync: one resident windowless worker, file events and reconnect checks. The repeating trigger only recovers an exited worker. Allowed on battery; no wake request.' }
else { Write-Output 'Runs while signed in, with network and AC power.' }
Write-Output 'Laptop sleep/offline does not affect desktop research. Status: node scripts/awSyncWatch.ts status --workspace HOME --project ID'
