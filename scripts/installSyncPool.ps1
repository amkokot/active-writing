param([Parameter(Mandatory=$true)][string]$WorkspacePath,[Parameter(Mandatory=$true)][string]$ExistingLiveProject)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $WorkspacePath).Path
if($ExistingLiveProject -notmatch '^[A-Za-z0-9_-]{1,100}(,[A-Za-z0-9_-]{1,100}){0,31}$'){throw 'Use exact existing live project IDs separated by commas.'}
$runtime=(Get-Command node).Source
$quote={param([string]$v) "'"+$v.Replace("'","''")+"'"}
$tool=Join-Path $PSScriptRoot 'awSyncPool.ts'
$log=Join-Path $root '.paperfocus/device-sync/auto/live-pool.log'
$command='& '+(& $quote $runtime)+' '+(& $quote $tool)+' --workspace '+(& $quote $root)+' --exclude '+(& $quote $ExistingLiveProject)+' > '+(& $quote $log)+' 2>&1; exit $LASTEXITCODE'
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$launcher=Join-Path $PSScriptRoot 'runSyncHidden.vbs'
$ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$wscript=Join-Path $env:SystemRoot 'System32/wscript.exe'
$action=New-ScheduledTaskAction -Execute $wscript -Argument "//B //Nologo `"$launcher`" `"$ps`" $encoded `"$root`"" -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$settings.DisallowStartIfOnBatteries=$false
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Aw fast reading pool' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName 'Aw fast reading pool'
