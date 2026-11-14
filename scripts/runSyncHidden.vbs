Option Explicit
' GUI-subsystem entry point: no console is created before PowerShell can hide it.
Dim args, shell, command, result
Set args = WScript.Arguments
If args.Count <> 3 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = args(2)
command = Chr(34) & args(0) & Chr(34) & " -NoProfile -NonInteractive -EncodedCommand " & args(1)
' Wait so Task Scheduler retains ownership and IgnoreNew covers the whole cycle.
result = shell.Run(command, 0, True)
WScript.Quit result
