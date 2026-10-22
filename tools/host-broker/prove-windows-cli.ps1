[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,
  [ValidateSet("codex", "antigravity", "opencode")]
  [string]$ToolId = "opencode",
  [string]$CodexPath = (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'),
  [string]$AntigravityPath = (Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'),
  [string]$OpenCodePath,
  [string]$OpenCodeModel = 'opencode/deepseek-v4.1-flash-free',
  [ValidateRange(1024, 65535)]
  [int]$Port = 47324,
  [ValidateRange(5000, 120000)]
  [int]$TimeoutMs = 120000,
  [switch]$UseHostSession,
  [string]$Instruction = 'Respond with exactly CODEROOM_CLI_SMOKE_OK. Do not modify files, run commands, or access files outside the current workspace.',
  [string]$ExpectedMarker = 'CODEROOM_CLI_SMOKE_OK'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "The Windows CLI proof must run on Windows"
}

Add-Type -AssemblyName System.Net.Http

function Quote-PowerShellArgument {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Value
  )
  return "'" + $Value.Replace("'", "''") + "'"
}

function Get-ToolArguments {
  param([Parameter(Mandatory = $true)][string]$Id)
  switch ($Id) {
    "codex" {
      return @(
        "exec", "--json", "--ephemeral", "--sandbox", "read-only",
        "--skip-git-repo-check", $Instruction
      )
    }
    "antigravity" {
      return @(
        "--output-format", "stream-json", "--sandbox", "--mode",
        "plan", "--print=$Instruction"
      )
    }
    "opencode" {
      $arguments = @("run", "--format", "json", "--pure")
      if (-not [string]::IsNullOrWhiteSpace($OpenCodeModel)) {
        $arguments += @("--model", $OpenCodeModel)
      }
      $arguments += $Instruction
      return $arguments
    }
  }
  throw "Unsupported tool: $Id"
}

function Read-ResponseText {
  param([Parameter(Mandatory = $true)]$Response)
  return $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
}

function Redact-DiagnosticText {
  param([AllowEmptyString()][string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $redacted = [regex]::Replace($Text, '(?i)(bearer\s+)[a-z0-9._~+/=-]+', '$1[REDACTED]')
  if ($redacted.Length -gt 4096) { return $redacted.Substring(0, 4096) + "...[truncated]" }
  return $redacted
}

function Convert-NdjsonEvents {
  param([AllowEmptyString()][string]$Text)
  $events = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
  foreach ($line in ($Text -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
      $value = $line | ConvertFrom-Json
      if ($null -ne $value) { $events.Add($value) }
    }
    catch {
      # The broker completion frame remains authoritative for process status.
    }
  }
  return $events.ToArray()
}

$root = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
$brokerScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "serve-windows.ps1") -ErrorAction Stop).Path
$stdoutProofScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "prove-windows-stdout.ps1") -ErrorAction Stop).Path
$proofId = [guid]::NewGuid().ToString("N")
$token = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$stdoutLog = Join-Path $env:TEMP "coderoom-cli-proof-$proofId.stdout.log"
$stderrLog = Join-Path $env:TEMP "coderoom-cli-proof-$proofId.stderr.log"
$broker = $null
$client = $null
$workspacePath = $null
$previousToken = $null
$previousRoot = $null
$result = [ordered]@{
  version = "coderoom-windows-cli-proof-v1"
  status = "refused"
  toolId = $ToolId
  port = $Port
  health = $false
  discovery = $false
  plan = $false
  execution = $false
  realExecution = $false
  sessionMode = if ($UseHostSession) { "host-login" } else { "isolated" }
  frames = @()
  diagnostics = @()
  errors = @()
}
$errors = New-Object System.Collections.Generic.List[string]

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [AllowEmptyString()][string]$Body = ""
  )
  $httpMethod = if ($Method -eq "GET") { [System.Net.Http.HttpMethod]::Get } else { [System.Net.Http.HttpMethod]::Post }
  $request = New-Object System.Net.Http.HttpRequestMessage($httpMethod, $Uri)
  $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)
  if (-not [string]::IsNullOrEmpty($Body)) {
    $request.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, "application/json")
  }
  try {
    return $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  }
  finally {
    $request.Dispose()
  }
}

