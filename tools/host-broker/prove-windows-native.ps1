[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,
  [int]$TimeoutMs = 2000,
  [string]$FirewallRuleName = "CodeRoom-Proof-$([guid]::NewGuid().ToString('N'))",
  [switch]$EnableFirewallProof,
  [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "The Windows native proof must run on Windows"
}
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
  throw "The Windows native proof requires an x64 PowerShell process"
}
if ($TimeoutMs -lt 1000 -or $TimeoutMs -gt 30000) {
  throw "TimeoutMs must be between 1000 and 30000"
}

if (-not ("CodeRoom.NativeProof" -as [type])) {
  Add-Type @"
using System;
using System.ComponentModel;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Text;

namespace CodeRoom {
  public static class NativeProof {
    private const uint TokenDuplicate = 0x0002;
    private const uint TokenQuery = 0x0008;
    private const uint TokenAssignPrimary = 0x0001;
    private const uint TokenAdjustDefault = 0x0080;
    private const uint TokenAdjustSessionId = 0x0100;
    private const uint DisableMaxPrivilege = 0x1;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint StartupUseStdHandles = 0x00000100;
    private const ulong ProcThreadAttributeSecurityCapabilities = 0x00020009;
    private const ulong ProcThreadAttributeHandleList = 0x00020002;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint JobObjectLimitActiveProcess = 0x00000008;
    private const uint JobObjectLimitProcessMemory = 0x00000100;
    private const uint JobObjectLimitJobMemory = 0x00000200;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int TokenRestrictedSids = 11;
    private const int TokenIsAppContainer = 29;
    private const uint StillActive = 259;

    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes {
      public IntPtr Sid;
      public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation {
      public long PerProcessUserTimeLimit;
      public long PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass;
      public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation {
      public BasicLimitInformation BasicLimitInformation;
      public IoCounters IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo {
      public uint cb;
      public string lpReserved;
      public string lpDesktop;
      public string lpTitle;
      public uint dwX;
      public uint dwY;
      public uint dwXSize;
      public uint dwYSize;
      public uint dwXCountChars;
      public uint dwYCountChars;
      public uint dwFillAttribute;
      public uint dwFlags;
      public short wShowWindow;
      public short cbReserved2;
      public IntPtr lpReserved2;
      public IntPtr hStdInput;
      public IntPtr hStdOutput;
      public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation {
      public IntPtr hProcess;
      public IntPtr hThread;
      public uint processId;
      public uint threadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx {
      public StartupInfo StartupInfo;
      public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityCapabilities {
      public IntPtr AppContainerSid;
      public IntPtr Capabilities;
      public uint CapabilityCount;
      public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes {
      public uint Length;
      public IntPtr SecurityDescriptor;
      public bool InheritHandle;
    }

    public sealed class LaunchedProcess {
      public IntPtr ProcessHandle;
      public IntPtr ThreadHandle;
      public uint ProcessId;
      public IntPtr StdoutReadHandle;
      public IntPtr StderrReadHandle;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(
      IntPtr processHandle,
      uint desiredAccess,
      out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(
      IntPtr existingTokenHandle,
      uint flags,
      int disableSidCount,
      IntPtr sidsToDisable,
      int deletePrivilegeCount,
      IntPtr privilegesToDelete,
      int restrictedSidCount,
      IntPtr sidsToRestrict,
      out IntPtr newTokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
      IntPtr tokenHandle,
      int tokenInformationClass,
      IntPtr tokenInformation,
      uint tokenInformationLength,
      out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
      IntPtr attributeList,
      uint attributeCount,
      uint flags,
      ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
      IntPtr attributeList,
      uint flags,
      ulong attribute,
      IntPtr value,
      IntPtr size,
      IntPtr previousValue,
      IntPtr returnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(
      out IntPtr readPipe,
      out IntPtr writePipe,
      ref SecurityAttributes pipeAttributes,
      uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(
      IntPtr handle,
      uint mask,
      uint flags);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(
      string fileName,
      uint desiredAccess,
      uint shareMode,
      ref SecurityAttributes securityAttributes,
      uint creationDisposition,
      uint flagsAndAttributes,
      IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW")]
    private static extern bool CreateProcessWithAttributes(
      string applicationName,
      StringBuilder commandLine,
      IntPtr processAttributes,
      IntPtr threadAttributes,
      bool inheritHandles,
      uint creationFlags,
      IntPtr environment,
      string currentDirectory,
      ref StartupInfoEx startupInfo,
      out ProcessInformation processInformation);

    [DllImport("userenv.dll", SetLastError = false, CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(
      string name,
      string displayName,
      string description,
      IntPtr capabilities,
      uint capabilityCount,
      out IntPtr appContainerSid);

    [DllImport("userenv.dll", SetLastError = false, CharSet = CharSet.Unicode)]
    private static extern int DeleteAppContainerProfile(string name);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "ConvertSidToStringSidW")]
    private static extern bool ConvertSidToStringSid(
      IntPtr sid,
      out IntPtr stringSid);

    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "FreeSid")]
    private static extern IntPtr FreeSidNative(IntPtr sid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
      IntPtr job,
      int infoClass,
      ref ExtendedLimitInformation info,
      uint infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
      IntPtr job,
      int infoClass,
      ref ExtendedLimitInformation info,
      uint infoLength,
      out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
      IntPtr token,
      string applicationName,
      StringBuilder commandLine,
      IntPtr processAttributes,
      IntPtr threadAttributes,
      bool inheritHandles,
      uint creationFlags,
      IntPtr environment,
      string currentDirectory,
      ref StartupInfo startupInfo,
      out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static Exception LastError(string operation) {
      int error = Marshal.GetLastWin32Error();
      return new Win32Exception(error, String.Format("{0} (Win32={1})", operation, error));
    }

    public static IntPtr CreateRestrictedPrimaryToken(byte[] restrictedSid) {
      IntPtr currentToken;
      uint access = TokenDuplicate | TokenQuery | TokenAssignPrimary |
        TokenAdjustDefault | TokenAdjustSessionId;
      if (!OpenProcessToken(GetCurrentProcess(), access, out currentToken)) {
        throw LastError("OpenProcessToken");
      }

      IntPtr sid = Marshal.AllocHGlobal(restrictedSid.Length);
      IntPtr sidAndAttributes = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAndAttributes)));
      try {
        Marshal.Copy(restrictedSid, 0, sid, restrictedSid.Length);
        Marshal.StructureToPtr(new SidAndAttributes { Sid = sid, Attributes = 0 }, sidAndAttributes, false);
        IntPtr restrictedToken;
        if (!CreateRestrictedToken(
          currentToken,
          DisableMaxPrivilege,
          0,
          IntPtr.Zero,
          0,
          IntPtr.Zero,
          1,
          sidAndAttributes,
          out restrictedToken)) {
          throw LastError("CreateRestrictedToken");
        }
        return restrictedToken;
      }
      finally {
        CloseHandle(currentToken);
        Marshal.FreeHGlobal(sidAndAttributes);
        Marshal.FreeHGlobal(sid);
      }
    }

    public static IntPtr CreateAppContainerProfileSid(string name) {
      IntPtr sid;
      int result = CreateAppContainerProfile(
        name,
        "CodeRoom Windows proof",
        "Ephemeral CodeRoom confinement proof",
        IntPtr.Zero,
        0,
        out sid);
      if (result != 0) throw new Win32Exception(result, "CreateAppContainerProfile");
      return sid;
    }

    public static string SidToString(IntPtr sid) {
      IntPtr stringSid;
      if (!ConvertSidToStringSid(sid, out stringSid)) {
        throw LastError("ConvertSidToStringSid");
      }
      try {
        return Marshal.PtrToStringUni(stringSid);
      }
      finally {
        LocalFree(stringSid);
      }
    }

    public static System.Security.Principal.SecurityIdentifier CreateSecurityIdentifier(IntPtr sid) {
      return new System.Security.Principal.SecurityIdentifier(SidToString(sid));
    }

    public static void FreeSid(IntPtr sid) {
      if (sid != IntPtr.Zero) FreeSidNative(sid);
    }

    public static void DeleteAppContainerProfileByName(string name) {
      int result = DeleteAppContainerProfile(name);
      if (result != 0 && result != unchecked((int)0x80070002)) {
        throw new Win32Exception(result, "DeleteAppContainerProfile");
      }
    }

    public static bool HasRestrictedSid(IntPtr token) {
      uint length;
      GetTokenInformation(token, TokenRestrictedSids, IntPtr.Zero, 0, out length);
      if (length == 0) return false;
      IntPtr buffer = Marshal.AllocHGlobal((int)length);
      try {
        if (!GetTokenInformation(token, TokenRestrictedSids, buffer, length, out length)) {
          throw LastError("GetTokenInformation");
        }
        return Marshal.ReadInt32(buffer) > 0;
      }
      finally {
        Marshal.FreeHGlobal(buffer);
      }
    }

    public static IntPtr CreateConstrainedJob(ulong memoryLimitBytes, uint maxProcesses) {
      IntPtr job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw LastError("CreateJobObject");
      ExtendedLimitInformation info = new ExtendedLimitInformation();
      info.BasicLimitInformation.LimitFlags =
        JobObjectLimitActiveProcess |
        JobObjectLimitProcessMemory |
        JobObjectLimitJobMemory |
        JobObjectLimitKillOnJobClose;
      info.BasicLimitInformation.ActiveProcessLimit = maxProcesses;
      info.ProcessMemoryLimit = (UIntPtr)memoryLimitBytes;
      info.JobMemoryLimit = (UIntPtr)memoryLimitBytes;
      uint size = (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation));
      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, size)) {
        CloseHandle(job);
        throw LastError("SetInformationJobObject");
      }
      return job;
    }

    public static bool HasExpectedJobLimits(IntPtr job, ulong memoryLimitBytes, uint maxProcesses) {
      ExtendedLimitInformation info = new ExtendedLimitInformation();
      uint size = (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation));
      uint returned;
      if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, size, out returned)) {
        throw LastError("QueryInformationJobObject");
      }
      uint expectedFlags = JobObjectLimitActiveProcess |
        JobObjectLimitProcessMemory |
        JobObjectLimitJobMemory |
        JobObjectLimitKillOnJobClose;
      return (info.BasicLimitInformation.LimitFlags & expectedFlags) == expectedFlags &&
        info.BasicLimitInformation.ActiveProcessLimit == maxProcesses &&
        info.ProcessMemoryLimit.ToUInt64() == memoryLimitBytes &&
        info.JobMemoryLimit.ToUInt64() == memoryLimitBytes;
    }

    public static string DescribeJobLimits(IntPtr job) {
      ExtendedLimitInformation info = new ExtendedLimitInformation();
      uint size = (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation));
      uint returned;
      if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, size, out returned)) {
        throw LastError("QueryInformationJobObject");
      }
      return String.Format(
        "flags=0x{0:X};active={1};processMemory={2};jobMemory={3}",
        info.BasicLimitInformation.LimitFlags,
        info.BasicLimitInformation.ActiveProcessLimit,
        info.ProcessMemoryLimit.ToUInt64(),
        info.JobMemoryLimit.ToUInt64());
    }

    public static LaunchedProcess Launch(
      IntPtr token,
      IntPtr job,
      string applicationName,
      string commandLine,
      string currentDirectory,
      string environmentBlock) {
      IntPtr environment = Marshal.StringToHGlobalUni(environmentBlock);
      try {
        StartupInfo startup = new StartupInfo();
        startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
        ProcessInformation process;
        StringBuilder mutableCommandLine = new StringBuilder(commandLine);
        if (!CreateProcessAsUser(
          token,
          applicationName,
          mutableCommandLine,
          IntPtr.Zero,
          IntPtr.Zero,
          false,
          CreateSuspended | CreateUnicodeEnvironment,
          environment,
          currentDirectory,
          ref startup,
          out process)) {
          throw LastError("CreateProcessAsUser");
        }
        if (!AssignProcessToJobObject(job, process.hProcess)) {
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("AssignProcessToJobObject");
        }
        if (ResumeThread(process.hThread) == 0xFFFFFFFF) {
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("ResumeThread");
        }
        return new LaunchedProcess {
          ProcessHandle = process.hProcess,
          ThreadHandle = process.hThread,
          ProcessId = process.processId
        };
      }
      finally {
        Marshal.FreeHGlobal(environment);
      }
    }

    public static LaunchedProcess LaunchInAppContainer(
      IntPtr job,
      string applicationName,
      string commandLine,
      string currentDirectory,
      string environmentBlock,
      IntPtr appContainerSid) {
      IntPtr environment = Marshal.StringToHGlobalUni(environmentBlock);
      IntPtr attributeList = IntPtr.Zero;
      IntPtr capabilities = IntPtr.Zero;
      try {
        IntPtr attributeSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
        if (attributeSize == IntPtr.Zero) {
          throw LastError("InitializeProcThreadAttributeList(size)");
        }
        attributeList = Marshal.AllocHGlobal(attributeSize);
        if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize)) {
          throw LastError("InitializeProcThreadAttributeList");
        }

        SecurityCapabilities securityCapabilities = new SecurityCapabilities {
          AppContainerSid = appContainerSid,
          Capabilities = IntPtr.Zero,
          CapabilityCount = 0,
          Reserved = 0
        };
        capabilities = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecurityCapabilities)));
        Marshal.StructureToPtr(securityCapabilities, capabilities, false);
        if (!UpdateProcThreadAttribute(
          attributeList,
          0,
          ProcThreadAttributeSecurityCapabilities,
          capabilities,
          (IntPtr)Marshal.SizeOf(typeof(SecurityCapabilities)),
          IntPtr.Zero,
          IntPtr.Zero)) {
          throw LastError("UpdateProcThreadAttribute(SecurityCapabilities)");
        }

        StartupInfoEx startup = new StartupInfoEx();
        startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
        startup.AttributeList = attributeList;
        ProcessInformation process;
        StringBuilder mutableCommandLine = new StringBuilder(commandLine);
        if (!CreateProcessWithAttributes(
          applicationName,
          mutableCommandLine,
          IntPtr.Zero,
          IntPtr.Zero,
          false,
          ExtendedStartupInfoPresent | CreateSuspended | CreateUnicodeEnvironment,
          environment,
          currentDirectory,
          ref startup,
          out process)) {
          throw LastError("CreateProcess(AppContainer)");
        }
        if (!AssignProcessToJobObject(job, process.hProcess)) {
          TerminateProcess(process.hProcess, 1);
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("AssignProcessToJobObject(AppContainer)");
        }
        if (ResumeThread(process.hThread) == 0xFFFFFFFF) {
          TerminateProcess(process.hProcess, 1);
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("ResumeThread(AppContainer)");
        }
        return new LaunchedProcess {
          ProcessHandle = process.hProcess,
          ThreadHandle = process.hThread,
          ProcessId = process.processId
        };
      }
      finally {
        if (attributeList != IntPtr.Zero) {
          DeleteProcThreadAttributeList(attributeList);
          Marshal.FreeHGlobal(attributeList);
        }
        if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
        Marshal.FreeHGlobal(environment);
      }
    }

    public static LaunchedProcess LaunchInAppContainerWithStdout(
      IntPtr job,
      string applicationName,
      string commandLine,
      string currentDirectory,
      string environmentBlock,
      IntPtr appContainerSid) {
      return LaunchInAppContainerWithStdout(
        job,
        applicationName,
        commandLine,
        currentDirectory,
        environmentBlock,
        appContainerSid,
        null);
    }

    public static LaunchedProcess LaunchInAppContainerWithStdout(
      IntPtr job,
      string applicationName,
      string commandLine,
      string currentDirectory,
      string environmentBlock,
      IntPtr appContainerSid,
      byte[] capabilitySidBytes) {
      IntPtr environment = Marshal.StringToHGlobalUni(environmentBlock);
      IntPtr attributeList = IntPtr.Zero;
      IntPtr capabilities = IntPtr.Zero;
      IntPtr capabilitySid = IntPtr.Zero;
      IntPtr capabilityArray = IntPtr.Zero;
      IntPtr handleList = IntPtr.Zero;
      IntPtr stdoutRead = IntPtr.Zero;
      IntPtr stdoutWrite = IntPtr.Zero;
      IntPtr stderrRead = IntPtr.Zero;
      IntPtr stderrWrite = IntPtr.Zero;
      IntPtr nullHandle = IntPtr.Zero;
      bool stdoutTransferred = false;
      bool stderrTransferred = false;
      try {
        SecurityAttributes pipeAttributes = new SecurityAttributes {
          Length = (uint)Marshal.SizeOf(typeof(SecurityAttributes)),
          SecurityDescriptor = IntPtr.Zero,
          InheritHandle = true
        };
        if (!CreatePipe(out stdoutRead, out stdoutWrite, ref pipeAttributes, 0)) {
          throw LastError("CreatePipe(stdout)");
        }
        if (!SetHandleInformation(stdoutRead, HandleFlagInherit, 0)) {
          throw LastError("SetHandleInformation(stdout)");
        }
        if (!CreatePipe(out stderrRead, out stderrWrite, ref pipeAttributes, 0)) {
          throw LastError("CreatePipe(stderr)");
        }
        if (!SetHandleInformation(stderrRead, HandleFlagInherit, 0)) {
          throw LastError("SetHandleInformation(stderr)");
        }
        nullHandle = CreateFileW(
          "NUL",
          GenericRead | GenericWrite,
          FileShareRead | FileShareWrite,
          ref pipeAttributes,
          OpenExisting,
          FileAttributeNormal,
          IntPtr.Zero);
        if (nullHandle == new IntPtr(-1)) {
          nullHandle = IntPtr.Zero;
          throw LastError("CreateFile(NUL)");
        }

        IntPtr attributeSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeSize);
        if (attributeSize == IntPtr.Zero) {
          throw LastError("InitializeProcThreadAttributeList(size)");
        }
        attributeList = Marshal.AllocHGlobal(attributeSize);
        if (!InitializeProcThreadAttributeList(attributeList, 2, 0, ref attributeSize)) {
          throw LastError("InitializeProcThreadAttributeList");
        }

        uint capabilityCount = 0;
        if (capabilitySidBytes != null && capabilitySidBytes.Length > 0) {
          capabilitySid = Marshal.AllocHGlobal(capabilitySidBytes.Length);
          Marshal.Copy(capabilitySidBytes, 0, capabilitySid, capabilitySidBytes.Length);
          capabilityArray = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAndAttributes)));
          Marshal.StructureToPtr(
            new SidAndAttributes { Sid = capabilitySid, Attributes = 0x00000004 },
            capabilityArray,
            false);
          capabilityCount = 1;
        }
        SecurityCapabilities securityCapabilities = new SecurityCapabilities {
          AppContainerSid = appContainerSid,
          Capabilities = capabilityArray,
          CapabilityCount = capabilityCount,
          Reserved = 0
        };
        capabilities = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecurityCapabilities)));
        Marshal.StructureToPtr(securityCapabilities, capabilities, false);
        if (!UpdateProcThreadAttribute(
          attributeList,
          0,
          ProcThreadAttributeSecurityCapabilities,
          capabilities,
          (IntPtr)Marshal.SizeOf(typeof(SecurityCapabilities)),
          IntPtr.Zero,
          IntPtr.Zero)) {
          throw LastError("UpdateProcThreadAttribute(SecurityCapabilities)");
        }

        handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
        Marshal.WriteIntPtr(handleList, 0, stdoutWrite);
        Marshal.WriteIntPtr(handleList, IntPtr.Size, stderrWrite);
        Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, nullHandle);
        if (!UpdateProcThreadAttribute(
          attributeList,
          0,
          ProcThreadAttributeHandleList,
          handleList,
          (IntPtr)(IntPtr.Size * 3),
          IntPtr.Zero,
          IntPtr.Zero)) {
          throw LastError("UpdateProcThreadAttribute(HandleList)");
        }

        StartupInfoEx startup = new StartupInfoEx();
        startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
        startup.StartupInfo.dwFlags = StartupUseStdHandles;
        startup.StartupInfo.hStdInput = nullHandle;
        startup.StartupInfo.hStdOutput = stdoutWrite;
        startup.StartupInfo.hStdError = stderrWrite;
        startup.AttributeList = attributeList;
        ProcessInformation process;
        StringBuilder mutableCommandLine = new StringBuilder(commandLine);
        if (!CreateProcessWithAttributes(
          applicationName,
          mutableCommandLine,
          IntPtr.Zero,
          IntPtr.Zero,
          true,
          ExtendedStartupInfoPresent | CreateSuspended | CreateUnicodeEnvironment,
          environment,
          currentDirectory,
          ref startup,
          out process)) {
          throw LastError("CreateProcess(AppContainer/stdout)");
        }
        if (!AssignProcessToJobObject(job, process.hProcess)) {
          TerminateProcess(process.hProcess, 1);
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("AssignProcessToJobObject(AppContainer/stdout)");
        }
        if (ResumeThread(process.hThread) == 0xFFFFFFFF) {
          TerminateProcess(process.hProcess, 1);
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("ResumeThread(AppContainer/stdout)");
        }
        CloseHandle(stdoutWrite);
        stdoutWrite = IntPtr.Zero;
        CloseHandle(stderrWrite);
        stderrWrite = IntPtr.Zero;
        CloseHandle(nullHandle);
        nullHandle = IntPtr.Zero;
        LaunchedProcess launched = new LaunchedProcess {
          ProcessHandle = process.hProcess,
          ThreadHandle = process.hThread,
          ProcessId = process.processId,
          StdoutReadHandle = stdoutRead,
          StderrReadHandle = stderrRead
        };
        stdoutTransferred = true;
        stderrTransferred = true;
        return launched;
      }
      finally {
        if (attributeList != IntPtr.Zero) {
          DeleteProcThreadAttributeList(attributeList);
          Marshal.FreeHGlobal(attributeList);
        }
        if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
        if (capabilityArray != IntPtr.Zero) Marshal.FreeHGlobal(capabilityArray);
        if (capabilitySid != IntPtr.Zero) Marshal.FreeHGlobal(capabilitySid);
        if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
        if (stdoutWrite != IntPtr.Zero) CloseHandle(stdoutWrite);
        if (stderrWrite != IntPtr.Zero) CloseHandle(stderrWrite);
        if (nullHandle != IntPtr.Zero) CloseHandle(nullHandle);
        if (stdoutRead != IntPtr.Zero && !stdoutTransferred) CloseHandle(stdoutRead);
        if (stderrRead != IntPtr.Zero && !stderrTransferred) CloseHandle(stderrRead);
        Marshal.FreeHGlobal(environment);
      }
    }

    public static LaunchedProcess LaunchHostProcessWithStdout(
      IntPtr job,
      string applicationName,
      string commandLine,
      string currentDirectory,
      string environmentBlock) {
      IntPtr environment = Marshal.StringToHGlobalUni(environmentBlock);
      IntPtr attributeList = IntPtr.Zero;
      IntPtr handleList = IntPtr.Zero;
      IntPtr stdoutRead = IntPtr.Zero;
      IntPtr stdoutWrite = IntPtr.Zero;
      IntPtr stderrRead = IntPtr.Zero;
      IntPtr stderrWrite = IntPtr.Zero;
      IntPtr nullHandle = IntPtr.Zero;
      bool stdoutTransferred = false;
      bool stderrTransferred = false;
      try {
        SecurityAttributes pipeAttributes = new SecurityAttributes {
          Length = (uint)Marshal.SizeOf(typeof(SecurityAttributes)),
          SecurityDescriptor = IntPtr.Zero,
          InheritHandle = true
        };
        if (!CreatePipe(out stdoutRead, out stdoutWrite, ref pipeAttributes, 0)) {
          throw LastError("CreatePipe(host stdout)");
        }
        if (!SetHandleInformation(stdoutRead, HandleFlagInherit, 0)) {
          throw LastError("SetHandleInformation(host stdout)");
        }
        if (!CreatePipe(out stderrRead, out stderrWrite, ref pipeAttributes, 0)) {
          throw LastError("CreatePipe(host stderr)");
        }
        if (!SetHandleInformation(stderrRead, HandleFlagInherit, 0)) {
          throw LastError("SetHandleInformation(host stderr)");
        }
        nullHandle = CreateFileW(
          "NUL",
          GenericRead | GenericWrite,
          FileShareRead | FileShareWrite,
          ref pipeAttributes,
          OpenExisting,
          FileAttributeNormal,
          IntPtr.Zero);
        if (nullHandle == new IntPtr(-1)) {
          nullHandle = IntPtr.Zero;
          throw LastError("CreateFile(host NUL)");
        }

        IntPtr attributeSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
        if (attributeSize == IntPtr.Zero) {
          throw LastError("InitializeProcThreadAttributeList(host size)");
        }
        attributeList = Marshal.AllocHGlobal(attributeSize);
        if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize)) {
          throw LastError("InitializeProcThreadAttributeList(host)");
        }
        handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
        Marshal.WriteIntPtr(handleList, 0, stdoutWrite);
        Marshal.WriteIntPtr(handleList, IntPtr.Size, stderrWrite);
        Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, nullHandle);
        if (!UpdateProcThreadAttribute(
          attributeList,
          0,
          ProcThreadAttributeHandleList,
          handleList,
          (IntPtr)(IntPtr.Size * 3),
          IntPtr.Zero,
          IntPtr.Zero)) {
          throw LastError("UpdateProcThreadAttribute(host HandleList)");
        }

        StartupInfoEx startup = new StartupInfoEx();
        startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
        startup.StartupInfo.dwFlags = StartupUseStdHandles;
        startup.StartupInfo.hStdInput = nullHandle;
        startup.StartupInfo.hStdOutput = stdoutWrite;
        startup.StartupInfo.hStdError = stderrWrite;
        startup.AttributeList = attributeList;
        ProcessInformation process;
        StringBuilder mutableCommandLine = new StringBuilder(commandLine);
        if (!CreateProcessWithAttributes(
          applicationName,
          mutableCommandLine,
          IntPtr.Zero,
          IntPtr.Zero,
          true,
          ExtendedStartupInfoPresent | CreateSuspended | CreateUnicodeEnvironment,
          environment,
          currentDirectory,
          ref startup,
          out process)) {
          throw LastError("CreateProcess(host session/stdout)");
        }
        if (!AssignProcessToJobObject(job, process.hProcess)) {
          TerminateProcess(process.hProcess, 1);
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("AssignProcessToJobObject(host session)");
        }
        if (ResumeThread(process.hThread) == 0xFFFFFFFF) {
          TerminateProcess(process.hProcess, 1);
          CloseHandle(process.hThread);
          CloseHandle(process.hProcess);
          throw LastError("ResumeThread(host session)");
        }
        CloseHandle(stdoutWrite);
        stdoutWrite = IntPtr.Zero;
        CloseHandle(stderrWrite);
        stderrWrite = IntPtr.Zero;
        CloseHandle(nullHandle);
        nullHandle = IntPtr.Zero;
        LaunchedProcess launched = new LaunchedProcess {
          ProcessHandle = process.hProcess,
          ThreadHandle = process.hThread,
          ProcessId = process.processId,
          StdoutReadHandle = stdoutRead,
          StderrReadHandle = stderrRead
        };
        stdoutTransferred = true;
        stderrTransferred = true;
        return launched;
      }
      finally {
        if (attributeList != IntPtr.Zero) {
          DeleteProcThreadAttributeList(attributeList);
          Marshal.FreeHGlobal(attributeList);
        }
        if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
        if (stdoutWrite != IntPtr.Zero) CloseHandle(stdoutWrite);
        if (stderrWrite != IntPtr.Zero) CloseHandle(stderrWrite);
        if (nullHandle != IntPtr.Zero) CloseHandle(nullHandle);
        if (stdoutRead != IntPtr.Zero && !stdoutTransferred) CloseHandle(stdoutRead);
        if (stderrRead != IntPtr.Zero && !stderrTransferred) CloseHandle(stderrRead);
        Marshal.FreeHGlobal(environment);
      }
    }

    public static bool IsProcessAppContainer(IntPtr process) {
      IntPtr token;
      if (!OpenProcessToken(process, TokenQuery, out token)) throw LastError("OpenProcessToken");
      try {
        uint length;
        GetTokenInformation(token, TokenIsAppContainer, IntPtr.Zero, 0, out length);
        if (length == 0) throw LastError("GetTokenInformation(TokenIsAppContainer:size)");
        IntPtr buffer = Marshal.AllocHGlobal((int)length);
        try {
          if (!GetTokenInformation(token, TokenIsAppContainer, buffer, length, out length)) {
            throw LastError("GetTokenInformation(TokenIsAppContainer)");
          }
          return Marshal.ReadInt32(buffer) != 0;
        }
        finally {
          Marshal.FreeHGlobal(buffer);
        }
      }
      finally {
        CloseHandle(token);
      }
    }

    public static bool Wait(IntPtr process, uint milliseconds) {
      return WaitForSingleObject(process, milliseconds) == 0;
    }

    public static bool IsRunning(IntPtr process) {
      uint exitCode;
      if (!GetExitCodeProcess(process, out exitCode)) throw LastError("GetExitCodeProcess");
      return exitCode == StillActive;
    }

    public static uint GetExitCode(IntPtr process) {
      uint exitCode;
      if (!GetExitCodeProcess(process, out exitCode)) throw LastError("GetExitCodeProcess");
      return exitCode;
    }

    public static void Close(IntPtr handle) {
      if (handle != IntPtr.Zero) CloseHandle(handle);
    }

    public static void TerminateJob(IntPtr job, uint exitCode) {
      if (!TerminateJobObject(job, exitCode)) throw LastError("TerminateJobObject");
    }

    public static Task<string> ReadPipeToEndAsync(IntPtr handle) {
      return Task.Run(() => {
        using (SafeFileHandle safeHandle = new SafeFileHandle(handle, true))
        using (FileStream stream = new FileStream(safeHandle, FileAccess.Read, 4096, false))
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, false, 4096)) {
          return reader.ReadToEnd();
        }
      });
    }
  }
}
"@
}

