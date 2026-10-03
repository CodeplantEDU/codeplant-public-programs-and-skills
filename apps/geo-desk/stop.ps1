$ErrorActionPreference = 'Stop'
$taskPidFile = Join-Path $PSScriptRoot 'data\server.pid'
if (!(Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No GEO Desk PID file found.'; exit }
$taskPid = [int](Get-Content -LiteralPath $taskPidFile)
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid"
if (!$taskProcess) { Write-Host 'GEO Desk is already stopped.'; exit }
$taskExpected = Join-Path $PSScriptRoot 'server.py'
if (!$taskProcess.CommandLine -or $taskProcess.CommandLine.IndexOf($taskExpected, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'PID does not match this GEO Desk server. No process was stopped.'
}
Stop-Process -Id $taskPid -ErrorAction Stop
Write-Host "GEO Desk stopped (PID $taskPid). Saved data was preserved."
