[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$Port = 47321,
  [string]$ListenAddress = "127.0.0.1",
  [string]$AuthToken = $env:CODEROOM_BROKER_TOKEN,
  [string]$WorkspaceRoot = $env:CODEROOM_WINDOWS_WORKSPACE_ROOT,
  [string]$CodexPath,
  [string]$AntigravityPath,
  [string]$OpenCodePath,
  [string[]]$EnvironmentAllowlist = @(
    "CODE_ROOM_PROJECT_ID",
    "CODE_ROOM_EXECUTION_ID",
    "CODE_ROOM_TRIGGER_ID",
    "CODE_ROOM_SESSION_ID"
  ),
  [ValidateRange(0, 8192)][int]$ExecutionMemoryLimitMb = 0,
  [switch]$EnableExecution,
  [switch]$EnableHostSession
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:MaxRequestBytes = 64 * 1024
$script:MaxArgumentCount = 128
$script:MaxArgumentLength = 4096
$script:MaxTimeoutMs = 30 * 60 * 1000
$script:SensitiveEnvironmentKey = [regex]::new(
  "password|secret|token|authorization|api[_-]?key|credential|private[_-]?key",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)
$script:InheritedEnvironmentKey = [regex]::new(
  "^(USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|COMSPEC|PATHEXT)$",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)
$script:BlockedArguments = @(
  "--dangerously-allow-all",
  "--yolo",
  "--no-sandbox"
)
$script:MaxStreamBytes = 16 * 1024 * 1024
$script:ExecutionDiagnosticPath = Join-Path $env:TEMP "coderoom-broker-execution.log"

function Get-PropertyValue {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-ExecutionMemoryLimitMb {
  param(
    [Parameter(Mandatory = $true)][string]$ToolId
  )

  if ($ExecutionMemoryLimitMb -gt 0) {
    return $ExecutionMemoryLimitMb
  }
  if ($ToolId -eq "opencode") {
    return 2048
  }
  return 512
}

function Require-Text {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Field,
    [int]$MaximumLength = 512
  )

  if ($null -eq $Value -or $Value -isnot [string]) {
    throw "$Field must be a string"
  }
  $normalized = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized.IndexOf([char]0) -ge 0) {
    throw "$Field must be non-empty"
  }
  if ($normalized.Length -gt $MaximumLength) {
    throw "$Field exceeds the maximum length"
  }
  return $normalized
}

function Resolve-ExistingPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Field,
    [ValidateSet("Any", "Directory", "Leaf")][string]$PathType = "Any"
  )

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($PathType -eq "Directory" -and -not $item.PSIsContainer) {
    throw "$Field must be a directory"
  }
  if ($PathType -eq "Leaf" -and $item.PSIsContainer) {
    throw "$Field must be a file"
  }
  $resolved = Resolve-Path -LiteralPath $item.FullName -ErrorAction Stop
  $providerPath = $resolved.ProviderPath
  if ($providerPath.Length -gt 3) {
    $providerPath = $providerPath.TrimEnd('\')
  }
  return $providerPath
}

function Normalize-WindowsPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $normalized = $Path.Trim()
  if ($normalized.Length -gt 3) {
    $normalized = $normalized.TrimEnd('\')
  }
  return $normalized
}