try {
  $stdoutProofCommand = "& " + (Quote-PowerShellArgument $stdoutProofScript) + " -WorkspaceRoot " + (Quote-PowerShellArgument $root)
  $stdoutProof = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $stdoutProofCommand 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $stdoutProof -notmatch '"status":"passed"') {
    throw "Windows stdout proof did not pass: $stdoutProof"
  }

  $previousToken = $env:CODEROOM_BROKER_TOKEN
  $previousRoot = $env:CODEROOM_WINDOWS_WORKSPACE_ROOT
  $env:CODEROOM_BROKER_TOKEN = $token
  $env:CODEROOM_WINDOWS_WORKSPACE_ROOT = $root
  $sessionArguments = if ($UseHostSession) { " -EnableHostSession" } else { "" }
  $brokerCommand = "& " + (Quote-PowerShellArgument $brokerScript) +
    " -Port $Port -EnableExecution -WorkspaceRoot " + (Quote-PowerShellArgument $root) +
    " -CodexPath " + (Quote-PowerShellArgument $CodexPath) +
    " -AntigravityPath " + (Quote-PowerShellArgument $AntigravityPath) +
    " -OpenCodePath " + (Quote-PowerShellArgument ([string]$OpenCodePath)) + $sessionArguments
  $broker = Start-Process powershell.exe -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $brokerCommand
  )

  $httpHandler = New-Object System.Net.Http.HttpClientHandler
  $httpHandler.UseProxy = $false
  $client = New-Object System.Net.Http.HttpClient($httpHandler)
  $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs + 10000)
  $ready = $false
  $healthDiagnostics = New-Object System.Collections.Generic.List[string]
  $readyDeadline = [DateTime]::UtcNow.AddMilliseconds(30000)
  while (-not $ready -and [DateTime]::UtcNow -lt $readyDeadline) {
    if ($broker.HasExited) { throw "Broker exited during startup" }
    try {
      $healthResponse = Invoke-JsonRequest -Method Get -Uri "http://127.0.0.1:$Port/health" -Body ""
      if ($healthResponse.IsSuccessStatusCode) {
        $health = (Read-ResponseText -Response $healthResponse) | ConvertFrom-Json
        $ready = $health.execution -eq "enabled"
      }
      else { $healthDiagnostics.Add("HTTP $([int]$healthResponse.StatusCode)") }
      $healthResponse.Dispose()
    }
    catch { $healthDiagnostics.Add($_.Exception.Message) }
    if (-not $ready) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $ready) {
    throw "Broker did not become ready. $($healthDiagnostics -join ' | ')"
  }
  $result.health = $true

  $discoverResponse = Invoke-JsonRequest -Method Post -Uri "http://127.0.0.1:$Port/v1/discover" -Body "{}"
  $discoveryText = Read-ResponseText -Response $discoverResponse
  if (-not $discoverResponse.IsSuccessStatusCode) { throw "Discovery failed: $discoveryText" }
  $discovery = $discoveryText | ConvertFrom-Json
  $discoveredTools = @($discovery.tools | Where-Object { $_.id -eq $ToolId })
  if ($discoveredTools.Count -ne 1) { throw "$ToolId was not discovered" }
  $resolvedToolPath = [string]$discoveredTools[0].executablePath
  if ([string]::IsNullOrWhiteSpace($resolvedToolPath)) { throw "$ToolId has no executable path" }
  $result.discovery = $true
  $discoverResponse.Dispose()

  $workspacePath = Join-Path $root ".coderoom-cli-proof-$proofId"
  New-Item -ItemType Directory -Force -Path $workspacePath | Out-Null
  $requestBody = [ordered]@{
    requestId = [guid]::NewGuid().ToString("N")
    toolId = $ToolId
    executablePath = $resolvedToolPath
    workspaceRoot = $root
    workspacePath = $workspacePath
    argv = Get-ToolArguments -Id $ToolId
    sessionMode = if ($UseHostSession) { "host-login" } else { "isolated" }
    environment = @{}
    timeoutMs = $TimeoutMs
  } | ConvertTo-Json -Depth 5

  $planResponse = Invoke-JsonRequest -Method Post -Uri "http://127.0.0.1:$Port/v1/plan" -Body $requestBody
  $planText = Read-ResponseText -Response $planResponse
  if (-not $planResponse.IsSuccessStatusCode) { throw "Plan failed: $planText" }
  $plan = $planText | ConvertFrom-Json
  $expectedSessionMode = if ($UseHostSession) { "host-login" } else { "isolated" }
  if ($plan.toolId -ne $ToolId -or $plan.execution -ne "enabled" -or $plan.shell -ne $false -or
      $plan.killProcessTree -ne $true -or $plan.sessionMode -ne $expectedSessionMode) {
    throw "Plan did not expose the expected execution constraints"
  }
  $result.plan = $true
  $planResponse.Dispose()

  $executeResponse = Invoke-JsonRequest -Method Post -Uri "http://127.0.0.1:$Port/v1/execute" -Body $requestBody
  if (-not $executeResponse.IsSuccessStatusCode) { throw "Execution rejected: $(Read-ResponseText -Response $executeResponse)" }
  $reader = [System.IO.StreamReader]::new($executeResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
  $frames = New-Object System.Collections.Generic.List[object]
  try {
    while (($line = $reader.ReadLine()) -ne $null) {
      if (-not [string]::IsNullOrWhiteSpace($line)) { $frames.Add(($line | ConvertFrom-Json)) }
    }
  }
  finally {
    $reader.Dispose()
    $executeResponse.Dispose()
  }
  $frameArray = $frames.ToArray()
  $result.frames = @($frameArray)
  $completion = @($frameArray | Where-Object { $_.type -eq "completed" }) | Select-Object -Last 1
  $stdoutText = [string]::Join("", @($frameArray | Where-Object { $_.type -eq "stdout" } | ForEach-Object { [string]$_.data }))
  $stderrText = [string]::Join("", @($frameArray | Where-Object { $_.type -eq "stderr" } | ForEach-Object { [string]$_.data }))
  $events = Convert-NdjsonEvents -Text $stdoutText
  $result.diagnostics = @(
    "stderr=" + (Redact-DiagnosticText -Text $stderrText),
    "eventTypes=" + ([string]::Join(",", @($events | ForEach-Object { if ($null -ne $_.PSObject.Properties['type']) { [string]$_.type } })))
  )
  $hasExpectedOutput = $stdoutText -match [regex]::Escape($ExpectedMarker)
  if ($null -eq $completion -or $completion.status -ne "succeeded" -or $completion.exitCode -ne 0 -or -not $hasExpectedOutput) {
    throw "Execution returned unexpected frames for $ToolId"
  }
  $result.execution = $true
  $result.realExecution = $true
  $result.status = "passed"
}
catch {
  $errors.Add($_.Exception.Message)
}
finally {
  if ($null -ne $client) { $client.Dispose() }
  if ($null -ne $broker -and -not $broker.HasExited) { Stop-Process -Id $broker.Id -Force -ErrorAction SilentlyContinue }
  if ($null -ne $workspacePath -and (Test-Path -LiteralPath $workspacePath)) { Remove-Item -LiteralPath $workspacePath -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stdoutLog) { Remove-Item -LiteralPath $stdoutLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stderrLog) { Remove-Item -LiteralPath $stderrLog -Force -ErrorAction SilentlyContinue }
  if ($null -ne $previousToken) { $env:CODEROOM_BROKER_TOKEN = $previousToken } else { Remove-Item Env:CODEROOM_BROKER_TOKEN -ErrorAction SilentlyContinue }
  if ($null -ne $previousRoot) { $env:CODEROOM_WINDOWS_WORKSPACE_ROOT = $previousRoot } else { Remove-Item Env:CODEROOM_WINDOWS_WORKSPACE_ROOT -ErrorAction SilentlyContinue }
}

$result.errors = @($errors)
$result | ConvertTo-Json -Compress -Depth 8
if ($result.status -ne "passed") { exit 1 }