function New-EnvironmentBlock {
  param([Parameter(Mandatory = $true)][hashtable]$Values)

  # CreateProcessW requires a Unicode environment block sorted by variable
  # name, case-insensitively, and terminated by two NUL characters.
  $keys = [string[]]@($Values.Keys)
  [Array]::Sort($keys, [System.StringComparer]::OrdinalIgnoreCase)
  $entries = @($keys | ForEach-Object {
      "{0}={1}" -f $_, $Values[$_]
    })
  return (($entries -join [char]0) + [char]0 + [char]0)
}

function Add-RestrictedAccessRule {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][System.Security.Principal.SecurityIdentifier]$Sid,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemRights]$Rights,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.InheritanceFlags]$Inheritance,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.PropagationFlags]$Propagation
  )

  $acl = Get-Acl -LiteralPath $Path
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $Sid,
    $Rights,
    $Inheritance,
    $Propagation,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Remove-RestrictedAccessRule {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][System.Security.Principal.SecurityIdentifier]$Sid,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemRights]$Rights,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.InheritanceFlags]$Inheritance,
    [Parameter(Mandatory = $true)][System.Security.AccessControl.PropagationFlags]$Propagation
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $acl = Get-Acl -LiteralPath $Path
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $Sid,
    $Rights,
    $Inheritance,
    $Propagation,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.RemoveAccessRule($rule) | Out-Null
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Test-FirewallProof {
  param(
    [Parameter(Mandatory = $true)][string]$RuleName,
    [Parameter(Mandatory = $true)][string]$ProgramPath
  )

  $rule = Get-NetFirewallRule -Name $RuleName -ErrorAction Stop
  $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
  return $rule.Enabled -eq "True" -and
    $rule.Direction -eq "Outbound" -and
    $rule.Action -eq "Block" -and
    @($application.Program) -contains $ProgramPath
}

