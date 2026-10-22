import { posix, win32 } from "node:path";

export type RunnerPlatform = "linux" | "windows";

export type RunnerTool = {
  id: string;
  executablePath: string;
};

export type HostSandboxProof = {
  version: "linux-native-v1" | "windows-native-v1";
  platform: RunnerPlatform;
  architecture: "x64";
  nativeLinux?: boolean;
  nativeWindows?: boolean;
  workspaceRoot: string;
  filesystem: {
    workspaceOnly: boolean;
    traversalBlocked: boolean;
    symlinkEscapeBlocked: boolean;
    homeBlocked: boolean;
    hostRootBlocked: boolean;
  };
  network: {
    defaultDeny: boolean;
    allowedHosts: readonly string[];
  };
  processes: {
    noNewPrivileges?: boolean;
    pidNamespace?: boolean;
    appContainer?: boolean;
    restrictedToken?: boolean;
    jobObject?: boolean;
    processTreeTermination: boolean;
    resourceLimits: boolean;
  };
  secrets: {
    inheritedEnvironmentBlocked: boolean;
    logsRedacted: boolean;
  };
};

export type RunnerRequest = {
  toolId: string;
  executablePath: string;
  workspaceRoot: string;
  workspacePath: string;
  argv: readonly string[];
  environment: Readonly<Record<string, string>>;
  sessionMode?: "isolated" | "host-login";
  explicitSecretKeys?: readonly string[];
  allowedNetworkHosts?: readonly string[];
  timeoutMs: number;
};

export type RunnerExecutionPlan = {
  platform: RunnerPlatform;
  toolId: string;
  executablePath: string;
  argv: readonly string[];
  cwd: string;
  environment: Readonly<Record<string, string>>;
  redactedEnvironment: Readonly<Record<string, string>>;
  secretKeys: readonly string[];
  timeoutMs: number;
  shell: false;
  killProcessGroup: true;
  allowedNetworkHosts: readonly string[];
};

export type RunnerGateOptions = {
  platform?: RunnerPlatform;
  tools: readonly RunnerTool[];
  environmentAllowlist: readonly string[];
  secretEnvironmentKeys?: readonly string[];
};

export type RunnerGateErrorCode =
  | "INVALID_POLICY"
  | "INVALID_REQUEST"
  | "PLATFORM_UNSUPPORTED"
  | "SANDBOX_UNAVAILABLE"
  | "TOOL_NOT_ALLOWED"
  | "PATH_NOT_ALLOWED"
  | "SECRET_POLICY"
  | "NETWORK_POLICY"
  | "PROCESS_POLICY";

export class RunnerGateError extends Error {
  constructor(
    public readonly code: RunnerGateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunnerGateError";
  }
}

const SENSITIVE_ENVIRONMENT_KEY =
  /password|secret|token|authorization|api[_-]?key|credential|private[_-]?key/i;
const INHERITED_ENVIRONMENT_KEY =
  /^(HOME|USER|LOGNAME|PWD|OLDPWD|SHELL|SSH_AUTH_SOCK|DOCKER_HOST|NODE_OPTIONS|LD_PRELOAD)$/;
const WINDOWS_INHERITED_ENVIRONMENT_KEY =
  /^(USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|COMSPEC|PATHEXT)$/;
const BLOCKED_ARGUMENTS = new Set([
  "--dangerously-allow-all",
  "--yolo",
  "--no-sandbox",
]);
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

function requireText(value: string, field: string, code: RunnerGateErrorCode) {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0")) {
    throw new RunnerGateError(code, `${field} must be a non-empty safe string`);
  }
  return normalized;
}

function pathApi(platform: RunnerPlatform) {
  return platform === "windows" ? win32 : posix;
}

function requireAbsolutePath(value: string, field: string, platform: RunnerPlatform) {
  const normalized = requireText(value, field, "INVALID_REQUEST");
  const paths = pathApi(platform);
  if (!paths.isAbsolute(normalized)) {
    throw new RunnerGateError("PATH_NOT_ALLOWED", `${field} must be absolute`);
  }
  return paths.normalize(paths.resolve(normalized));
}

