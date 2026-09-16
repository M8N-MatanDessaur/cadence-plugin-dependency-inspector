<#
.SYNOPSIS
    The same report as plain text, for a quick read.
.EXAMPLE
    ./scripts/Get-DependencySummary.ps1
#>
[CmdletBinding()]
param(

)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 600 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 600 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
(Invoke-WebRequest -UseBasicParsing -Uri "$CadenceApi/api/plugins/dependency-inspector/summary" -Headers $headers -TimeoutSec 600).Content
