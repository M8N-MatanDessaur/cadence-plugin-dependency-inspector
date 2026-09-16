<#
.SYNOPSIS
    Scans one repository now: reads its manifest and asks the registries.
.EXAMPLE
    ./scripts/Start-Scan.ps1 -Repo "MyRepo"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 600 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 600 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
$r = Post-Api "/api/plugins/dependency-inspector/repos/$(Esc $Repo)/scan" @{}
[pscustomobject]@{ repo = $Repo; health = $r.health; packages = @($r.packages).Count; vulnerabilities = @($r.vulnerabilities).Count; scannedAt = $r.scannedAt } | ConvertTo-Json
