param([Parameter(Mandatory=$true)][string]$ConfigPath, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$configFile = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json
if ($config.version -ne 1 -or $config.enabled -ne $true) { throw 'Enable and validate the scoped reading-inbox configuration first.' }
$homePath = (Resolve-Path -LiteralPath $config.workspace).Path
$toolPath = Join-Path $PSScriptRoot 'awReadingLink.mjs'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($homePath))
$taskName = 'Aw reading inbox ' + ([BitConverter]::ToString($hashBytes)).Replace('-', '').Substring(0,12)
if ($Remove) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; exit }
& $nodePath $toolPath status --config $configFile
if ($LASTEXITCODE -ne 0) { throw 'Inbox configuration did not validate.' }
$quotePS = { param([string]$value) "'" + $value.Replace("'", "''") + "'" }
$logPath = Join-Path $homePath '.paperfocus/device-sync/reading-inbox/launcher.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
$commandText = '& ' + (& $quotePS $nodePath) + ' ' + (& $quotePS $toolPath) + ' once --config ' + (& $quotePS $configFile) + ' > ' + (& $quotePS $logPath) + ' 2>&1; exit $LASTEXITCODE'
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($commandText))
$hostPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
$powershellPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$launcher = Join-Path $PSScriptRoot 'runSyncHidden.vbs'
$action = New-ScheduledTaskAction -Execute $hostPath -Argument "//B //Nologo `"$launcher`" `"$powershellPath`" $encoded `"$homePath`"" -WorkingDirectory $homePath
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$settings.DisallowStartIfOnBatteries = $false
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Collect explicitly queued Aw reading copies through the existing campus/VPN gate. One bounded pass; exits when idle. Never executes research.' -Force | Select-Object TaskName,State