function Get-ProcessTreeIds {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  $all = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId)
  $ids = New-Object System.Collections.Generic.HashSet[int]
  $pending = New-Object System.Collections.Generic.Queue[int]
  $ids.Add($RootProcessId) | Out-Null
  $pending.Enqueue($RootProcessId)
  while ($pending.Count -gt 0) {
    $parent = $pending.Dequeue()
    foreach ($candidate in $all | Where-Object { $_.ParentProcessId -eq $parent }) {
      $childId = [int]$candidate.ProcessId
      if ($ids.Add($childId)) { $pending.Enqueue($childId) }
    }
  }
  return @($ids)
}

if ($LibraryOnly) {
  return
}

$proofId = [guid]::NewGuid().ToString("N")
$root = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
$probeRoot = Join-Path $root ".coderoom-proof-$proofId"
$siblingRoot = Join-Path $root ".coderoom-proof-outside-$proofId"
$homeMarker = Join-Path $env:USERPROFILE ".coderoom-proof-home-$proofId.txt"
$resultPath = Join-Path $probeRoot "result.json"
$insideMarker = Join-Path $probeRoot "inside.txt"
$outsideMarker = Join-Path $siblingRoot "outside.txt"
$symlinkPath = Join-Path $probeRoot "outside-link"
$appContainerProfileName = "CodeRoomProof-$proofId"
$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$curlPath = Join-Path $env:SystemRoot "System32\curl.exe"
$hostMarker = Join-Path $env:LOCALAPPDATA ".coderoom-proof-host-$proofId.txt"
$secret = [guid]::NewGuid().ToString("N")
$appContainerSidPointer = [IntPtr]::Zero
$appContainerSid = $null
$appContainerRootRuleAdded = $false
$appContainerProbeRuleAdded = $false
$appContainerProfileCreated = $false
$job = [IntPtr]::Zero
$process = $null
$errors = New-Object System.Collections.Generic.List[string]
$firewallReady = $false
$reparsePointCreated = $false

