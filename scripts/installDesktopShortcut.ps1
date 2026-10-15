param([string]$DesktopPath, [string]$WorkspacePath)
$ErrorActionPreference = 'Stop'
$appDirectory = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$launcher = Join-Path $PSScriptRoot 'desktopLauncher.mjs'
$assetDirectory = Join-Path $appDirectory '.paperfocus\launcher'
if ($WorkspacePath) {
    if (-not (Test-Path -LiteralPath $WorkspacePath -PathType Container)) { throw 'Choose an existing research-data home.' }
    $WorkspacePath = (Resolve-Path -LiteralPath $WorkspacePath).Path
}
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null

if (-not $DesktopPath) {
    $DesktopPath = [Environment]::GetFolderPath('DesktopDirectory')
    if (-not $DesktopPath -or -not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
        $registeredDesktop = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -Name Desktop).Desktop
        $DesktopPath = [Environment]::ExpandEnvironmentVariables($registeredDesktop)
    }
}
if (-not $DesktopPath -or -not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
    throw 'Desktop folder could not be found. Supply -DesktopPath with your actual Desktop folder.'
}
$DesktopPath = (Resolve-Path -LiteralPath $DesktopPath).Path
$shortcutPath = Join-Path $DesktopPath 'Active Writing.lnk'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if (-not $existing.Arguments.Contains($launcher)) {
        throw "A different shortcut already exists at $shortcutPath. It was left unchanged."
    }
}

# A locally drawn icon: no downloaded art, account access or extra dependencies.
Add-Type -AssemblyName System.Drawing
$iconPath = Join-Path $assetDirectory 'active-writing.ico'
$frames = @()
foreach ($size in @(32, 48, 256)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
    $edge = [single]($size * 0.06)
    $width = [single]($size * 0.88)
    $radius = [single]($size * 0.22)
    $shape.AddArc($edge, $edge, $radius, $radius, 180, 90)
    $shape.AddArc($edge + $width - $radius, $edge, $radius, $radius, 270, 90)
    $shape.AddArc($edge + $width - $radius, $edge + $width - $radius, $radius, $radius, 0, 90)
    $shape.AddArc($edge, $edge + $width - $radius, $radius, $radius, 90, 90)
    $shape.CloseFigure()
    $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 43, 42))
    $foreground = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 245, 236))
    $graphics.FillPath($background, $shape)
    $font = New-Object System.Drawing.Font('Segoe UI', ([single]($size * 0.38)), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rectangle = New-Object System.Drawing.RectangleF(0, ([single](-$size * 0.015)), $size, $size)
    $graphics.DrawString('Aw', $font, $foreground, $rectangle, $format)
    $buffer = New-Object System.IO.MemoryStream
    $bitmap.Save($buffer, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames += @{ Size = $size; Bytes = $buffer.ToArray() }
    $buffer.Dispose(); $format.Dispose(); $font.Dispose(); $foreground.Dispose(); $background.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$stream = [System.IO.File]::Create($iconPath)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $stream.Dispose() }

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$quotedNode = $nodeExecutable.Replace("'", "''")
$quotedLauncher = $launcher.Replace("'", "''")
$workspaceArgument = if ($WorkspacePath) { " --workspace '" + $WorkspacePath.Replace("'", "''") + "'" } else { '' }
$shortcut.Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"& '$quotedNode' '$quotedLauncher'$workspaceArgument`""
$shortcut.WorkingDirectory = $appDirectory
$shortcut.Description = 'Active Writing - write, think, and revise'
$shortcut.IconLocation = "$iconPath,0"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output "Created $shortcutPath"
