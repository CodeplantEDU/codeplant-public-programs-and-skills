param([ValidateRange(1, 65535)][int]$Port = 8766, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'start.ps1') -Port $Port
    if (!$NoBrowser) { Start-Process "http://localhost:$Port/" }
} catch {
    if (!$NoBrowser) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("GEO Desk could not start.`n$($_.Exception.Message)", 'GEO Desk', 'OK', 'Error') | Out-Null
    }
    throw
}
