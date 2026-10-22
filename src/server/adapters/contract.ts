export const PROVIDER_EVENT_TYPES = [
  "output",
  "tool_activity",
  "usage",
  "session_metadata",
  "error",
  "result",
] as const;

export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];
export type CapabilityStatus = "supported" | "unsupported" | "unverified";

export type AdapterCapabilities = {
  streaming: CapabilityStatus;
  nativeResume: CapabilityStatus;
  nativeApproval: CapabilityStatus;
  structuredActions: CapabilityStatus;
};

export type AdapterProbe = {
  provider: string;
  executableVersion?: string;
  installed: boolean;
  authStatus: "ready" | "missing" | "unknown";
  capabilities: AdapterCapabilities;
};

export type ValidatedExecutionRequest = {
  executionId: string;
  projectId: string;
  assignmentId: string;
  triggerId: string;
  instruction: string;
  contextRefs: readonly string[];
  /** Workspace resolved by the runner; required by adapters that spawn a CLI. */
  workspacePath?: string;
  requestedWorkspaceId?: string;
  timeoutMs?: number;
};

export type ProviderEvent = {
  type: ProviderEventType;
  sequence: number;
  occurredAt: string;
  data: Record<string, unknown>;
};

export type CancelResult = {
  executionHandle: string;
  status: "cancelled" | "already-finished" | "not-found";
};

export interface AgentAdapter {
  probe(): Promise<AdapterProbe>;
  execute(request: ValidatedExecutionRequest): AsyncIterable<ProviderEvent>;
  cancel(executionHandle: string): Promise<CancelResult>;
}
