[CmdletBinding()]
param(
    [string]$StandardRoot,
    [string]$Python = 'python',
    [int]$Port = 8895
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
if (-not $StandardRoot) {
    $StandardRoot = Join-Path (Split-Path -Parent $sourceRoot) 'Somnus-Default'
}
Push-Location -LiteralPath $sourceRoot
try {
    & $Python -m maintainer_admin --standard $StandardRoot --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Somnus 管理后台未能启动。' }
} finally {
    Pop-Location
}
