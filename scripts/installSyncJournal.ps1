param([Parameter(Mandatory=$true)][string]$WorkspacePath,[Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $WorkspacePath).Path
$config=(Resolve-Path -LiteralPath $ConfigPath).Path
$runtime=(Get-Command node).Source
$quote={param([string]$v) "'"+$v.Replace("'","''")+"'"}
$tool=Join-Path $PSScriptRoot 'awSyncJournal.ts'
$log=Join-Path (Split-Path -Parent $config) 'journal.log'
$command='& '+(& $quote $runtime)+' '+(& $quote $tool)+' start --config '+(& $quote $config)+' > '+(& $quote $log)+' 2>&1; exit $LASTEXITCODE'
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$launcher=Join-Path $PSScriptRoot 'runSyncHidden.vbs'
$ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$action=New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/wscript.exe') -Argument "//B //Nologo `"$launcher`" `"$ps`" $encoded `"$root`"" -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3)
# Must watch offline edits too. No network condition, no wake, no elevated rights.
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$settings.DisallowStartIfOnBatteries=$false
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Aw local change journal' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName 'Aw local change journal'
