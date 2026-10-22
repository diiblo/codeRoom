import { describe, expect, it } from "vitest";
import { RunnerGate, type HostSandboxProof, type RunnerRequest } from "./gate.js";

const workspaceRoot = "/srv/coderoom/workspaces/project-1";

const proof: HostSandboxProof = {
  version: "linux-native-v1",
  platform: "linux",
  architecture: "x64",
  nativeLinux: true,
  workspaceRoot,
  filesystem: {
    workspaceOnly: true,
    traversalBlocked: true,
    symlinkEscapeBlocked: true,
    homeBlocked: true,
    hostRootBlocked: true,
  },
  network: {
    defaultDeny: true,
    allowedHosts: ["api.example.test"],
  },
  processes: {
    noNewPrivileges: true,
    pidNamespace: true,
    processTreeTermination: true,
    resourceLimits: true,
  },
  secrets: {
    inheritedEnvironmentBlocked: true,
    logsRedacted: true,
  },
};

const request: RunnerRequest = {
  toolId: "codex",
  executablePath: "/usr/local/bin/codex",
  workspaceRoot,
  workspacePath: `${workspaceRoot}/execution-1`,
  argv: ["--headless"],
  environment: {
    CODE_ROOM_PROJECT_ID: "project-1",
    CODEX_API_KEY: "test-secret",
  },
  explicitSecretKeys: ["CODEX_API_KEY"],
  allowedNetworkHosts: [],
  timeoutMs: 30_000,
};

function createGate() {
  return new RunnerGate({
    tools: [{ id: "codex", executablePath: "/usr/local/bin/codex" }],
    environmentAllowlist: ["CODE_ROOM_PROJECT_ID", "CODEX_API_KEY"],
    secretEnvironmentKeys: ["CODEX_API_KEY"],
  });
}

const windowsWorkspaceRoot = "C:\\CodeRoom\\workspaces\\project-1";
const windowsProof: HostSandboxProof = {
  version: "windows-native-v1",
  platform: "windows",
  architecture: "x64",
  nativeWindows: true,
  workspaceRoot: windowsWorkspaceRoot,
  filesystem: {
    workspaceOnly: true,
    traversalBlocked: true,
    symlinkEscapeBlocked: true,
    homeBlocked: true,
    hostRootBlocked: true,
  },
  network: {
    defaultDeny: true,
    allowedHosts: [],
  },
  processes: {
    appContainer: true,
    restrictedToken: true,
    jobObject: true,
    processTreeTermination: true,
    resourceLimits: true,
  },
  secrets: {
    inheritedEnvironmentBlocked: true,
    logsRedacted: true,
  },
};

const windowsRequest: RunnerRequest = {
  toolId: "agy",
  executablePath: "C:\\Users\\TestUser\\AppData\\Local\\agy\\bin\\agy.exe",
  workspaceRoot: windowsWorkspaceRoot,
  workspacePath: `${windowsWorkspaceRoot}\\execution-1`,
  argv: ["--headless"],
  environment: {
    CODE_ROOM_PROJECT_ID: "project-1",
  },
  timeoutMs: 30_000,
};

function expectGateCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("Expected runner gate to reject");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("RunnerGate", () => {
  it("produit un plan sans shell avec cwd et processus contrôlés", () => {
    const plan = createGate().createPlan(request, proof);

    expect(plan).toMatchObject({
      toolId: "codex",
      executablePath: "/usr/local/bin/codex",
      cwd: `${workspaceRoot}/execution-1`,
      shell: false,
      killProcessGroup: true,
      allowedNetworkHosts: [],
      secretKeys: ["CODEX_API_KEY"],
    });
    expect(plan.redactedEnvironment).toEqual({
      CODE_ROOM_PROJECT_ID: "project-1",
      CODEX_API_KEY: "[REDACTED]",
    });
  });

  it("refuse une preuve WSL ou une preuve de confinement incomplète", () => {
    expectGateCode(
      () => createGate().createPlan(request, { ...proof, nativeLinux: false }),
      "PLATFORM_UNSUPPORTED",
    );
    expectGateCode(
      () =>
        createGate().createPlan(request, {
          ...proof,
          filesystem: { ...proof.filesystem, symlinkEscapeBlocked: false },
        }),
      "SANDBOX_UNAVAILABLE",
    );
    expectGateCode(
      () =>
        createGate().createPlan(request, {
          ...proof,
          processes: { ...proof.processes, processTreeTermination: false },
        }),
      "PROCESS_POLICY",
    );
  });

  it("refuse les chemins hors workspace et les exécutables non enregistrés", () => {
    expectGateCode(
      () =>
        createGate().createPlan(
          { ...request, workspacePath: `${workspaceRoot}/execution-1/../../etc` },
          proof,
        ),
      "PATH_NOT_ALLOWED",
    );
    expectGateCode(
      () =>
        createGate().createPlan({ ...request, executablePath: "/usr/bin/sh" }, proof),
      "PATH_NOT_ALLOWED",
    );
  });

  it("refuse les secrets hérités, les permissions dangereuses et le réseau hors allowlist", () => {
    expectGateCode(
      () =>
        createGate().createPlan(
          { ...request, environment: { HOME: "/home/user" } },
          proof,
        ),
      "SECRET_POLICY",
    );
    expectGateCode(
      () => createGate().createPlan({ ...request, argv: ["--yolo"] }, proof),
      "PROCESS_POLICY",
    );
    expectGateCode(
      () =>
        createGate().createPlan(
          { ...request, allowedNetworkHosts: ["evil.example.test"] },
          proof,
        ),
      "NETWORK_POLICY",
    );
  });

  it("prépare un plan Windows avec des chemins Win32 et une preuve native dédiée", () => {
    const gate = new RunnerGate({
      platform: "windows",
      tools: [
        {
          id: "agy",
          executablePath: windowsRequest.executablePath,
        },
      ],
      environmentAllowlist: ["CODE_ROOM_PROJECT_ID"],
    });

    expect(gate.createPlan(windowsRequest, windowsProof)).toMatchObject({
      platform: "windows",
      toolId: "agy",
      executablePath: windowsRequest.executablePath,
      cwd: windowsRequest.workspacePath,
      shell: false,
      killProcessGroup: true,
    });
  });

  it("refuse une preuve Windows incomplète et les variables héritées Windows", () => {
    const gate = new RunnerGate({
      platform: "windows",
      tools: [{ id: "agy", executablePath: windowsRequest.executablePath }],
      environmentAllowlist: ["APPDATA", "CODE_ROOM_PROJECT_ID"],
    });

    expectGateCode(
      () => gate.createPlan(windowsRequest, { ...windowsProof, nativeWindows: false }),
      "PLATFORM_UNSUPPORTED",
    );
    expectGateCode(
      () =>
        gate.createPlan(windowsRequest, {
          ...windowsProof,
          processes: { ...windowsProof.processes, appContainer: false },
        }),
      "PROCESS_POLICY",
    );
    expectGateCode(
      () =>
        gate.createPlan(windowsRequest, {
          ...windowsProof,
          processes: { ...windowsProof.processes, jobObject: false },
        }),
      "PROCESS_POLICY",
    );
    expectGateCode(
      () =>
        gate.createPlan(
          {
            ...windowsRequest,
            environment: { APPDATA: "C:\\Users\\TestUser\\AppData" },
          },
          windowsProof,
        ),
      "SECRET_POLICY",
    );
  });
});