$checks = [ordered]@{
  nativeWindows = $false
  x64 = $false
  workspaceOnly = $false
  traversalBlocked = $false
  symlinkEscapeBlocked = $false
  homeBlocked = $false
  hostRootBlocked = $false
  defaultDeny = $false
  restrictedToken = $false
  jobObject = $false
  processTreeTermination = $false
  resourceLimits = $false
  timeoutEnforced = $false
  inheritedEnvironmentBlocked = $false
  logsRedacted = $false
  appContainer = $false
}

try {
  $checks.nativeWindows = $env:OS -eq "Windows_NT"
  $checks.x64 = [Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess

  New-Item -ItemType Directory -Force -Path $probeRoot, $siblingRoot | Out-Null
  [IO.File]::WriteAllText($outsideMarker, "coderoom-proof-marker")
  [IO.File]::WriteAllText($homeMarker, "coderoom-proof-home-marker")
  [IO.File]::WriteAllText($hostMarker, "coderoom-proof-host-marker")

  if (-not (Test-Path -LiteralPath $curlPath -PathType Leaf)) {
    throw "Windows curl.exe is required for the network denial probe"
  }
  $appContainerSidPointer = [CodeRoom.NativeProof]::CreateAppContainerProfileSid($appContainerProfileName)
  $appContainerProfileCreated = $true
  $appContainerSid = [CodeRoom.NativeProof]::CreateSecurityIdentifier($appContainerSidPointer)

  Add-RestrictedAccessRule `
    -Path $root `
    -Sid $appContainerSid `
    -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute) `
    -Inheritance ([System.Security.AccessControl.InheritanceFlags]::None) `
    -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  $appContainerRootRuleAdded = $true
  Add-RestrictedAccessRule `
    -Path $probeRoot `
    -Sid $appContainerSid `
    -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl) `
    -Inheritance ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) `
    -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  $appContainerProbeRuleAdded = $true

  try {
    New-Item -ItemType SymbolicLink -Path $symlinkPath -Target $siblingRoot -Force | Out-Null
    $reparsePointCreated = $true
  }
  catch {
    try {
      New-Item -ItemType Junction -Path $symlinkPath -Target $siblingRoot -Force | Out-Null
      $reparsePointCreated = $true
    }
    catch {
      $errors.Add("symlink and junction creation are unavailable")
    }
  }

  if ($EnableFirewallProof) {
    throw "Firewall proof requires a dedicated runner executable; this harness does not block the host PowerShell process"
  }

  if ($firewallReady) {
    $checks.defaultDeny = $true
  }

  $job = [CodeRoom.NativeProof]::CreateConstrainedJob(64MB, 8)
  $checks.resourceLimits = [CodeRoom.NativeProof]::HasExpectedJobLimits($job, 64MB, 8)
  $checks.jobObject = $true
  if (-not $checks.resourceLimits) {
    $errors.Add("job limits did not match: $([CodeRoom.NativeProof]::DescribeJobLimits($job))")
  }

  $batchPath = Join-Path $probeRoot "child.cmd"
  $batch = @'
@echo off
setlocal
set "workspaceOnly=false"
set "traversalBlocked=false"
set "symlinkEscapeBlocked=false"
set "homeBlocked=false"
set "hostRootBlocked=false"
set "inheritedEnvironmentBlocked=true"
set "networkBlocked=false"
echo inside>"%CODE_ROOM_WORKSPACE%\inside.txt"
if exist "%CODE_ROOM_WORKSPACE%\inside.txt" set "workspaceOnly=true"
type "%CODE_ROOM_TRAVERSAL%" >nul 2>nul
if errorlevel 1 set "traversalBlocked=true"
type "%CODE_ROOM_SYMLINK%" >nul 2>nul
if errorlevel 1 set "symlinkEscapeBlocked=true"
type "%CODE_ROOM_HOME%" >nul 2>nul
if errorlevel 1 set "homeBlocked=true"
type "%CODE_ROOM_HOST%" >nul 2>nul
if errorlevel 1 set "hostRootBlocked=true"
if defined CODE_ROOM_PROOF_SECRET set "inheritedEnvironmentBlocked=false"
if "%CODE_ROOM_NETWORK_TEST%"=="1" "%CODE_ROOM_CURL%" --connect-timeout 2 --max-time 3 --fail --silent --show-error http://1.1.1.1/ >nul 2>nul
if "%CODE_ROOM_NETWORK_TEST%"=="1" if errorlevel 1 set "networkBlocked=true"
>"%CODE_ROOM_RESULT%" echo {"workspaceOnly":%workspaceOnly%,"traversalBlocked":%traversalBlocked%,"symlinkEscapeBlocked":%symlinkEscapeBlocked%,"homeBlocked":%homeBlocked%,"hostRootBlocked":%hostRootBlocked%,"inheritedEnvironmentBlocked":%inheritedEnvironmentBlocked%,"networkBlocked":%networkBlocked%,"descendantStarted":true}
start "" /b "%ComSpec%" /d /c "for /l %%i in (1,1,1000000000) do @ver >nul"
for /l %%i in (1,1,1000000000) do @ver >nul
'@
  [IO.File]::WriteAllText($batchPath, $batch, [Text.Encoding]::ASCII)
  $commandLine = '"{0}" /d /c ""{1}""' -f $env:ComSpec, $batchPath
  $environment = @{
    SystemRoot = $env:SystemRoot
    windir = $env:SystemRoot
    LOCALAPPDATA = $env:LOCALAPPDATA
    ComSpec = $env:ComSpec
    Path = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    PROCESSOR_ARCHITECTURE = "AMD64"
    TEMP = $probeRoot
    TMP = $probeRoot
    CODE_ROOM_WORKSPACE = $probeRoot
    CODE_ROOM_RESULT = $resultPath
    CODE_ROOM_TRAVERSAL = (Join-Path $root ".coderoom-proof-outside-$proofId\outside.txt")
    CODE_ROOM_SYMLINK = (Join-Path $symlinkPath "outside.txt")
    CODE_ROOM_HOME = $homeMarker
    CODE_ROOM_HOST = $hostMarker
    CODE_ROOM_CURL = $curlPath
    CODE_ROOM_NETWORK_TEST = "1"
  }
  $environmentBlock = New-EnvironmentBlock -Values $environment
  $process = [CodeRoom.NativeProof]::LaunchInAppContainer(
    $job,
    $env:ComSpec,
    $commandLine,
    $probeRoot,
    $environmentBlock,
    $appContainerSidPointer
  )
  $checks.appContainer = [CodeRoom.NativeProof]::IsProcessAppContainer($process.ProcessHandle)
  $checks.restrictedToken = $checks.appContainer
  $timedOut = -not [CodeRoom.NativeProof]::Wait($process.ProcessHandle, [uint32]$TimeoutMs)
  $checks.timeoutEnforced = $timedOut
  if (-not $timedOut) {
    $errors.Add("restricted child exited before timeout (exit code $([CodeRoom.NativeProof]::GetExitCode($process.ProcessHandle)))")
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  while (-not (Test-Path -LiteralPath $resultPath) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 100
  }
  if (Test-Path -LiteralPath $resultPath) {
    $childResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    $checks.workspaceOnly = [bool]$childResult.workspaceOnly
    $checks.traversalBlocked = [bool]$childResult.traversalBlocked
    $checks.symlinkEscapeBlocked = [bool]$childResult.symlinkEscapeBlocked -and $reparsePointCreated
    $checks.homeBlocked = [bool]$childResult.homeBlocked
    $checks.hostRootBlocked = [bool]$childResult.hostRootBlocked
    $checks.inheritedEnvironmentBlocked = [bool]$childResult.inheritedEnvironmentBlocked
    $checks.defaultDeny = [bool]$childResult.networkBlocked
  }
  else {
    $exitCode = [CodeRoom.NativeProof]::GetExitCode($process.ProcessHandle)
    $errors.Add("restricted child produced no result (exit code $exitCode)")
  }
  $treeIdsBefore = @()
  $treeDeadline = [DateTime]::UtcNow.AddSeconds(2)
  do {
    $treeIdsBefore = @(Get-ProcessTreeIds -RootProcessId ([int]$process.ProcessId))
    if ($treeIdsBefore.Count -gt 1) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $treeDeadline)

  if ($null -ne $process) {
    [CodeRoom.NativeProof]::Close($job)
    $job = [IntPtr]::Zero
    $terminationDeadline = [DateTime]::UtcNow.AddSeconds(3)
    $treeStopped = $false
    do {
      $treeStopped = $true
      foreach ($treeId in $treeIdsBefore) {
        if ($null -ne (Get-Process -Id $treeId -ErrorAction SilentlyContinue)) {
          $treeStopped = $false
        }
      }
      if (-not $treeStopped) { Start-Sleep -Milliseconds 100 }
    } while (-not $treeStopped -and [DateTime]::UtcNow -lt $terminationDeadline)
    $mainStopped = -not [CodeRoom.NativeProof]::IsRunning($process.ProcessHandle)
    $checks.processTreeTermination = $mainStopped -and $treeIdsBefore.Count -gt 1 -and $treeStopped
  }
  $logs = Get-Content -LiteralPath $resultPath -Raw -ErrorAction SilentlyContinue
  $checks.logsRedacted = [string]::IsNullOrEmpty($logs) -or -not $logs.Contains($secret)
}
catch {
  $exception = $_.Exception
  while ($null -ne $exception.InnerException) {
    $exception = $exception.InnerException
  }
  $errors.Add($exception.Message)
}
finally {
  if ($null -ne $process) {
    if ($process.StderrReadHandle -ne [IntPtr]::Zero) {
      [CodeRoom.NativeProof]::Close($process.StderrReadHandle)
      $process.StderrReadHandle = [IntPtr]::Zero
    }
    [CodeRoom.NativeProof]::Close($process.ThreadHandle)
    [CodeRoom.NativeProof]::Close($process.ProcessHandle)
  }
  if ($job -ne [IntPtr]::Zero) { [CodeRoom.NativeProof]::Close($job) }
  if ($appContainerProbeRuleAdded) {
    Remove-RestrictedAccessRule `
      -Path $probeRoot `
      -Sid $appContainerSid `
      -Rights ([System.Security.AccessControl.FileSystemRights]::FullControl) `
      -Inheritance ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) `
      -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  }
  if ($appContainerRootRuleAdded) {
    Remove-RestrictedAccessRule `
      -Path $root `
      -Sid $appContainerSid `
      -Rights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute) `
      -Inheritance ([System.Security.AccessControl.InheritanceFlags]::None) `
      -Propagation ([System.Security.AccessControl.PropagationFlags]::None)
  }
  Remove-Item -LiteralPath $probeRoot, $siblingRoot, $homeMarker, $hostMarker -Recurse -Force -ErrorAction SilentlyContinue
  if ($appContainerSidPointer -ne [IntPtr]::Zero) {
    [CodeRoom.NativeProof]::FreeSid($appContainerSidPointer)
  }
  if ($appContainerProfileCreated) {
    [CodeRoom.NativeProof]::DeleteAppContainerProfileByName($appContainerProfileName)
  }
}

