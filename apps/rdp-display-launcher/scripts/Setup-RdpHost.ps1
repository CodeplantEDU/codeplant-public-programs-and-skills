#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$BackupRoot = 'C:\RDP-Setup-Backup',
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$terminalServerPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
$rdpTcpPath = Join-Path $terminalServerPath 'WinStations\RDP-Tcp'
$policyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
$admxPath = Join-Path $env:WINDIR 'PolicyDefinitions\TerminalServer.admx'
$firewallRuleNames = @(
    'RemoteDesktop-UserMode-In-TCP',
    'RemoteDesktop-UserMode-In-UDP'
)
$policyNames = @(
    'bEnumerateHWBeforeSW',
    'AVCHardwareEncodePreferred',
    'AVC444ModePreferred'
)

$operatingSystem = Get-CimInstance Win32_OperatingSystem
if ($operatingSystem.Caption -match '\bHome\b') {
    throw "Unsupported Windows edition: $($operatingSystem.Caption). Native RDP hosting requires Pro, Enterprise, or Education."
}

if (-not (Test-Path -LiteralPath $admxPath -PathType Leaf)) {
    throw "Terminal Services ADMX definition was not found: $admxPath"
}
$admx = Get-Content -LiteralPath $admxPath -Raw -Encoding UTF8
foreach ($name in $policyNames) {
    if ($admx -notmatch ("valueName\s*=\s*`"{0}`"" -f [regex]::Escape($name))) {
        throw "Installed ADMX does not define the expected policy value '$name'. No changes were made."
    }
}

$firewallRules = foreach ($name in $firewallRuleNames) {
    Get-NetFirewallRule -Name $name -ErrorAction Stop
}

$validation = [pscustomobject]@{
    Windows = $operatingSystem.Caption
    Version = $operatingSystem.Version
    Build = $operatingSystem.BuildNumber
    Admx = $admxPath
    PoliciesConfirmed = @($policyNames)
    FirewallRulesConfirmed = @($firewallRules.Name)
    Ready = $true
}
if ($ValidateOnly) {
    $validation
    return
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated Administrator PowerShell window.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

& reg.exe export 'HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server' (Join-Path $backupPath 'TerminalServer.reg') /y | Out-Null
if (Test-Path $policyPath) {
    & reg.exe export 'HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' (Join-Path $backupPath 'TerminalServicesPolicy.reg') /y | Out-Null
}

$policyState = foreach ($name in $policyNames) {
    $item = Get-ItemProperty -Path $policyPath -Name $name -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Name = $name
        Existed = $null -ne $item
        Value = if ($null -ne $item) { [int]$item.$name } else { $null }
    }
}
$firewallState = foreach ($rule in $firewallRules) {
    [pscustomobject]@{
        Name = $rule.Name
        Enabled = $rule.Enabled.ToString()
    }
}
$service = Get-Service -Name TermService
$state = [pscustomobject]@{
    CapturedAt = (Get-Date).ToString('o')
    RdpDenied = [int](Get-ItemPropertyValue -Path $terminalServerPath -Name fDenyTSConnections)
    NlaUserAuthentication = [int](Get-ItemPropertyValue -Path $rdpTcpPath -Name UserAuthentication)
    TermServiceStatus = $service.Status.ToString()
    TermServiceStartType = $service.StartType.ToString()
    Policies = @($policyState)
    Firewall = @($firewallState)
}
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backupPath 'state-before.json') -Encoding UTF8

$inventory = [pscustomobject]@{
    Windows = $operatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture
    GPU = @(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM)
    Network = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {
        [pscustomobject]@{
            InterfaceAlias = $_.InterfaceAlias
            Description = $_.NetAdapter.InterfaceDescription
            IPv4 = @($_.IPv4Address.IPAddress)
        }
    })
}
$inventory | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backupPath 'inventory-before.json') -Encoding UTF8

$restoreSource = Join-Path $PSScriptRoot 'Restore-RdpHost.ps1'
if (-not (Test-Path -LiteralPath $restoreSource -PathType Leaf)) {
    throw "Restore script not found: $restoreSource"
}
Copy-Item -LiteralPath $restoreSource -Destination (Join-Path $backupPath 'Restore-RdpHost.ps1') -Force

Set-ItemProperty -Path $terminalServerPath -Name fDenyTSConnections -Value 0
Set-ItemProperty -Path $rdpTcpPath -Name UserAuthentication -Value 1
if (-not (Test-Path $policyPath)) {
    New-Item -Path $policyPath -Force | Out-Null
}
foreach ($name in $policyNames) {
    New-ItemProperty -Path $policyPath -Name $name -PropertyType DWord -Value 1 -Force | Out-Null
}

Enable-NetFirewallRule -Name $firewallRuleNames
Start-Service -Name TermService
& gpupdate.exe /target:computer /force | Out-Null

$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$tailscaleAddress = if ($tailscale) { @(& $tailscale.Source ip -4 2>$null) } else { @() }

[pscustomobject]@{
    BackupPath = $backupPath
    RestoreScript = (Join-Path $backupPath 'Restore-RdpHost.ps1')
    RdpEnabled = 0 -eq [int](Get-ItemPropertyValue -Path $terminalServerPath -Name fDenyTSConnections)
    NlaEnabled = 1 -eq [int](Get-ItemPropertyValue -Path $rdpTcpPath -Name UserAuthentication)
    TermService = (Get-Service -Name TermService).Status.ToString()
    Firewall = @(Get-NetFirewallRule -Name $firewallRuleNames | Select-Object Name,Enabled)
    Policies = @($policyNames | ForEach-Object {
        [pscustomobject]@{ Name = $_; Value = Get-ItemPropertyValue -Path $policyPath -Name $_ }
    })
    TailscaleAddress = @($tailscaleAddress)
    Result = 'RDP_SETUP_COMPLETE'
}
