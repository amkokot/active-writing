param(
 [Parameter(Mandatory=$true)][string]$WorkspacePath,
 [Parameter(Mandatory=$true)][string]$Name
)
$ErrorActionPreference='Stop'
$readingHome=(Resolve-Path -LiteralPath $WorkspacePath).Path
$codeHome=Split-Path -Parent $PSScriptRoot
$nodePath=(Get-Command node -ErrorAction Stop).Source
$toolPath=Join-Path $PSScriptRoot 'readingWorkspaceLauncher.mjs'
$folder=Join-Path $readingHome '.paperfocus/launcher'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$vbsPath=Join-Path $folder 'open-reading.vbs'
$command='"'+$nodePath+'" "'+$toolPath+'" --workspace "'+$readingHome+'"'
$vbs='CreateObject("WScript.Shell").Run "'+$command.Replace('"','""')+'", 0, False'+[Environment]::NewLine
if(Test-Path -LiteralPath $vbsPath){if((Get-Content -LiteralPath $vbsPath -Raw) -ne $vbs){throw 'Different existing shortcut launcher preserved.'}}
else{[IO.File]::WriteAllText($vbsPath,$vbs)}
$title=[regex]::Replace($Name,'[<>:"/\\|?*\x00-\x1f]','-').Trim()
if(-not $title -or $title.Length -gt 85){throw 'Use a short readable shortcut name.'}
$desktopFolder=[Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath=Join-Path $desktopFolder ('Aw - '+$title+'.lnk')
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
$targetPath=Join-Path $env:SystemRoot 'System32/wscript.exe'
$arguments='//B //Nologo "'+$vbsPath+'"'
if((Test-Path -LiteralPath $shortcutPath) -and ($shortcut.TargetPath -ne $targetPath -or $shortcut.Arguments -ne $arguments)){throw 'Different existing shortcut preserved.'}
$shortcut.TargetPath=$targetPath
$shortcut.Arguments=$arguments
$shortcut.WorkingDirectory=$codeHome
$shortcut.Description='Open this Active Writing reading copy; saved comments sync with the desktop.'
$shortcut.IconLocation=Join-Path $codeHome '.paperfocus/launcher/active-writing.ico'
$shortcut.Save()
Write-Output $shortcutPath
