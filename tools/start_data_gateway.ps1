param(
    [Parameter(Mandatory)]
    [string] $Config,
    [string] $BindAddress,
    [int] $Port = 0,
    [string] $Certificate,
    [string] $PrivateKey,
    [string] $Python = 'python'
)

$ErrorActionPreference = 'Stop'
$gatewayConfig = (Resolve-Path -LiteralPath $Config).Path
if ($BindAddress) { $env:DATA_AGENT_GATEWAY_HOST = $BindAddress }
if ($Port) { $env:DATA_AGENT_GATEWAY_PORT = [string]$Port }
if ($Certificate) { $env:DATA_AGENT_GATEWAY_CERT = (Resolve-Path -LiteralPath $Certificate).Path }
if ($PrivateKey) { $env:DATA_AGENT_GATEWAY_KEY = (Resolve-Path -LiteralPath $PrivateKey).Path }

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & $Python -m data_gateway --config $gatewayConfig
    $gatewayExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}
exit $gatewayExitCode
