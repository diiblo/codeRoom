[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,
  [string]$CodexPath = (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'),
  [string]$AntigravityPath = (Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'),
  [string]$OpenCodePath,
  [ValidateRange(1024, 65535)]
  [int]$Port = 47323,
  [ValidateRange(5000, 120000)]
  [int]$TimeoutMs = 120000,
  [switch]$RunRealCodex,
  [switch]$UseHostSession,
  [string]$RealInstruction = 'Respond with exactly CODEROOM_REAL_SMOKE_OK. Do not modify files, run commands, or access files outside the current workspace.'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "The Windows broker proof must run on Windows"
}
if ($UseHostSession -and -not $RunRealCodex) {
  throw "UseHostSession requires RunRealCodex"
}

Add-Type -AssemblyName System.Net.Http

$root = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
$brokerScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "serve-windows.ps1") -ErrorAction Stop).Path
$stdoutProofScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "prove-windows-stdout.ps1") -ErrorAction Stop).Path
$proofId = [guid]::NewGuid().ToString("N")
$token = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
$stdoutLog = Join-Path $env:TEMP "coderoom-broker-proof-$proofId.stdout.log"
$stderrLog = Join-Path $env:TEMP "coderoom-broker-proof-$proofId.stderr.log"
$executionDiagnostic = Join-Path $env:TEMP "coderoom-broker-execution.log"
$broker = $null
$client = $null
$workspacePath = $null
$frameArray = @()
$codexEvents = @()
$previousToken = $null
$previousRoot = $null
$result = [ordered]@{
  version = "coderoom-windows-broker-proof-v1"
  status = "refused"
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

  $httpMethod = if ($Method -eq "GET") {
    [System.Net.Http.HttpMethod]::Get
  }
  else {
    [System.Net.Http.HttpMethod]::Post
  }
  $request = New-Object System.Net.Http.HttpRequestMessage($httpMethod, $Uri)
  $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)
  if (-not [string]::IsNullOrEmpty($Body)) {
    $request.Content = New-Object System.Net.Http.StringContent(
      $Body,
      [System.Text.Encoding]::UTF8,
      "application/json"
    )
  }
  try {
    return $client.SendAsync(
      $request,
      [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
    ).GetAwaiter().GetResult()
  }
  finally {
    $request.Dispose()
  }
}

function Read-ResponseText {
  param([Parameter(Mandatory = $true)]$Response)
  return $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
}

