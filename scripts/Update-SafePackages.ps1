<#
.SYNOPSIS
    Installs every minor and patch update of a repository in one go (majors are left alone).
.EXAMPLE
    ./scripts/Update-SafePackages.ps1 -Repo "MyRepo"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repo,
    [switch]$IncludeMajor
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
$kinds = if ($IncludeMajor) { @('major','minor','patch') } else { @('minor','patch') }
$list = @($d.packages | Where-Object { $_.updateType -in $kinds -and $_.latestVersion -ne 'unknown' } | ForEach-Object { @{ name = $_.name; version = $_.latestVersion } })
if (-not $list.Count) { Write-Output '{"ok":true,"updated":0,"note":"nothing to update"}'; exit 0 }
Post-Api "/api/plugins/dependency-inspector/repos/$(Esc $Repo)/update-many" @{ packages = $list } | ConvertTo-Json -Depth 5