function isPathWithin(root: string, candidate: string, platform: RunnerPlatform) {
  const paths = pathApi(platform);
  const comparableRoot = platform === "windows" ? root.toLowerCase() : root;
  const comparableCandidate =
    platform === "windows" ? candidate.toLowerCase() : candidate;
  const pathRelation = paths.relative(comparableRoot, comparableCandidate);
  return (
    pathRelation === "" ||
    (!pathRelation.startsWith("..") && !paths.isAbsolute(pathRelation))
  );
}

function validateProof(
  proof: HostSandboxProof,
  workspaceRoot: string,
  platform: RunnerPlatform,
) {
  const expectedVersion =
    platform === "windows" ? "windows-native-v1" : "linux-native-v1";
  const nativeProof = platform === "windows" ? proof.nativeWindows : proof.nativeLinux;
  if (
    proof.version !== expectedVersion ||
    proof.platform !== platform ||
    proof.architecture !== "x64" ||
    nativeProof !== true
  ) {
    throw new RunnerGateError(
      "PLATFORM_UNSUPPORTED",
      `A native ${platform} x64 sandbox proof is required`,
    );
  }

  const proofRoot = requireAbsolutePath(
    proof.workspaceRoot,
    "proof.workspaceRoot",
    platform,
  );
  if (proofRoot !== workspaceRoot) {
    throw new RunnerGateError(
      "PATH_NOT_ALLOWED",
      "Sandbox proof is bound to another workspace root",
    );
  }

  const filesystemChecks = Object.values(proof.filesystem);
  if (filesystemChecks.some((check) => check !== true)) {
    throw new RunnerGateError(
      "SANDBOX_UNAVAILABLE",
      "Filesystem confinement proof is incomplete",
    );
  }
  if (!proof.network.defaultDeny) {
    throw new RunnerGateError(
      "SANDBOX_UNAVAILABLE",
      "Network must be denied by default",
    );
  }
  const processChecks = [
    proof.processes.processTreeTermination,
    proof.processes.resourceLimits,
    ...(platform === "windows"
      ? [
          proof.processes.appContainer,
          proof.processes.restrictedToken,
          proof.processes.jobObject,
        ]
      : [proof.processes.noNewPrivileges, proof.processes.pidNamespace]),
  ];
  if (processChecks.some((check) => check !== true)) {
    throw new RunnerGateError(
      "PROCESS_POLICY",
      "Process confinement proof is incomplete",
    );
  }
  if (!proof.secrets.inheritedEnvironmentBlocked || !proof.secrets.logsRedacted) {
    throw new RunnerGateError(
      "SECRET_POLICY",
      "Secret isolation and log redaction must be proven",
    );
  }
}

