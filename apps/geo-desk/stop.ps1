$ErrorActionPreference = 'Stop'
$taskPidFile = Join-Path $PSScriptRoot 'data\server.pid'
if (!(Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No GEO Desk PID file found.'; return }
$taskPid = [int](Get-Content -LiteralPath $taskPidFile)
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid"
if (!$taskProcess) {
    Remove-Item -LiteralPath $taskPidFile
    Write-Host 'GEO Desk is already stopped.'
    return
}
$taskExpected = Join-Path $PSScriptRoot 'server.py'
$taskPattern = '(?:^|\s)"?' + [regex]::Escape($taskExpected) + '"?(?=\s|$)'
if (!$taskProcess.CommandLine -or $taskProcess.Name -notmatch '^python(?:w|[0-9.]*)?\.exe$' -or $taskProcess.CommandLine -notmatch $taskPattern) {
    throw 'PID does not match this GEO Desk server. No process was stopped.'
}
Stop-Process -Id $taskPid -ErrorAction Stop
Remove-Item -LiteralPath $taskPidFile
Write-Host "GEO Desk stopped (PID $taskPid). Saved data was preserved."