function Test-PathWithin {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate
  )

  $normalizedRoot = Normalize-WindowsPath -Path $Root
  $normalizedCandidate = Normalize-WindowsPath -Path $Candidate
  if ([string]::Equals($normalizedRoot, $normalizedCandidate, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  return $normalizedCandidate.StartsWith(
    "$normalizedRoot\",
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Resolve-HostTool {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$CommandName,
    [string]$ExplicitPath,
    [string[]]$KnownPaths = @()
  )

  $candidate = $null
  $source = $null
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    $candidate = $ExplicitPath
    $source = "explicit"
  }
  else {
    foreach ($knownPath in $KnownPaths) {
      if (-not [string]::IsNullOrWhiteSpace($knownPath) -and
          (Test-Path -LiteralPath $knownPath -PathType Leaf)) {
        $candidate = $knownPath
        $source = "known-path"
        break
      }
    }
  }

  if ($null -eq $candidate) {
    $command = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($null -ne $command) {
      $candidate = $command.Source
      $source = "path"
    }
  }
  if ($null -eq $candidate) { return $null }

  $resolved = Resolve-ExistingPath -Path $candidate -Field "$Id executable" -PathType Leaf
  $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
  if ($item.Extension.ToLowerInvariant() -notin @(".exe", ".cmd", ".bat")) {
    throw "Configured executable has an unsupported extension: $resolved"
  }

  [pscustomobject]@{
    id = $Id
    executablePath = $resolved
    source = $source
  }
}

function Get-Discovery {
  param(
    [string]$RequestedCodexPath,
    [string]$RequestedAntigravityPath,
    [string]$RequestedOpenCodePath
  )

  $localAppData = $env:LOCALAPPDATA
  $codexKnownPaths = @()
  $antigravityKnownPaths = @()
  if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
    $codexKnownPaths += Join-Path $localAppData "Programs\OpenAI\Codex\bin\codex.exe"
    $antigravityKnownPaths += Join-Path $localAppData "agy\bin\agy.exe"
  }

  # Keep this catalog explicit: callers may provide a different path, but the
  # broker never accepts an unregistered executable identity.
  $toolDefinitions = @(
    [pscustomobject]@{
      id = "codex"
      commandName = "codex"
      explicitPath = $RequestedCodexPath
      knownPaths = $codexKnownPaths
    }
    [pscustomobject]@{
      id = "antigravity"
      commandName = "agy"
      explicitPath = $RequestedAntigravityPath
      knownPaths = $antigravityKnownPaths
    }
    [pscustomobject]@{
      id = "opencode"
      commandName = "opencode"
      explicitPath = $RequestedOpenCodePath
      knownPaths = @()
    }
  )

  $tools = @(
    foreach ($definition in $toolDefinitions) {
      $tool = Resolve-HostTool -Id $definition.id -CommandName $definition.commandName `
        -ExplicitPath $definition.explicitPath -KnownPaths $definition.knownPaths
      if ($null -ne $tool) { $tool }
    }
  )
  $knownIds = @($toolDefinitions | ForEach-Object { $_.id })
  $discoveredIds = @($tools | ForEach-Object { $_.id })
  $missing = @($knownIds | Where-Object { $_ -notin $discoveredIds })
  return [ordered]@{
    version = "windows-discovery-v1"
    platform = "windows"
    architecture = "x64"
    tools = @($tools)
    missing = @($missing)
    execution = "discovery-only"
  }
}

function Read-BoundedBody {
  param([Parameter(Mandatory = $true)]$Request)

  if ($Request.ContentLength64 -gt $script:MaxRequestBytes) {
    throw "request body exceeds the maximum size"
  }
  $buffer = New-Object byte[] 8192
  $memory = New-Object System.IO.MemoryStream
  try {
    while (($read = $Request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if (($memory.Length + $read) -gt $script:MaxRequestBytes) {
        throw "request body exceeds the maximum size"
      }
      $memory.Write($buffer, 0, $read)
    }
    return [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
  }
  finally {
    $memory.Dispose()
  }
}

function Write-JsonResponse {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)][int]$StatusCode,
    [Parameter(Mandatory = $true)]$Payload
  )

  $json = $Payload | ConvertTo-Json -Compress -Depth 8
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response = $Context.Response
  $response.StatusCode = $StatusCode
  $response.ContentType = "application/json; charset=utf-8"
  $response.ContentLength64 = $bytes.Length
  $response.Headers.Add("Cache-Control", "no-store")
  $response.Headers.Add("X-Content-Type-Options", "nosniff")
  try {
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
  }
  finally {
    $response.Close()
  }
}

function Assert-Authorization {
  param([Parameter(Mandatory = $true)]$Request)

  $provided = $Request.Headers["Authorization"]
  $expected = "Bearer $AuthToken"
  if ([string]::IsNullOrWhiteSpace($provided) -or
      -not [string]::Equals($provided, $expected, [System.StringComparison]::Ordinal)) {
    throw "unauthorized"
  }
}

function Read-JsonBody {
  param([Parameter(Mandatory = $true)]$Request)

  $body = Read-BoundedBody -Request $Request
  if ([string]::IsNullOrWhiteSpace($body)) {
    return [pscustomobject]@{}
  }
  try {
    return $body | ConvertFrom-Json
  }
  catch {
    throw "request body is not valid JSON"
  }
}

function Assert-Environment {
  param(
    [Parameter(Mandatory = $true)]$Environment,
    [string[]]$ExplicitSecretKeys = @()
  )

  $environmentKeys = @()
  if ($null -eq $Environment) {
    return $environmentKeys
  }
  foreach ($property in $Environment.PSObject.Properties) {
    $key = Require-Text -Value $property.Name -Field "environment key" -MaximumLength 128
    if ($key -notmatch "^[A-Z_][A-Z0-9_]*$") {
      throw "environment key is not safe: $key"
    }
    if ($EnvironmentAllowlist -notcontains $key) {
      throw "environment key is not allowlisted: $key"
    }
    if ($script:InheritedEnvironmentKey.IsMatch($key)) {
      throw "inherited environment key is forbidden: $key"
    }
    if ($null -eq $property.Value -or $property.Value -isnot [string] -or
        $property.Value.IndexOf([char]0) -ge 0) {
      throw "environment value is invalid: $key"
    }
    if ($script:SensitiveEnvironmentKey.IsMatch($key) -and
        $ExplicitSecretKeys -notcontains $key) {
      throw "sensitive environment key requires explicit declaration: $key"
    }
    $environmentKeys += $key
  }
  return $environmentKeys
}

function New-ExecutionPlan {
  param(
    [Parameter(Mandatory = $true)]$Request,
    [Parameter(Mandatory = $true)][string]$RequestId
  )

  $toolId = Require-Text -Value (Get-PropertyValue $Request "toolId") -Field "toolId" -MaximumLength 64
  $requestedSessionMode = Get-PropertyValue $Request "sessionMode"
  $sessionMode = if ($null -eq $requestedSessionMode) { "isolated" } else {
    Require-Text -Value $requestedSessionMode -Field "sessionMode" -MaximumLength 32
  }
  if ($sessionMode -notin @("isolated", "host-login")) {
    throw "sessionMode must be isolated or host-login"
  }
  if ($sessionMode -eq "host-login" -and -not $EnableHostSession) {
    throw "host-login session mode is disabled for this broker"
  }
  if ($sessionMode -eq "isolated" -and $EnableHostSession) {
    throw "this broker requires sessionMode=host-login"
  }
  $requestedPath = Require-Text -Value (Get-PropertyValue $Request "executablePath") `
    -Field "executablePath" -MaximumLength 1024
  $discovery = Get-Discovery `
    -RequestedCodexPath $CodexPath `
    -RequestedAntigravityPath $AntigravityPath `
    -RequestedOpenCodePath $OpenCodePath
  $tool = @($discovery.tools | Where-Object { $_.id -eq $toolId }) | Select-Object -First 1
  if ($null -eq $tool) { throw "tool is not installed or discovered: $toolId" }
  $resolvedRequestedPath = Resolve-ExistingPath -Path $requestedPath -Field "executablePath" -PathType Leaf
  if (-not [string]::Equals($resolvedRequestedPath, $tool.executablePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "executable path is not the discovered registered path"
  }

  $configuredRoot = Resolve-ExistingPath -Path $WorkspaceRoot -Field "broker workspace root" -PathType Directory
  $requestRoot = Resolve-ExistingPath -Path (Require-Text (Get-PropertyValue $Request "workspaceRoot") "workspaceRoot" 1024) `
    -Field "workspaceRoot" -PathType Directory
  $workspacePath = Resolve-ExistingPath -Path (Require-Text (Get-PropertyValue $Request "workspacePath") "workspacePath" 1024) `
    -Field "workspacePath" -PathType Directory
  if (-not (Test-PathWithin -Root $configuredRoot -Candidate $requestRoot) -or
      -not (Test-PathWithin -Root $requestRoot -Candidate $workspacePath)) {
    throw "workspace path escapes the configured broker root"
  }

  $timeoutValue = Get-PropertyValue $Request "timeoutMs"
  if ($null -eq $timeoutValue -or $timeoutValue -isnot [int] -and $timeoutValue -isnot [long]) {
    throw "timeoutMs must be an integer"
  }
  if ($timeoutValue -lt 1 -or $timeoutValue -gt $script:MaxTimeoutMs) {
    throw "timeoutMs is outside the allowed range"
  }

  $argv = @()
  $rawArguments = Get-PropertyValue $Request "argv"
  if ($null -ne $rawArguments) {
    $argv = @($rawArguments)
  }
  if ($argv.Count -gt $script:MaxArgumentCount) { throw "too many arguments" }
  $normalizedArguments = @()
  foreach ($argument in $argv) {
    $normalized = Require-Text -Value $argument -Field "argv" -MaximumLength $script:MaxArgumentLength
    if ($script:BlockedArguments -contains $normalized) {
      throw "unsafe provider permission flag is forbidden"
    }
    $normalizedArguments += $normalized
  }

  $explicitSecretKeys = @()
  $rawSecretKeys = Get-PropertyValue $Request "explicitSecretKeys"
  if ($null -ne $rawSecretKeys) {
    foreach ($key in @($rawSecretKeys)) {
      $normalizedKey = Require-Text -Value $key -Field "explicitSecretKeys" -MaximumLength 128
      if ($EnvironmentAllowlist -notcontains $normalizedKey) {
        throw "explicit secret key is not allowlisted"
      }
      $explicitSecretKeys += $normalizedKey
    }
  }
  $environmentKeys = Assert-Environment `
    -Environment (Get-PropertyValue $Request "environment") `
    -ExplicitSecretKeys @($explicitSecretKeys)

  $networkHosts = @()
  $rawNetworkHosts = Get-PropertyValue $Request "allowedNetworkHosts"
  if ($null -ne $rawNetworkHosts) { $networkHosts = @($rawNetworkHosts) }
  if ($networkHosts.Count -gt 0) {
    throw "network access is disabled until the Windows proof is accepted"
  }

  return [ordered]@{
    version = "coderoom-broker-plan-v1"
    requestId = $RequestId
    platform = "windows"
    architecture = "x64"
    toolId = $toolId
    executablePath = $tool.executablePath
    cwd = $workspacePath
    argv = @($normalizedArguments)
    sessionMode = $sessionMode
    environmentKeys = @($environmentKeys)
    secretKeys = @($explicitSecretKeys | Select-Object -Unique)
    timeoutMs = [int]$timeoutValue
    shell = $false
    killProcessTree = $true
    allowedNetworkHosts = @()
    execution = if ($EnableExecution) { "enabled" } else { "disabled-until-windows-proof" }
  }
}

function ConvertTo-WindowsArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value -notmatch '[\s\"]') { return $Value }
  $backslashes = 0
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes++
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * ($backslashes * 2 + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes))
      $backslashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function New-ExecutionEnvironmentBlock {
  param(
    [Parameter(Mandatory = $true)]$Plan,
    [Parameter(Mandatory = $true)]$Request,
    [Parameter(Mandatory = $true)][bool]$HostSession
  )

  $workspaceHome = Join-Path $Plan.cwd ".coderoom-home"
  $profileRoot = if ($HostSession) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
      throw "USERPROFILE must be available for host-login session mode"
    }
    Resolve-ExistingPath -Path $env:USERPROFILE -Field "host user profile" -PathType Directory
  }
  else {
    $workspaceHome
  }
  $pathRoot = [System.IO.Path]::GetPathRoot($profileRoot)
  $homeDrive = if ($pathRoot -match '^[A-Za-z]:\\$') {
    $pathRoot.Substring(0, 2)
  }
  else {
    $pathRoot.TrimEnd('\')
  }
  $homePath = if ($profileRoot.StartsWith($homeDrive, [System.StringComparison]::OrdinalIgnoreCase)) {
    $profileRoot.Substring($homeDrive.Length)
  }
  else {
    $profileRoot
  }
  if ($HostSession) {
    $codexHome = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
      Join-Path $profileRoot ".codex"
    }
    else {
      Resolve-ExistingPath -Path $env:CODEX_HOME -Field "CODEX_HOME" -PathType Directory
    }
    $values = @{
      SystemRoot = $env:SystemRoot
      windir = $env:SystemRoot
      USERPROFILE = $profileRoot
      HOME = $profileRoot
      HOMEDRIVE = $homeDrive
      HOMEPATH = $homePath
      APPDATA = Join-Path $profileRoot "AppData\Roaming"
      LOCALAPPDATA = Join-Path $profileRoot "AppData\Local"
      CODEX_HOME = $codexHome
      ComSpec = $env:ComSpec
      Path = $env:Path
      PROCESSOR_ARCHITECTURE = "AMD64"
      TEMP = $env:TEMP
      TMP = $env:TMP
    }
  }
  else {
    $values = @{
      SystemRoot = $env:SystemRoot
      windir = $env:SystemRoot
      USERPROFILE = $workspaceHome
      HOME = $workspaceHome
      HOMEDRIVE = $homeDrive
      HOMEPATH = $homePath
      APPDATA = Join-Path $workspaceHome "AppData\Roaming"
      LOCALAPPDATA = Join-Path $workspaceHome "AppData\Local"
      CODEX_HOME = Join-Path $workspaceHome ".codex"
      ComSpec = $env:ComSpec
      Path = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
      PROCESSOR_ARCHITECTURE = "AMD64"
      TEMP = $Plan.cwd
      TMP = $Plan.cwd
    }
  }
  $rawEnvironment = Get-PropertyValue $Request "environment"
  if ($null -ne $rawEnvironment) {
    foreach ($property in $rawEnvironment.PSObject.Properties) {
      $values[$property.Name] = [string]$property.Value
    }
  }
  return New-EnvironmentBlock -Values $values
}

function Initialize-ExecutionHome {
  param(
    [Parameter(Mandatory = $true)]$Plan
  )

  $executionHomePath = Join-Path $Plan.cwd ".coderoom-home"
  $paths = @(
    $executionHomePath,
    (Join-Path $executionHomePath ".codex"),
    (Join-Path $executionHomePath "AppData\Roaming"),
    (Join-Path $executionHomePath "AppData\Local")
  )
  $existed = Test-Path -LiteralPath $executionHomePath
  foreach ($path in $paths) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
  return [ordered]@{
    path = $executionHomePath
    created = -not $existed
  }
}

function Add-ExecutionAcl {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Sid,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemRights]$Rights,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.InheritanceFlags]$Inheritance,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.PropagationFlags]$Propagation
  )
  Add-RestrictedAccessRule -Path $Path -Sid $Sid -Rights $Rights -Inheritance $Inheritance -Propagation $Propagation
  return $true
}

function Write-NdjsonFrame {
  param(
    [Parameter(Mandatory = $true)]$Response,
    [Parameter(Mandatory = $true)]$Frame
  )
  $line = (($Frame | ConvertTo-Json -Compress -Depth 8) + "`n")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($line)
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Flush()
}

function Write-ExecutionDiagnostic {
  param(
    [Parameter(Mandatory = $true)][string]$Phase,
    [string]$Detail = ""
  )
  $timestamp = [DateTime]::UtcNow.ToString("o")
  $safeDetail = $Detail.Replace("`r", " ").Replace("`n", " ")
  Add-Content -LiteralPath $script:ExecutionDiagnosticPath -Value "$timestamp`t$Phase`t$safeDetail"
}

function Invoke-BrokerExecution {
  param(
    [Parameter(Mandatory = $true)]$Context,
    [Parameter(Mandatory = $true)]$Request,
    [Parameter(Mandatory = $true)][string]$RequestId
  )

  if (-not $EnableExecution) {
    Write-JsonResponse -Context $Context -StatusCode 409 -Payload ([ordered]@{
        version = "coderoom-broker-v1"
        requestId = $RequestId
        error = "execution-disabled-until-windows-proof"
      })
    return
  }

  $plan = New-ExecutionPlan -Request $Request -RequestId $RequestId
  # A request may be retried with the same requestId. AppContainer profile
  # names are global on the host, so retries must never reuse the profile name.
  $hostSession = $plan.sessionMode -eq "host-login"
  $profileName = if ($hostSession) { $null } else { "CodeRoomExec-$([guid]::NewGuid().ToString('N'))" }
  $sidPointer = [IntPtr]::Zero
  $sid = $null
  $job = [IntPtr]::Zero
  $process = $null
  $aclPaths = [System.Collections.Generic.List[object]]::new()
  $response = $Context.Response
  $responseStarted = $false
  $executionHome = $null
  $executionHomeCreated = $false
  try {
    Write-ExecutionDiagnostic -Phase "request-start" -Detail $RequestId
    if ($hostSession) {
      Write-ExecutionDiagnostic -Phase "host-session-selected"
    }
    else {
      $sidPointer = [CodeRoom.NativeProof]::CreateAppContainerProfileSid($profileName)
      Write-ExecutionDiagnostic -Phase "appcontainer-created"
      $sid = [CodeRoom.NativeProof]::CreateSecurityIdentifier($sidPointer)

      Write-ExecutionDiagnostic -Phase "workspace-acl-start"
      Add-ExecutionAcl -Path $plan.cwd -Sid $sid `
        -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl) `
        -Inheritance ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) `
        -Propagation ([System.Security.AccessControl.PropagationFlags]::None) | Out-Null
      $aclPaths.Add(@(
          $plan.cwd,
          [System.Security.AccessControl.FileSystemRights]::FullControl,
          ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
          [System.Security.AccessControl.PropagationFlags]::None
        ))
      Write-ExecutionDiagnostic -Phase "workspace-acl-complete"

      $homeInfo = Initialize-ExecutionHome -Plan $plan
      $executionHome = [string]$homeInfo.path
      $executionHomeCreated = [bool]$homeInfo.created
      Write-ExecutionDiagnostic -Phase "execution-home-ready" -Detail $executionHome

      $binaryDirectory = Split-Path -Parent $plan.executablePath
      Write-ExecutionDiagnostic -Phase "binary-acl-start" -Detail $binaryDirectory
      Add-ExecutionAcl -Path $binaryDirectory -Sid $sid `
        -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute) `
        -Inheritance ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) `
        -Propagation ([System.Security.AccessControl.PropagationFlags]::None) | Out-Null
      $aclPaths.Add(@(
          $binaryDirectory,
          [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
          ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
          [System.Security.AccessControl.PropagationFlags]::None
        ))
      Write-ExecutionDiagnostic -Phase "binary-acl-complete"
    }

    $memoryLimitMb = Get-ExecutionMemoryLimitMb -ToolId $plan.toolId
    $memoryLimitBytes = [uint64]$memoryLimitMb * 1MB
    $job = [CodeRoom.NativeProof]::CreateConstrainedJob($memoryLimitBytes, 16)
    Write-ExecutionDiagnostic -Phase "job-created" -Detail ("memory=" + $memoryLimitMb + "MB")
    $response.StatusCode = 200
    $response.ContentType = "application/x-ndjson; charset=utf-8"
    $response.Headers.Add("Cache-Control", "no-store")
    $response.Headers.Add("X-Content-Type-Options", "nosniff")
    $responseStarted = $true
    $arguments = @($plan.argv | ForEach-Object { ConvertTo-WindowsArgument -Value $_ })
    $commandLine = (ConvertTo-WindowsArgument -Value $plan.executablePath) + $(if ($arguments.Count) { " " + ($arguments -join " ") } else { "" })
    Write-ExecutionDiagnostic -Phase "command-ready" -Detail $commandLine
    $environmentBlock = New-ExecutionEnvironmentBlock -Plan $plan -Request $Request -HostSession $hostSession
    $environmentKeys = @(([regex]::Split($environmentBlock, [char]0)) | Where-Object { $_ } | ForEach-Object { ($_ -split "=", 2)[0] })
    Write-ExecutionDiagnostic -Phase "environment-ready" -Detail (($environmentKeys -join ",") + ";length=" + $environmentBlock.Length)
    if ($hostSession) {
      $process = [CodeRoom.NativeProof]::LaunchHostProcessWithStdout(
        $job,
        $plan.executablePath,
        $commandLine,
        $plan.cwd,
        $environmentBlock
      )
    }
    else {
      $process = [CodeRoom.NativeProof]::LaunchInAppContainerWithStdout(
        $job,
        $plan.executablePath,
        $commandLine,
        $plan.cwd,
        $environmentBlock,
        $sidPointer
      )
    }
    Write-ExecutionDiagnostic -Phase "process-launched" -Detail (
      ([string]$process.ProcessId) + $(if ($hostSession) { ";host-session" } else { ";appcontainer" })
    )
    $stdoutHandle = $process.StdoutReadHandle
    $process.StdoutReadHandle = [IntPtr]::Zero
    $stderrHandle = $process.StderrReadHandle
    $process.StderrReadHandle = [IntPtr]::Zero
    $outputTask = [CodeRoom.NativeProof]::ReadPipeToEndAsync($stdoutHandle)
    $errorTask = [CodeRoom.NativeProof]::ReadPipeToEndAsync($stderrHandle)
    Write-ExecutionDiagnostic -Phase "stdout-reading"
    $deadline = [DateTime]::UtcNow.AddMilliseconds($plan.timeoutMs)
    while (-not $outputTask.IsCompleted -or -not $errorTask.IsCompleted) {
      if ([DateTime]::UtcNow -ge $deadline) {
        [CodeRoom.NativeProof]::TerminateJob($job, 124)
        Write-ExecutionDiagnostic -Phase "timeout"
        [void]$outputTask.Wait(2000)
        [void]$errorTask.Wait(2000)
        Write-NdjsonFrame -Response $response -Frame ([ordered]@{ type = "completed"; exitCode = $null; status = "timed_out" })
        return
      }
      Start-Sleep -Milliseconds 25
    }
    $output = $outputTask.GetAwaiter().GetResult()
    $errorOutput = $errorTask.GetAwaiter().GetResult()
    Write-ExecutionDiagnostic -Phase "stdout-complete" -Detail ([string]$output.Length)
    if ([Text.Encoding]::UTF8.GetByteCount($output) -gt $script:MaxStreamBytes) {
      [CodeRoom.NativeProof]::TerminateJob($job, 1)
      throw "broker execution output exceeds the maximum size"
    }
    $exitCode = [CodeRoom.NativeProof]::GetExitCode([IntPtr]$process.ProcessHandle)
    if (-not [string]::IsNullOrEmpty($output)) {
      Write-NdjsonFrame -Response $response -Frame ([ordered]@{ type = "stdout"; data = $output })
    }
    if (-not [string]::IsNullOrEmpty($errorOutput)) {
      Write-NdjsonFrame -Response $response -Frame ([ordered]@{ type = "stderr"; data = $errorOutput })
    }
    Write-NdjsonFrame -Response $response -Frame ([ordered]@{
        type = "completed"
        exitCode = [int]$exitCode
        status = if ($exitCode -eq 0) { "succeeded" } else { "failed" }
      })
  }
  catch {
    Write-ExecutionDiagnostic -Phase "failed" -Detail $_.Exception.ToString()
    Write-Host ("Broker execution failed: " + $_.Exception.Message)
    if ($responseStarted) {
      try {
        Write-NdjsonFrame -Response $response -Frame ([ordered]@{
            type = "completed"
            exitCode = $null
            status = "failed"
            error = "broker-execution-failed"
          })
      }
      catch { }
    }
  }
  finally {
    Write-ExecutionDiagnostic -Phase "cleanup-start"
    if ($job -ne [IntPtr]::Zero) { [CodeRoom.NativeProof]::Close($job) }
    if ($null -ne $process) {
      [CodeRoom.NativeProof]::Close($process.ThreadHandle)
      [CodeRoom.NativeProof]::Close($process.ProcessHandle)
    }
    foreach ($acl in $aclPaths) {
      Remove-RestrictedAccessRule `
        -Path ([string]$acl[0]) `
        -Sid $sid `
        -Rights ([System.Security.AccessControl.FileSystemRights]$acl[1]) `
        -Inheritance ([System.Security.AccessControl.InheritanceFlags]$acl[2]) `
        -Propagation ([System.Security.AccessControl.PropagationFlags]$acl[3])
    }
    if ($executionHomeCreated -and $null -ne $executionHome -and (Test-Path -LiteralPath $executionHome)) {
      Remove-Item -LiteralPath $executionHome -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($sidPointer -ne [IntPtr]::Zero) {
      [CodeRoom.NativeProof]::FreeSid($sidPointer)
      [CodeRoom.NativeProof]::DeleteAppContainerProfileByName($profileName)
    }
    $response.Close()
    Write-ExecutionDiagnostic -Phase "cleanup-complete"
  }
}

function Handle-Request {
  param([Parameter(Mandatory = $true)]$Context)

  Assert-Authorization -Request $Context.Request
  $path = $Context.Request.Url.AbsolutePath
  $method = $Context.Request.HttpMethod.ToUpperInvariant()
  if ($method -eq "GET" -and $path -eq "/health") {
    Write-JsonResponse -Context $Context -StatusCode 200 -Payload ([ordered]@{
        version = "coderoom-broker-v1"
        platform = "windows"
        architecture = "x64"
        execution = if ($EnableExecution) { "enabled" } else { "disabled-until-windows-proof" }
        sessionMode = if ($EnableHostSession) { "host-login" } else { "isolated" }
      })
    return
  }

  if ($method -ne "POST") {
    Write-JsonResponse -Context $Context -StatusCode 405 -Payload @{ error = "method-not-allowed" }
    return
  }

  $body = Read-JsonBody -Request $Context.Request
  $requestIdValue = Get-PropertyValue $body "requestId"
  $requestId = if ($null -eq $requestIdValue) { [guid]::NewGuid().ToString("N") } `
    else { Require-Text -Value $requestIdValue -Field "requestId" -MaximumLength 128 }

  if ($path -eq "/v1/discover") {
    $result = Get-Discovery `
      -RequestedCodexPath (Get-PropertyValue $body "codexPath") `
      -RequestedAntigravityPath (Get-PropertyValue $body "antigravityPath") `
      -RequestedOpenCodePath (Get-PropertyValue $body "opencodePath")
    $result["requestId"] = $requestId
    Write-JsonResponse -Context $Context -StatusCode 200 -Payload $result
    return
  }

  if ($path -eq "/v1/plan") {
    $plan = New-ExecutionPlan -Request $body -RequestId $requestId
    Write-JsonResponse -Context $Context -StatusCode 200 -Payload $plan
    return
  }

  if ($path -eq "/v1/execute") {
    Invoke-BrokerExecution -Context $Context -Request $body -RequestId $requestId
    return
  }

  Write-JsonResponse -Context $Context -StatusCode 404 -Payload @{ error = "not-found" }
}

if ($env:OS -ne "Windows_NT") {
  throw "The Windows host broker must run on Windows"
}
if ([string]::IsNullOrWhiteSpace($AuthToken) -or $AuthToken.Length -lt 32) {
  throw "CODEROOM_BROKER_TOKEN must be provided and contain at least 32 characters"
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  throw "CODEROOM_WINDOWS_WORKSPACE_ROOT must be provided"
}
if ($EnableHostSession -and -not $EnableExecution) {
  throw "Host login session requires -EnableExecution"
}
if ($ListenAddress -ne "127.0.0.1") {
  throw "The Windows broker only supports loopback binding"
}

$resolvedBrokerRoot = Resolve-ExistingPath -Path $WorkspaceRoot -Field "workspace root" -PathType Directory
. (Join-Path $PSScriptRoot "prove-windows-native.ps1") -WorkspaceRoot $resolvedBrokerRoot -LibraryOnly

$prefix = "http://$ListenAddress`:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "CodeRoom Windows broker listening on $prefix"
Write-Host $(if ($EnableExecution) { "Execution enabled behind the native Windows proof gate." } else { "Execution is disabled until the Windows confinement proof is accepted." })

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      Handle-Request -Context $context
    }
    catch {
      try {
        $unauthorized = $_.Exception.Message -eq "unauthorized"
        $errorPayload = [ordered]@{
          version = "coderoom-broker-v1"
          error = if ($unauthorized) { "unauthorized" } else { "request-rejected" }
        }
        if (-not $unauthorized) { $errorPayload["detail"] = $_.Exception.Message }
        Write-JsonResponse -Context $context `
          -StatusCode $(if ($unauthorized) { 401 } else { 400 }) `
          -Payload $errorPayload
      }
      catch {
        $context.Response.Abort()
      }
    }
  }
}
finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