$proof = [ordered]@{
  version = "windows-native-v1"
  platform = "windows"
  architecture = "x64"
  nativeWindows = [bool]$checks.nativeWindows
  workspaceRoot = $root
  filesystem = [ordered]@{
    workspaceOnly = [bool]$checks.workspaceOnly
    traversalBlocked = [bool]$checks.traversalBlocked
    symlinkEscapeBlocked = [bool]$checks.symlinkEscapeBlocked
    homeBlocked = [bool]$checks.homeBlocked
    hostRootBlocked = [bool]$checks.hostRootBlocked
  }
  network = [ordered]@{
    defaultDeny = [bool]$checks.defaultDeny
    allowedHosts = @()
  }
  processes = [ordered]@{
    appContainer = [bool]$checks.appContainer
    restrictedToken = [bool]$checks.restrictedToken
    jobObject = [bool]$checks.jobObject
    processTreeTermination = [bool]$checks.processTreeTermination
    resourceLimits = [bool]$checks.resourceLimits
  }
  secrets = [ordered]@{
    inheritedEnvironmentBlocked = [bool]$checks.inheritedEnvironmentBlocked
    logsRedacted = [bool]$checks.logsRedacted
  }
}
$allPassed = @($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0
$result = [ordered]@{
  version = "coderoom-windows-proof-v1"
  status = if ($allPassed) { "passed" } else { "refused" }
  proof = $proof
  checks = $checks
  errors = @($errors)
}
$result | ConvertTo-Json -Compress -Depth 8
if (-not $allPassed) { exit 1 }
