#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$HostAddress,

    [ValidatePattern('^\d+(,\d+)*$')]
    [string]$DefaultMonitors = '1,6',

    [string]$OutputPath = (Join-Path (Get-Location) 'CODEPLANT_RDP_Display.exe')
)

$ErrorActionPreference = 'Stop'
$templatePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\RdpDualMonitorLauncher.cs.template'
$iconPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets\codeplant-rdp.ico'

if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
    throw "Launcher template not found: $templatePath"
}
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
    throw "CODEPLANT icon not found: $iconPath"
}

if ($HostAddress -notmatch '^[A-Za-z0-9][A-Za-z0-9.:-]*$') {
    throw 'HostAddress contains an unsupported character. Use a Tailscale IPv4 address or MagicDNS host name.'
}

$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) {
    throw 'The Windows .NET Framework C# compiler was not found.'
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$temporarySource = Join-Path ([System.IO.Path]::GetTempPath()) ("codeplant-rdp-launcher-{0}.cs" -f [guid]::NewGuid().ToString('N'))
try {
    $source = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
    $escapedHost = $HostAddress.Replace('\', '\\').Replace('"', '\"')
    $source = $source.Replace('__HOST_ADDRESS__', $escapedHost)
    $source = $source.Replace('__DEFAULT_MONITORS__', $DefaultMonitors)
    Set-Content -LiteralPath $temporarySource -Value $source -Encoding UTF8

    & $compiler /nologo /target:winexe /optimize+ "/out:$resolvedOutput" "/win32icon:$iconPath" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $temporarySource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) {
        throw "Launcher compilation failed with exit code $LASTEXITCODE."
    }

    $selfTest = Start-Process -FilePath $resolvedOutput -ArgumentList '/self-test' -Wait -PassThru
    if ($selfTest.ExitCode -ne 0) {
        throw "Launcher self-test failed with exit code $($selfTest.ExitCode)."
    }

    $hash = Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256
    [pscustomobject]@{
        OutputPath = $resolvedOutput
        HostAddress = $HostAddress
        DefaultMonitors = $DefaultMonitors
        SizeBytes = (Get-Item -LiteralPath $resolvedOutput).Length
        SHA256 = $hash.Hash
        SelfTest = 'Passed'
    }
}
finally {
    Remove-Item -LiteralPath $temporarySource -Force -ErrorAction SilentlyContinue
}