function Redact-DiagnosticText {
  param([AllowEmptyString()][string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $redacted = [regex]::Replace(
    $Text,
    '(?i)(bearer\s+)[a-z0-9._~+/=-]+',
    '$1[REDACTED]'
  )
  if ($redacted.Length -gt 4096) {
    return $redacted.Substring(0, 4096) + "...[truncated]"
  }
  return $redacted
}

function Convert-NdjsonEvents {
  param(
    [AllowNull()]
    [AllowEmptyString()]
    [string]$Text
  )

  $events = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return @()
  }

  foreach ($line in ($Text -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }
    try {
      $event = $line | ConvertFrom-Json
      if ($null -ne $event) {
        $events.Add($event)
      }
    }
    catch {
      # Ignore non-JSON provider diagnostics on stdout; the terminal broker
      # frame remains authoritative for process success or failure.
    }
  }

  return $events.ToArray()
}

try {
  Remove-Item -LiteralPath $executionDiagnostic -Force -ErrorAction SilentlyContinue
  $stdoutProofCommand = "& '$stdoutProofScript' -WorkspaceRoot '$root'"
  $stdoutProof = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
    -Command $stdoutProofCommand 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $stdoutProof -notmatch '"status":"passed"') {
    throw "Windows stdout proof did not pass: $stdoutProof"
  }

  $previousToken = $env:CODEROOM_BROKER_TOKEN
  $previousRoot = $env:CODEROOM_WINDOWS_WORKSPACE_ROOT
  $env:CODEROOM_BROKER_TOKEN = $token
  $env:CODEROOM_WINDOWS_WORKSPACE_ROOT = $root
  $sessionArguments = if ($UseHostSession) {
    " -EnableHostSession"
  }
  else {
    ""
  }
  $command = "& '$brokerScript' -Port $Port -EnableExecution -WorkspaceRoot '$root' -CodexPath '$CodexPath' -AntigravityPath '$AntigravityPath' -OpenCodePath '$OpenCodePath'$sessionArguments"
  $broker = Start-Process powershell.exe `
    -PassThru `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', $command
    )

  $httpHandler = New-Object System.Net.Http.HttpClientHandler
  $httpHandler.UseProxy = $false
  $client = New-Object System.Net.Http.HttpClient($httpHandler)
  # Let the broker emit its terminal frame after its own execution timeout.
  $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs + 10000)
  $healthUri = "http://127.0.0.1:$Port/health"
  $ready = $false
  $healthDiagnostics = New-Object System.Collections.Generic.List[string]
  $readyDeadline = [DateTime]::UtcNow.AddMilliseconds(30000)
  while (-not $ready -and [DateTime]::UtcNow -lt $readyDeadline) {
    if ($broker.HasExited) {
      throw "Broker exited during startup: $((Get-Content $stderrLog -ErrorAction SilentlyContinue) -join ' ')"
    }
    try {
      $healthResponse = Invoke-JsonRequest -Method Get -Uri $healthUri -Body ""
      if ($healthResponse.IsSuccessStatusCode) {
        $healthBody = Read-ResponseText -Response $healthResponse
        $health = $healthBody | ConvertFrom-Json
        $ready = $health.execution -eq "enabled"
      }
      else {
        $healthDiagnostics.Add("HTTP $([int]$healthResponse.StatusCode): $(Read-ResponseText -Response $healthResponse)")
      }
      $healthResponse.Dispose()
    }
    catch { $healthDiagnostics.Add($_.Exception.Message) }
    if (-not $ready) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $ready) {
    $startupOutput = (Get-Content -LiteralPath $stdoutLog -ErrorAction SilentlyContinue) -join " "
    $startupError = (Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue) -join " "
    throw "Broker did not become ready. health=$($healthDiagnostics -join ' | ') stdout=$startupOutput stderr=$startupError"
  }
  $result.health = $true

  $discoverResponse = Invoke-JsonRequest -Method Post -Uri "http://127.0.0.1:$Port/v1/discover" -Body "{}"
  $discoverBody = Read-ResponseText -Response $discoverResponse
  if (-not $discoverResponse.IsSuccessStatusCode) { throw "Discovery failed: $discoverBody" }
  $discovery = $discoverBody | ConvertFrom-Json
  if (@($discovery.tools | Where-Object { $_.id -eq "codex" }).Count -ne 1) {
    throw "Codex was not discovered"
  }
  $result.discovery = $true
  $discoverResponse.Dispose()

  $workspacePath = Join-Path $root ".coderoom-broker-proof-$proofId"
  New-Item -ItemType Directory -Force -Path $workspacePath | Out-Null
  $requestId = [guid]::NewGuid().ToString("N")
  $argv = if ($RunRealCodex) {
    @(
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      $RealInstruction
    )
  }
  else {
    @("--version")
  }
  $requestBody = [ordered]@{
    requestId = $requestId
    toolId = "codex"
    executablePath = $CodexPath
    workspaceRoot = $root
    workspacePath = $workspacePath
    argv = $argv
    sessionMode = if ($UseHostSession) { "host-login" } else { "isolated" }
    environment = @{}
    timeoutMs = if ($RunRealCodex) { $TimeoutMs } else { 10000 }
  } | ConvertTo-Json -Depth 5

  $planResponse = Invoke-JsonRequest -Method Post -Uri "http://127.0.0.1:$Port/v1/plan" -Body $requestBody
  $planBody = Read-ResponseText -Response $planResponse
  if (-not $planResponse.IsSuccessStatusCode) { throw "Plan failed: $planBody" }
  $plan = $planBody | ConvertFrom-Json
  $expectedSessionMode = if ($UseHostSession) { "host-login" } else { "isolated" }
  if ($plan.execution -ne "enabled" -or $plan.shell -ne $false -or $plan.killProcessTree -ne $true -or
      $plan.sessionMode -ne $expectedSessionMode) {
    throw "Plan did not expose the expected execution constraints"
  }
  $result.plan = $true
  $planResponse.Dispose()

  $executeResponse = Invoke-JsonRequest -Method Post -Uri "http://127.0.0.1:$Port/v1/execute" -Body $requestBody
  if (-not $executeResponse.IsSuccessStatusCode) {
    throw "Execution rejected: $(Read-ResponseText -Response $executeResponse)"
  }
  $reader = [System.IO.StreamReader]::new(
    $executeResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  )
  $frames = New-Object System.Collections.Generic.List[object]
  try {
    while (($line = $reader.ReadLine()) -ne $null) {
      if (-not [string]::IsNullOrWhiteSpace($line)) {
        $frame = $line | ConvertFrom-Json
        $frames.Add($frame)
      }
    }
  }
  finally {
    $reader.Dispose()
    $executeResponse.Dispose()
  }
  $frameArray = $frames.ToArray()
  $result.frames = @($frameArray)
  $completion = @($frameArray | Where-Object { $_.type -eq "completed" }) | Select-Object -Last 1
  $hasExpectedOutput = if ($RunRealCodex) {
    $codexEvents = @(
      $frameArray |
        Where-Object { $_.type -eq "stdout" } |
        ForEach-Object {
          Convert-NdjsonEvents -Text ([string]$_.data)
        }
    )
    @(
      $codexEvents | Where-Object {
        $null -ne $_ -and
        $null -ne $_.PSObject.Properties['type'] -and
        $_.type -eq "item.completed" -and
        $null -ne $_.item -and
        $null -ne $_.item.PSObject.Properties['type'] -and
        $_.item.type -eq "agent_message" -and
        $null -ne $_.item.PSObject.Properties['text'] -and
        $_.item.text -match "CODEROOM_REAL_SMOKE_OK"
      }
    ).Count -gt 0
  }
  else {
    @($frameArray | Where-Object { $_.type -eq "stdout" -and $_.data -match "\d+\.\d+" }).Count -gt 0
  }
  $stderrText = [string]::Join(
    "",
    @($frameArray | Where-Object { $_.type -eq "stderr" } | ForEach-Object { [string]$_.data })
  )
  $result.diagnostics = @(
    "stderr=" + (Redact-DiagnosticText -Text $stderrText),
    "codexEventTypes=" + ([string]::Join(",", @(
      $codexEvents | ForEach-Object {
        $typeProperty = if ($null -ne $_) { $_.PSObject.Properties['type'] } else { $null }
        if ($null -ne $typeProperty) { [string]$typeProperty.Value }
      }
    ))),
    "codexErrors=" + (Redact-DiagnosticText -Text ([string]::Join(
      " | ",
      @(
        $codexEvents | Where-Object {
          $null -ne $_ -and
          $null -ne $_.PSObject.Properties['type'] -and
          $_.type -eq "error"
        } | ForEach-Object {
          $messageProperty = $_.PSObject.Properties['message']
          if ($null -ne $messageProperty) { [string]$messageProperty.Value }
        }
      )
    )))
  )
  if ($null -eq $completion -or $completion.status -ne "succeeded" -or $completion.exitCode -ne 0 -or -not $hasExpectedOutput) {
    throw "Execution returned unexpected frames"
  }
  $result.execution = $true
  $result.realExecution = [bool]$RunRealCodex
  $result.status = "passed"
}
catch {
  $errors.Add($_.Exception.Message)
  if (Test-Path -LiteralPath $executionDiagnostic) {
    $errors.Add((Get-Content -LiteralPath $executionDiagnostic -Raw))
  }
}
finally {
  if ($null -ne $client) { $client.Dispose() }
  if ($null -ne $broker -and -not $broker.HasExited) {
    Stop-Process -Id $broker.Id -Force -ErrorAction SilentlyContinue
  }
  if ($null -ne $workspacePath -and (Test-Path -LiteralPath $workspacePath)) {
    Remove-Item -LiteralPath $workspacePath -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $stdoutLog) { Remove-Item -LiteralPath $stdoutLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stderrLog) { Remove-Item -LiteralPath $stderrLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $executionDiagnostic) { Remove-Item -LiteralPath $executionDiagnostic -Force -ErrorAction SilentlyContinue }
  if ($null -ne $previousToken) { $env:CODEROOM_BROKER_TOKEN = $previousToken }
  else { Remove-Item Env:CODEROOM_BROKER_TOKEN -ErrorAction SilentlyContinue }
  if ($null -ne $previousRoot) { $env:CODEROOM_WINDOWS_WORKSPACE_ROOT = $previousRoot }
  else { Remove-Item Env:CODEROOM_WINDOWS_WORKSPACE_ROOT -ErrorAction SilentlyContinue }
}

$result.errors = @($errors)
$result | ConvertTo-Json -Compress -Depth 8
if ($result.status -ne "passed") { exit 1 }
