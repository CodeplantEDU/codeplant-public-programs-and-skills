#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$BackupPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated Administrator PowerShell window.'
}

$statePath = Join-Path $BackupPath 'state-before.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    throw "Backup state not found: $statePath"
}

$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$terminalServerPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
$rdpTcpPath = Join-Path $terminalServerPath 'WinStations\RDP-Tcp'
$policyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'

Set-ItemProperty -Path $terminalServerPath -Name fDenyTSConnections -Value ([int]$state.RdpDenied)
Set-ItemProperty -Path $rdpTcpPath -Name UserAuthentication -Value ([int]$state.NlaUserAuthentication)

if (-not (Test-Path $policyPath)) {
    New-Item -Path $policyPath -Force | Out-Null
}
foreach ($policy in $state.Policies) {
    if ($policy.Existed) {
        New-ItemProperty -Path $policyPath -Name $policy.Name -PropertyType DWord -Value ([int]$policy.Value) -Force | Out-Null
    }
    else {
        Remove-ItemProperty -Path $policyPath -Name $policy.Name -ErrorAction SilentlyContinue
    }
}

foreach ($ruleState in $state.Firewall) {
    Set-NetFirewallRule -Name $ruleState.Name -Enabled $ruleState.Enabled
}

Set-Service -Name TermService -StartupType $state.TermServiceStartType
if ($state.TermServiceStatus -eq 'Running') {
    Start-Service -Name TermService
}
else {
    Stop-Service -Name TermService -Force -ErrorAction SilentlyContinue
}

& gpupdate.exe /target:computer /force | Out-Null

[pscustomobject]@{
    RestoredFrom = [System.IO.Path]::GetFullPath($BackupPath)
    RdpDenied = [int](Get-ItemPropertyValue -Path $terminalServerPath -Name fDenyTSConnections)
    NlaUserAuthentication = [int](Get-ItemPropertyValue -Path $rdpTcpPath -Name UserAuthentication)
    TermService = (Get-Service -Name TermService).Status.ToString()
    Result = 'RESTORE_COMPLETE'
}
