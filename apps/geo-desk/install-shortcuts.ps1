param([string]$Destination = [Environment]::GetFolderPath('Desktop'), [ValidateRange(1, 65535)][int]$Port = 8766)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Destination -PathType Container)) { throw 'Shortcut destination must be an existing directory.' }
$taskPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskLabels = '{"run":"GEO Desk \uc2e4\ud589","stop":"GEO Desk \uc885\ub8cc"}' | ConvertFrom-Json
$taskShell = New-Object -ComObject WScript.Shell
foreach ($taskAction in @(
    @{ Label = $taskLabels.run; Script = 'open.ps1'; Args = "-Port $Port"; Icon = 14; Description = 'Start GEO Desk and open the chat page.' },
    @{ Label = $taskLabels.stop; Script = 'close.ps1'; Args = ''; Icon = 131; Description = 'Stop only GEO Desk; preserve settings and chats.' }
)) {
    $taskShortcutPath = Join-Path $Destination ($taskAction.Label + '.lnk')
    $taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
    $taskShortcut.TargetPath = $taskPowerShell
    $taskShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot $taskAction.Script) + '" ' + $taskAction.Args
    $taskShortcut.WorkingDirectory = $PSScriptRoot
    $taskShortcut.Description = $taskAction.Description
    $taskShortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',' + $taskAction.Icon
    $taskShortcut.WindowStyle = 7
    $taskShortcut.Save()
    Write-Host "Created shortcut: $taskShortcutPath"
}
