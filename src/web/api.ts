export type ActorType = "human" | "agent" | "system";

export type LocalIdentity = {
  actorId: string;
  actorType: ActorType;
  assignmentId?: string;
};

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  repositoryPath: string | null;
  createdAt: string;
};

export type Conversation = {
  id: string;
  projectId: string;
  kind: "main" | "direct" | "ticket";
  ticketId: string | null;
  createdAt: string;
};

export type MessageReference = {
  type: "project" | "conversation" | "agent";
  id: string;
};

export type Message = {
  id: string;
  conversationId: string;
  authorType: ActorType;
  authorId: string;
  text: string;
  references: MessageReference[];
  createdAt: string;
};

export type MessagePage = {
  items: Message[];
  nextCursor?: string;
};

export type MentionIntention = {
  targetAgentId: string;
  status: "queued" | "rejected";
  reason: string | null;
};

export type EventNotification = {
  id: string;
  type: string;
  version: number;
  projectId: string | null;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  cursor: string;
};

export type AuditEvent = Omit<EventNotification, "cursor">;

export type ExecutionState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type Execution = {
  id: string;
  projectId: string;
  assignmentId: string;
  triggerId: string;
  instruction: string;
  contextRefs: string[];
  requestedWorkspaceId: string | null;
  parentExecutionId: string | null;
  state: ExecutionState;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type Approval = {
  id: string;
  actionRequestId: string;
  projectId: string;
  executionId: string;
  assignmentId: string;
  actionType: string;
  requiredPermission: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedByType: "human" | "system" | null;
  decidedById: string | null;
  decisionReason: string | null;
};

export type ProjectAggregate = {
  project: Project;
  mainConversation: Conversation | null;
};

export type Agent = {
  id: string;
  provider: string | null;
  displayName: string;
  role: string;
  instructions: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  providerState:
    "available" | "unavailable" | "not-installed" | "unsupported" | "missing";
  executable: boolean;
};

export type Assignment = {
  id: string;
  projectId: string;
  agentId: string;
  provider: string | null;
  permissionSet: string[];
  status: "active" | "archived";
  archivedAt: string | null;
  createdAt: string;
};

export type TicketState =
  "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";

export type DashboardSummary = {
  organizationId: string;
  projects: { active: number; archived: number };
  agents: { active: number; archived: number };
  assignments: { active: number };
  tickets: Record<TicketState, number>;
  executions: Record<ExecutionState, number>;
  approvals: { pending: number };
  recentProjects: Array<{
    id: string;
    name: string;
    status: "active" | "archived";
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    projectId: string;
    createdAt: string;
  }>;
};

export type Ticket = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  authorType: ActorType;
  authorId: string;
  ownerId: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  acceptanceCriteria: string[];
  state: TicketState;
  blockedFromState: TicketState | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TestEvidence = {
  id: string;
  deliverableId: string;
  command: string;
  source: "runner";
  outcome: "passed" | "failed" | "blocked";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type Deliverable = {
  id: string;
  ticketId: string;
  executionId: string | null;
  projectId: string;
  workspaceId: string;
  repositoryPath: string;
  gitRef: string;
  gitCommit: string;
  gitBranch: string | null;
  workingTreeStatus: "clean" | "dirty";
  diff: string;
  state: "submitted" | "rejected";
  submittedBy: { type: ActorType; id: string };
  createdAt: string;
  testEvidence: TestEvidence[];
};

export type Review = {
  id: string;
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  projectId: string;
  reviewer: { type: "agent" | "human"; id: string };
  decision: "accepted" | "rejected";
  reason: string;
  createdAt: string;
};

export type TicketDetail = {
  ticket: Ticket;
  conversation: {
    conversation: Conversation;
    participants: { agentId: string; joinedAt: string }[];
  } | null;
  deliverables: Deliverable[];
  reviews: Review[];
};

export type CreateProjectInput = {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
};

export type CreateAgentInput = {
  id: string;
  provider?: string;
  displayName: string;
  role: string;
  instructions?: string;
  description?: string;
};

export type CreateAssignmentInput = {
  id: string;
  agentId: string;
  provider?: string;
  permissionSet: string[];
};

export type SendMessageInput = {
  id: string;
  text: string;
  references?: MessageReference[];
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    correlationId?: string;
  };
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function jsonId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${random ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
}

export function clientId(prefix: string) {
  return jsonId(prefix);
}

export function clientKey(prefix: string) {
  return jsonId(`${prefix}_request`);
}

export class ApiClient {
  constructor(
    private readonly origin: string,
    private readonly identity: LocalIdentity,
  ) {}

  async getDashboard(organizationId: string) {
    return this.request<DashboardSummary>(
      `/api/dashboard?organizationId=${encodeURIComponent(organizationId)}`,
    );
  }

  async listProjects(organizationId?: string, includeArchived = false) {
    const query = new URLSearchParams();
    if (organizationId) query.set("organizationId", organizationId);
    if (includeArchived) query.set("includeArchived", "true");
    const queryString = query.toString();
    return this.request<{ items: Project[] }>(
      `/api/projects${queryString ? `?${queryString}` : ""}`,
    );
  }

  async listAgents(includeArchived = false) {
    return this.request<{ items: Agent[] }>(
      `/api/agents${includeArchived ? "?includeArchived=true" : ""}`,
    );
  }

  async getProject(projectId: string) {
    return this.request<ProjectAggregate>(
      `/api/projects/${encodeURIComponent(projectId)}`,
    );
  }

  async listConversations(projectId: string) {
    return this.request<{ items: Conversation[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
    );
  }

  async listMessages(
    conversationId: string,
    options: { before?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 50),
    });
    if (options.before) query.set("before", options.before);
    return this.request<MessagePage>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`,
    );
  }

  async listExecutions(projectId: string) {
    return this.request<{ items: Execution[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/executions`,
    );
  }

  async listActivity(
    projectId: string,
    options: { before?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 30),
    });
    if (options.before) query.set("cursor", options.before);
    return this.request<{ items: AuditEvent[]; nextCursor?: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/activity?${query.toString()}`,
    );
  }

  async listApprovals(projectId: string, status?: ApprovalStatus) {
    const query = new URLSearchParams({ projectId });
    if (status) query.set("status", status);
    return this.request<{ items: Approval[] }>(`/api/approvals?${query.toString()}`);
  }

  async cancelExecution(executionId: string) {
    return this.request<{
      result: {
        execution: Execution;
        status: "cancelled" | "requested" | "already-finished";
        changed: boolean;
      };
    }>(`/api/executions/${encodeURIComponent(executionId)}/cancel`, {
      method: "POST",
      idempotencyKey: clientKey("execution_cancel"),
    });
  }

  async decideApproval(
    approvalId: string,
    input: { decision: "approved" | "denied"; reason?: string },
  ) {
    return this.request<{ approval: Approval }>(
      `/api/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        idempotencyKey: clientKey("approval_decision"),
        body: input,
      },
    );
  }

  async sendMessage(conversationId: string, input: SendMessageInput) {
    return this.request<{
      message: Message;
      routing: { intentions: MentionIntention[] };
    }>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      idempotencyKey: clientKey("message"),
      body: input,
    });
  }

  eventsUrl(projectId: string, cursor?: string) {
    const url = new URL(this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/events";
    url.search = "";
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("actorId", this.identity.actorId);
    url.searchParams.set("actorType", this.identity.actorType);
    if (this.identity.assignmentId) {
      url.searchParams.set("assignmentId", this.identity.assignmentId);
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    return url.toString();
  }

  async listAssignments(projectId: string) {
    return this.request<{ items: Assignment[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/assignments`,
    );
  }

  async listTickets(projectId: string, state?: TicketState) {
    const query = state ? `?state=${encodeURIComponent(state)}` : "";
    return this.request<{ items: Ticket[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets${query}`,
    );
  }

  async getTicket(ticketId: string) {
    return this.request<TicketDetail>(`/api/tickets/${encodeURIComponent(ticketId)}`);
  }

  async submitReview(
    ticketId: string,
    input: {
      deliverableId: string;
      decision: "accepted" | "rejected";
      reason?: string;
    },
  ) {
    return this.request<{ result: { review: Review; ticket: Ticket } }>(
      `/api/tickets/${encodeURIComponent(ticketId)}/reviews`,
      {
        method: "POST",
        idempotencyKey: clientKey("review"),
        body: input,
      },
    );
  }

  async createProject(input: CreateProjectInput) {
    return this.request<{ project: ProjectAggregate }>("/api/projects", {
      method: "POST",
      idempotencyKey: clientKey("project"),
      body: input,
    });
  }

  async updateProject(
    projectId: string,
    input: { name?: string; description?: string | null },
  ) {
    return this.request<{ project: Project }>(
      `/api/projects/${encodeURIComponent(projectId)}`,
      { method: "PATCH", body: input },
    );
  }

  async archiveProject(projectId: string) {
    return this.request<{ project: Project }>(
      `/api/projects/${encodeURIComponent(projectId)}/archive`,
      { method: "POST", idempotencyKey: clientKey("project_archive") },
    );
  }

  async createAgent(input: CreateAgentInput) {
    return this.request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: input,
    });
  }

  async updateAgent(
    agentId: string,
    input: {
      displayName: string;
      role: string;
      instructions: string;
      description: string | null;
    },
  ) {
    return this.request<{ agent: Agent }>(
      `/api/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  async archiveAgent(agentId: string) {
    return this.request<{ agent: Agent }>(
      `/api/agents/${encodeURIComponent(agentId)}/archive`,
      { method: "POST" },
    );
  }

  async createAssignment(projectId: string, input: CreateAssignmentInput) {
    return this.request<{ assignment: Assignment }>(
      `/api/projects/${encodeURIComponent(projectId)}/assignments`,
      {
        method: "POST",
        idempotencyKey: clientKey("assignment"),
        body: input,
      },
    );
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PATCH";
      idempotencyKey?: string;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const headers = new Headers({
      Accept: "application/json",
      "x-coderoom-actor-id": this.identity.actorId,
      "x-coderoom-actor-type": this.identity.actorType,
    });
    if (this.identity.assignmentId) {
      headers.set("x-coderoom-assignment-id", this.identity.assignmentId);
    }
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiClientError(
        "API indisponible. Vérifiez que le service est démarré.",
        "NETWORK_ERROR",
        0,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
    if (!response.ok) {
      throw new ApiClientError(
        payload.error?.message ?? `La requête a échoué (${response.status}).`,
        payload.error?.code ?? "HTTP_ERROR",
        response.status,
        payload.error?.correlationId,
      );
    }
    return payload as T;
  }
}
