[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,
  [ValidateRange(1000, 30000)]
  [int]$TimeoutMs = 5000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "The Windows stdout proof must run on Windows"
}
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
  throw "The Windows stdout proof requires an x64 PowerShell process"
}

$proofScript = Join-Path $PSScriptRoot "prove-windows-native.ps1"
. $proofScript -WorkspaceRoot $WorkspaceRoot -LibraryOnly

$proofId = [guid]::NewGuid().ToString("N")
$root = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
$probeRoot = Join-Path $root ".coderoom-stdout-$proofId"
$batchPath = Join-Path $probeRoot "stdout.cmd"
$profileName = "CodeRoomStdout-$proofId"
$appContainerSidPointer = [IntPtr]::Zero
$appContainerSid = $null
$job = [IntPtr]::Zero
$process = $null
$rootRuleAdded = $false
$probeRuleAdded = $false
$stream = $null
$reader = $null
$safeHandle = $null
$errors = New-Object System.Collections.Generic.List[string]

$result = [ordered]@{
  version = "coderoom-windows-stdout-proof-v1"
  status = "refused"
  appContainer = $false
  outputRedirected = $false
  processTreeBound = $false
  exitCode = $null
  output = $null
  errors = @()
}

try {
  New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
  $batch = "@echo off`r`necho {`"type`":`"stdout-proof`",`"workspace`":`"$proofId`"}`r`n"
  [IO.File]::WriteAllText(
    $batchPath,
    $batch,
    [Text.Encoding]::ASCII
  )

  $appContainerSidPointer = [CodeRoom.NativeProof]::CreateAppContainerProfileSid($profileName)
  $appContainerSid = [CodeRoom.NativeProof]::CreateSecurityIdentifier($appContainerSidPointer)
  Add-RestrictedAccessRule `
    -Path $root `
    -Sid $appContainerSid `
    -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute) `
    -Inheritance ([System.Security.AccessControl.InheritanceFlags]::None) `
    -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  $rootRuleAdded = $true
  Add-RestrictedAccessRule `
    -Path $probeRoot `
    -Sid $appContainerSid `
    -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl) `
    -Inheritance ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) `
    -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  $probeRuleAdded = $true

  $job = [CodeRoom.NativeProof]::CreateConstrainedJob(64MB, 8)
  $environment = @{
    SystemRoot = $env:SystemRoot
    windir = $env:SystemRoot
    LOCALAPPDATA = $env:LOCALAPPDATA
    ComSpec = $env:ComSpec
    Path = "$env:SystemRoot\System32;$env:SystemRoot"
    PROCESSOR_ARCHITECTURE = "AMD64"
    TEMP = $probeRoot
    TMP = $probeRoot
  }
  $environmentBlock = New-EnvironmentBlock -Values $environment
  $commandLine = '"{0}" /d /c ""{1}""' -f $env:ComSpec, $batchPath
  $process = [CodeRoom.NativeProof]::LaunchInAppContainerWithStdout(
    $job,
    $env:ComSpec,
    $commandLine,
    $probeRoot,
    $environmentBlock,
    $appContainerSidPointer
  )
  $result.appContainer = [CodeRoom.NativeProof]::IsProcessAppContainer($process.ProcessHandle)
  $result.processTreeBound = $true

  $safeHandle = New-Object Microsoft.Win32.SafeHandles.SafeFileHandle(
    $process.StdoutReadHandle,
    $true
  )
  $process.StdoutReadHandle = [IntPtr]::Zero
  if ($process.StderrReadHandle -ne [IntPtr]::Zero) {
    [CodeRoom.NativeProof]::Close($process.StderrReadHandle)
    $process.StderrReadHandle = [IntPtr]::Zero
  }
  # CreatePipe returns a synchronous handle; the final argument must not mark
  # it as usable for overlapped/asynchronous I/O.
  $stream = New-Object System.IO.FileStream($safeHandle, [IO.FileAccess]::Read, 4096, $false)
  $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::UTF8, $false, 4096, $true)

  $completed = [CodeRoom.NativeProof]::Wait($process.ProcessHandle, [uint32]$TimeoutMs)
  if (-not $completed) {
    throw "stdout proof process exceeded its timeout"
  }
  $result.exitCode = [CodeRoom.NativeProof]::GetExitCode($process.ProcessHandle)
  $result.output = $reader.ReadToEnd()
  $result.outputRedirected = $result.output.Contains("stdout-proof") -and $result.exitCode -eq 0
  if (-not $result.appContainer) { $errors.Add("process was not an AppContainer") }
  if (-not $result.outputRedirected) { $errors.Add("stdout was not redirected") }
  if (-not $result.processTreeBound) { $errors.Add("process was not attached to the Job Object") }
  if ($errors.Count -eq 0) { $result.status = "passed" }
}
catch {
  $errors.Add($_.Exception.Message)
}
finally {
  if ($null -ne $reader) { $reader.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
  if ($null -ne $safeHandle) { $safeHandle.Dispose() }
  if ($job -ne [IntPtr]::Zero) {
    [CodeRoom.NativeProof]::Close($job)
    $job = [IntPtr]::Zero
  }
  if ($null -ne $process) {
    [CodeRoom.NativeProof]::Close($process.ThreadHandle)
    [CodeRoom.NativeProof]::Close($process.ProcessHandle)
  }
  if ($probeRuleAdded) {
    Remove-RestrictedAccessRule `
      -Path $probeRoot `
      -Sid $appContainerSid `
      -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl) `
      -Inheritance ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) `
      -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  }
  if ($rootRuleAdded) {
    Remove-RestrictedAccessRule `
      -Path $root `
      -Sid $appContainerSid `
      -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute) `
      -Inheritance ([System.Security.AccessControl.InheritanceFlags]::None) `
      -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  }
  if ($appContainerSidPointer -ne [IntPtr]::Zero) {
    [CodeRoom.NativeProof]::FreeSid($appContainerSidPointer)
  }
  [CodeRoom.NativeProof]::DeleteAppContainerProfileByName($profileName)
  Remove-Item -LiteralPath $probeRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$result.errors = @($errors)
$result | ConvertTo-Json -Compress -Depth 8
if ($result.status -ne "passed") { exit 1 }
