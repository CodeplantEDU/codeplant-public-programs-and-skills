param([ValidateRange(1, 65535)][int]$Port = 8766)
$ErrorActionPreference = 'Stop'
$taskPython = (Get-Command python).Source
$taskRoot = $PSScriptRoot
$taskData = Join-Path $taskRoot 'data'
$taskPidFile = Join-Path $taskData 'server.pid'
$taskScript = Join-Path $taskRoot 'server.py'
$taskScriptPattern = '(?:^|\s)"?' + [regex]::Escape($taskScript) + '"?(?=\s|$)'
New-Item -ItemType Directory -Path $taskData -Force | Out-Null

function Test-GeoListener([int]$ListenerPort, [int]$ListenerPid) {
    # netstat is available without the CIM access that hardened accounts may lack.
    $taskListenerPattern = '^\s*TCP\s+\S+:' + $ListenerPort + '\s+\S+\s+LISTENING\s+' + $ListenerPid + '\s*$'
    return [bool](netstat -ano -p TCP | Select-String -Pattern $taskListenerPattern -Quiet)
}

# Identify this checkout before accepting a server already on the requested port.
try {
    $taskResponse = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 2
    if ($taskResponse.Headers['Server'] -like 'GEODesk*' -and (Test-Path -LiteralPath $taskPidFile)) {
        $taskRecordedPid = [int](Get-Content -LiteralPath $taskPidFile)
        $taskExisting = Get-CimInstance Win32_Process -Filter "ProcessId = $taskRecordedPid"
        if ($taskExisting -and $taskExisting.CommandLine -match $taskScriptPattern) {
            if (Test-GeoListener $Port $taskRecordedPid) {
                Write-Host "GEO Desk is already running: http://localhost:$Port"
                return
            }
        }
    }
    throw "Port $Port is used by another application or GEO Desk checkout. Use -Port with a free port."
} catch {
    if ($_.Exception.Message -like 'Port * is used*') { throw }
}

$taskOriginalData = [Environment]::GetEnvironmentVariable('GEO_DATA_DIR', 'Process')
try {
    [Environment]::SetEnvironmentVariable('GEO_DATA_DIR', $taskData, 'Process')
    $taskProcess = Start-Process -FilePath $taskPython -ArgumentList @('-u', ('"' + $taskScript + '"'), '--port', $Port) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'error.log') -PassThru
} finally {
    [Environment]::SetEnvironmentVariable('GEO_DATA_DIR', $taskOriginalData, 'Process')
}
$taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
while ([DateTime]::UtcNow -lt $taskDeadline) {
    $taskProcess.Refresh()
    if ($taskProcess.HasExited) { throw "GEO Desk could not start. Check $(Join-Path $taskData 'error.log')." }
    try {
        $taskResponse = Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 1
        if ($taskResponse.Headers['Server'] -like 'GEODesk*' -and (Test-GeoListener $Port $taskProcess.Id)) {
            $taskProcess.Id | Set-Content -LiteralPath $taskPidFile
            Write-Host "GEO Desk started (PID $($taskProcess.Id)): http://localhost:$Port"
            return
        }
    } catch { }
    Start-Sleep -Milliseconds 200
}
if (!$taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue }
throw "GEO Desk did not become ready. Check $(Join-Path $taskData 'error.log')."
