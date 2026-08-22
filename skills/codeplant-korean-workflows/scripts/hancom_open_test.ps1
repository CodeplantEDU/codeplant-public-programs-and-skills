param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'
$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$hwp = $null

try {
    $hwp = New-Object -ComObject HWPFrame.HwpObject
    $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
    if (-not $hwp.Open($resolvedPath, 'HWPX', '')) {
        throw 'Hancom Open returned false.'
    }
    Write-Output 'HANCOM_OPEN_OK'
}
finally {
    if ($null -ne $hwp) {
        $hwp.Quit()
    }
}
