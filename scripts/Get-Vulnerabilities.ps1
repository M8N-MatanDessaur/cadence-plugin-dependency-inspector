<#
.SYNOPSIS
    Advisories of one repository, worst first (or across the workspace with -All).
.EXAMPLE
    ./scripts/Get-Vulnerabilities.ps1 -Repo "MyRepo"
#>
[CmdletBinding()]
param(
    [string]$Repo = '',
    [switch]$All
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 600 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 600 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
$order = @{ critical = 0; high = 1; moderate = 2; low = 3 }
if ($All -or -not $Repo) {
  $ov = Get-Api '/api/plugins/dependency-inspector/overview'
  $rows = @()
  foreach ($r in $ov.repos) { if ($r.scanned -and $r.vulnerabilities.total -gt 0) { $d = Get-Api "/api/plugins/dependency-inspector/repos/$(Esc $r.name)/detail"; foreach ($v in $d.vulnerabilities) { $rows += [pscustomobject]@{ repo = $r.name; module = $v.module; severity = $v.severity; title = $v.title; range = $v.range; fix = $v.recommendation; url = $v.url } } } }
  Out-Json @($rows | Sort-Object { $order[$_.severity] }) 4
} else {
  $d = Get-Api "/api/plugins/dependency-inspector/repos/$(Esc $Repo)/detail"
  Out-Json @($d.vulnerabilities | Sort-Object { $order[$_.severity] }) 4
}
