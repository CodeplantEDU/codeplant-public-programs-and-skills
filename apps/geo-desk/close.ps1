param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'stop.ps1')
    if (!$Quiet) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show('GEO Desk is stopped. Saved settings and chats were kept.', 'GEO Desk', 'OK', 'Information') | Out-Null
    }
} catch {
    if (!$Quiet) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("GEO Desk could not stop.`n$($_.Exception.Message)", 'GEO Desk', 'OK', 'Error') | Out-Null
    }
    throw
}
