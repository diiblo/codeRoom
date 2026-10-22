[CmdletBinding()]
param(
  [string]$CodexPath,
  [string]$AntigravityPath,
  [string]$OpenCodePath,
  [switch]$FailOnMissing
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-HostTool {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$CommandName,
    [string]$ExplicitPath,
    [string[]]$KnownPaths = @()
  )

  $source = $null
  $candidate = $null

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    $candidate = [System.IO.Path]::GetFullPath($ExplicitPath)
    $source = "explicit"
  }
  else {
    foreach ($knownPath in $KnownPaths) {
      if (-not [string]::IsNullOrWhiteSpace($knownPath) -and
          (Test-Path -LiteralPath $knownPath -PathType Leaf)) {
        $candidate = [System.IO.Path]::GetFullPath($knownPath)
        $source = "known-path"
        break
      }
    }
  }

  if ($null -eq $candidate) {
    $command = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($null -ne $command) {
      $candidate = [System.IO.Path]::GetFullPath($command.Source)
      $source = "path"
    }
  }

  if ($null -eq $candidate) {
    return $null
  }

  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Configured executable does not exist: $candidate"
  }

  $item = Get-Item -LiteralPath $candidate
  if ($item.Extension.ToLowerInvariant() -notin @(".exe", ".cmd", ".bat")) {
    throw "Configured executable has an unsupported extension: $candidate"
  }

  [pscustomobject]@{
    id = $Id
    executablePath = $item.FullName
    source = $source
  }
}

$localAppData = $env:LOCALAPPDATA
$codexKnownPaths = @()
$antigravityKnownPaths = @()
if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
  $codexKnownPaths = @(
    (Join-Path $localAppData "Programs\OpenAI\Codex\bin\codex.exe")
  )
  $antigravityKnownPaths = @(
    (Join-Path $localAppData "agy\bin\agy.exe")
  )
}

# Keep this catalog explicit: callers may provide a different path, but the
# broker never accepts an unregistered executable identity.
$toolDefinitions = @(
  [pscustomobject]@{
    id = "codex"
    commandName = "codex"
    explicitPath = $CodexPath
    knownPaths = $codexKnownPaths
  }
  [pscustomobject]@{
    id = "antigravity"
    commandName = "agy"
    explicitPath = $AntigravityPath
    knownPaths = $antigravityKnownPaths
  }
  [pscustomobject]@{
    id = "opencode"
    commandName = "opencode"
    explicitPath = $OpenCodePath
    knownPaths = @()
  }
)

$tools = @(
  foreach ($definition in $toolDefinitions) {
    $tool = Resolve-HostTool `
      -Id $definition.id `
      -CommandName $definition.commandName `
      -ExplicitPath $definition.explicitPath `
      -KnownPaths $definition.knownPaths
    if ($null -ne $tool) { $tool }
  }
)

$knownIds = @($toolDefinitions | ForEach-Object { $_.id })
$discoveredIds = @($tools | ForEach-Object { $_.id })
$missing = @($knownIds | Where-Object { $_ -notin $discoveredIds })
$result = [pscustomobject]@{
  version = "windows-discovery-v1"
  platform = "windows"
  architecture = "x64"
  tools = @($tools)
  missing = @($missing)
  execution = "discovery-only"
}

$result | ConvertTo-Json -Compress -Depth 4
if ($FailOnMissing -and $missing.Count -gt 0) {
  exit 1
}