export function redactEnvironment(
  environment: Readonly<Record<string, string>>,
  secretKeys: readonly string[],
) {
  const secrets = new Set(secretKeys);
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      secrets.has(key) || SENSITIVE_ENVIRONMENT_KEY.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

export class RunnerGate {
  private readonly platform: RunnerPlatform;
  private readonly tools: ReadonlyMap<string, RunnerTool>;
  private readonly environmentAllowlist: ReadonlySet<string>;
  private readonly secretEnvironmentKeys: ReadonlySet<string>;

  constructor(options: RunnerGateOptions) {
    this.platform = options.platform ?? "linux";
    const tools = new Map<string, RunnerTool>();
    for (const tool of options.tools) {
      const id = requireText(tool.id, "tool.id", "INVALID_POLICY");
      const executablePath = requireAbsolutePath(
        tool.executablePath,
        "tool.executablePath",
        this.platform,
      );
      if (tools.has(id)) {
        throw new RunnerGateError("INVALID_POLICY", `Duplicate runner tool: ${id}`);
      }
      tools.set(id, { id, executablePath });
    }
    this.tools = tools;
    this.environmentAllowlist = new Set(options.environmentAllowlist);
    this.secretEnvironmentKeys = new Set(options.secretEnvironmentKeys ?? []);
  }

  createPlan(request: RunnerRequest, proof: HostSandboxProof): RunnerExecutionPlan {
    const toolId = requireText(request.toolId, "toolId", "INVALID_REQUEST");
    const executablePath = requireAbsolutePath(
      request.executablePath,
      "executablePath",
      this.platform,
    );
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new RunnerGateError(
        "TOOL_NOT_ALLOWED",
        `Tool is not registered: ${toolId}`,
      );
    }
    if (tool.executablePath !== executablePath) {
      throw new RunnerGateError(
        "PATH_NOT_ALLOWED",
        "Executable path is not registered",
      );
    }

    const workspaceRoot = requireAbsolutePath(
      request.workspaceRoot,
      "workspaceRoot",
      this.platform,
    );
    const workspacePath = requireAbsolutePath(
      request.workspacePath,
      "workspacePath",
      this.platform,
    );
    if (!isPathWithin(workspaceRoot, workspacePath, this.platform)) {
      throw new RunnerGateError("PATH_NOT_ALLOWED", "Workspace path escapes its root");
    }
    validateProof(proof, workspaceRoot, this.platform);

    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) {
      throw new RunnerGateError(
        "INVALID_REQUEST",
        "timeoutMs must be a positive integer",
      );
    }
    if (request.timeoutMs > MAX_TIMEOUT_MS) {
      throw new RunnerGateError("PROCESS_POLICY", "timeoutMs exceeds the runner limit");
    }

    const argv = request.argv.map((argument, index) => {
      const value = requireText(argument, `argv[${index}]`, "INVALID_REQUEST");
      if (BLOCKED_ARGUMENTS.has(value)) {
        throw new RunnerGateError(
          "PROCESS_POLICY",
          `Unsafe provider permission flag is forbidden: ${value}`,
        );
      }
      return value;
    });
    const explicitSecretKeys = [...new Set(request.explicitSecretKeys ?? [])];
    for (const key of explicitSecretKeys) {
      if (!this.secretEnvironmentKeys.has(key)) {
        throw new RunnerGateError(
          "SECRET_POLICY",
          `Secret environment key is not approved: ${key}`,
        );
      }
    }
    for (const [key, value] of Object.entries(request.environment)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || !this.environmentAllowlist.has(key)) {
        throw new RunnerGateError(
          "SECRET_POLICY",
          `Environment key is not allowlisted: ${key}`,
        );
      }
      const inheritedKey =
        INHERITED_ENVIRONMENT_KEY.test(key) ||
        (this.platform === "windows" && WINDOWS_INHERITED_ENVIRONMENT_KEY.test(key));
      if (inheritedKey) {
        throw new RunnerGateError(
          "SECRET_POLICY",
          `Inherited environment key is forbidden: ${key}`,
        );
      }
      if (typeof value !== "string" || value.includes("\0")) {
        throw new RunnerGateError(
          "INVALID_REQUEST",
          `Invalid environment value: ${key}`,
        );
      }
      if (SENSITIVE_ENVIRONMENT_KEY.test(key) && !explicitSecretKeys.includes(key)) {
        throw new RunnerGateError(
          "SECRET_POLICY",
          `Sensitive environment key requires explicit declaration: ${key}`,
        );
      }
    }

    const allowedNetworkHosts = [...new Set(request.allowedNetworkHosts ?? [])].map(
      (host) => requireText(host, "allowedNetworkHosts", "NETWORK_POLICY"),
    );
    if (
      allowedNetworkHosts.some((host) => !proof.network.allowedHosts.includes(host))
    ) {
      throw new RunnerGateError(
        "NETWORK_POLICY",
        "Requested network host is not in the sandbox allowlist",
      );
    }

    return {
      platform: this.platform,
      toolId,
      executablePath,
      argv,
      cwd: workspacePath,
      environment: { ...request.environment },
      redactedEnvironment: redactEnvironment(request.environment, explicitSecretKeys),
      secretKeys: explicitSecretKeys,
      timeoutMs: request.timeoutMs,
      shell: false,
      killProcessGroup: true,
      allowedNetworkHosts,
    };
  }
}
