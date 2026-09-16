<#
.SYNOPSIS
    License of every package in a repository; -Issues keeps only unknown or not-allowed ones.
.EXAMPLE
    ./scripts/Get-Licenses.ps1 -Repo "MyRepo" -Issues
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [switch]$Issues
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 600 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 600 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
$d = Get-Api "/api/plugins/dependency-inspector/repos/$(Esc $Repo)/detail"
$rows = @($d.packages | Where-Object { -not $Issues -or -not $_.licenseOk } | Select-Object name, installedVersion, license, licenseOk, isDev)
Out-Json $rows 4
