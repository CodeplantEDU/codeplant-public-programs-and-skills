param([int]$Port = 8766)
$ErrorActionPreference = 'Stop'
$taskPython = (Get-Command python).Source
$taskRoot = $PSScriptRoot
$taskData = Join-Path $taskRoot 'data'
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskExisting = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
if ($taskExisting) {
    try {
        $taskResponse = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -TimeoutSec 3
        if ($taskResponse.Headers['Server'] -like 'GEODesk*') { Write-Host "GEO Desk is already running: http://localhost:$Port"; exit }
    } catch { }
    throw "Port $Port is used by another application. Use -Port with a free port."
}
$taskProcess = Start-Process -FilePath $taskPython -ArgumentList @('-u', ('"' + (Join-Path $taskRoot 'server.py') + '"'), '--port', $Port) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'error.log') -PassThru
$taskProcess.Id | Set-Content (Join-Path $taskData 'server.pid')
Write-Host "GEO Desk started (PID $($taskProcess.Id)): http://localhost:$Port"
