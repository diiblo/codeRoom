import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { ExecutionService } from "../executions/service.js";
import { EventService, type EventActor } from "../events/service.js";
import { TicketService } from "../tickets/service.js";
import { WorkspaceService, type WorkspaceRecord } from "../workspaces/service.js";

export const WORKING_TREE_STATUSES = ["clean", "dirty"] as const;
export type WorkingTreeStatus = (typeof WORKING_TREE_STATUSES)[number];

export const TEST_OUTCOMES = ["passed", "failed", "blocked"] as const;
export type TestOutcome = (typeof TEST_OUTCOMES)[number];

export type GitInspectionRequest = {
  workspace: WorkspaceRecord;
  requestedRef?: string;
};

export type GitInspection = {
  repositoryPath: string;
  gitRef: string;
  commit: string;
  branch?: string | null;
  workingTreeStatus: WorkingTreeStatus;
  diff: string;
  refVerified: true;
};

export type GitInspectionProvider = {
  inspect(input: GitInspectionRequest): GitInspection;
};

export type TestEvidenceInput = {
  id?: string;
  command: string;
  source: "runner";
  outcome: TestOutcome;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  startedAt: string;
  finishedAt: string;
};

export type TestEvidenceRecord = {
  id: string;
  deliverableId: string;
  command: string;
  source: "runner";
  outcome: TestOutcome;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type DeliverableRecord = {
  id: string;
  ticketId: string;
  executionId: string | null;
  projectId: string;
  workspaceId: string;
  repositoryPath: string;
  gitRef: string;
  gitCommit: string;
  gitBranch: string | null;
  workingTreeStatus: WorkingTreeStatus;
  diff: string;
  state: "submitted" | "rejected";
  submittedBy: EventActor;
  createdAt: string;
  testEvidence: TestEvidenceRecord[];
};

export type SubmitDeliverableInput = {
  id?: string;
  ticketId: string;
  executionId?: string;
  workspaceId: string;
  lockToken: string;
  requestedRef?: string;
  testEvidence: readonly TestEvidenceInput[];
  actor: EventActor;
  idempotencyKey: string;
  correlationId?: string;
  now?: string;
};

export type DeliverableServiceOptions = {
  gitInspector?: GitInspectionProvider;
  now?: () => string;
};

export class DeliverableServiceError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "FORBIDDEN"
      | "LEASE_LOST"
      | "CAPABILITY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "DeliverableServiceError";
  }
}

type DeliverableRow = {
  id: string;
  ticketId: string;
  executionId: string | null;
  projectId: string;
  workspaceId: string;
  repositoryPath: string;
  gitRef: string;
  gitCommit: string;
  gitBranch: string | null;
  workingTreeStatus: WorkingTreeStatus;
  diff: string;
  state: "submitted" | "rejected";
  submittedByType: EventActor["type"];
  submittedById: string;
  createdAt: string;
};

type TestEvidenceRow = {
  id: string;
  deliverableId: string;
  command: string;
  source: "runner";
  outcome: TestOutcome;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

const DELIVERABLE_SELECT = `
  SELECT
    id,
    ticket_id AS ticketId,
    execution_id AS executionId,
    project_id AS projectId,
    workspace_id AS workspaceId,
    repository_path AS repositoryPath,
    git_ref AS gitRef,
    git_commit AS gitCommit,
    git_branch AS gitBranch,
    working_tree_status AS workingTreeStatus,
    diff_text AS diff,
    state,
    submitted_by_type AS submittedByType,
    submitted_by_id AS submittedById,
    created_at AS createdAt
  FROM deliverables
`;

const EVIDENCE_SELECT = `
  SELECT
    id,
    deliverable_id AS deliverableId,
    command,
    source,
    outcome,
    exit_code AS exitCode,
    stdout,
    stderr,
    started_at AS startedAt,
    finished_at AS finishedAt,
    duration_ms AS durationMs
  FROM deliverable_test_evidence
`;

const SENSITIVE_OUTPUT =
  /(password|secret|token|authorization|api[_-]?key|credential|private[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi;
const MAX_CAPTURE_LENGTH = 250_000;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new DeliverableServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function validateTimestamp(value: string, field: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new DeliverableServiceError(
      "VALIDATION_ERROR",
      `${field} must be a timestamp`,
    );
  }
  return value;
}

function redact(value: string | undefined) {
  const text = value ?? "";
  if (text.length > MAX_CAPTURE_LENGTH) {
    throw new DeliverableServiceError(
      "VALIDATION_ERROR",
      "Captured test output is too large",
    );
  }
  return text.replace(SENSITIVE_OUTPUT, "$1$2[REDACTED]");
}

function normalizeTestEvidence(input: TestEvidenceInput, deliverableId: string) {
  const command = requireText(input.command, "testEvidence.command");
  if (input.source !== "runner") {
    throw new DeliverableServiceError(
      "FORBIDDEN",
      "Test evidence must come from the controlled runner",
    );
  }
  if (!TEST_OUTCOMES.includes(input.outcome)) {
    throw new DeliverableServiceError("VALIDATION_ERROR", "Unknown test outcome");
  }
  if (
    input.exitCode !== null &&
    (!Number.isInteger(input.exitCode) || input.exitCode < 0)
  ) {
    throw new DeliverableServiceError("VALIDATION_ERROR", "Invalid test exit code");
  }
  if (input.outcome === "passed" && input.exitCode !== 0) {
    throw new DeliverableServiceError(
      "VALIDATION_ERROR",
      "A passed test evidence must have exit code 0",
    );
  }
  if (input.outcome === "failed" && (input.exitCode === null || input.exitCode === 0)) {
    throw new DeliverableServiceError(
      "VALIDATION_ERROR",
      "A failed test evidence must have a non-zero exit code",
    );
  }
  const startedAt = validateTimestamp(input.startedAt, "testEvidence.startedAt");
  const finishedAt = validateTimestamp(input.finishedAt, "testEvidence.finishedAt");
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  if (durationMs < 0) {
    throw new DeliverableServiceError(
      "VALIDATION_ERROR",
      "Test evidence finished before it started",
    );
  }
  return {
    id: requireText(input.id ?? `evidence_${randomUUID()}`, "testEvidence.id"),
    deliverableId,
    command,
    source: input.source,
    outcome: input.outcome,
    exitCode: input.exitCode,
    stdout: redact(input.stdout),
    stderr: redact(input.stderr),
    startedAt,
    finishedAt,
    durationMs,
  } satisfies TestEvidenceRecord;
}

function toEvidence(row: TestEvidenceRow): TestEvidenceRecord {
  return { ...row };
}

function toDeliverable(
  row: DeliverableRow,
  evidence: TestEvidenceRecord[],
): DeliverableRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    executionId: row.executionId,
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    repositoryPath: row.repositoryPath,
    gitRef: row.gitRef,
    gitCommit: row.gitCommit,
    gitBranch: row.gitBranch,
    workingTreeStatus: row.workingTreeStatus,
    diff: row.diff,
    state: row.state,
    submittedBy: { type: row.submittedByType, id: row.submittedById },
    createdAt: row.createdAt,
    testEvidence: evidence,
  };
}

function fingerprint(
  input: SubmitDeliverableInput,
  inspection: GitInspection,
  evidence: readonly TestEvidenceRecord[],
) {
  return JSON.stringify({
    id: input.id ?? null,
    ticketId: input.ticketId,
    executionId: input.executionId ?? null,
    workspaceId: input.workspaceId,
    lockToken: input.lockToken,
    requestedRef: input.requestedRef ?? null,
    inspection,
    evidence: evidence.map((item) => ({
      command: item.command,
      source: item.source,
      outcome: item.outcome,
      exitCode: item.exitCode,
      stdout: item.stdout,
      stderr: item.stderr,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      durationMs: item.durationMs,
    })),
    actor: input.actor,
  });
}

function unavailableInspector(): GitInspectionProvider {
  return {
    inspect() {
      throw new DeliverableServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Git inspection requires an approved runner provider",
      );
    },
  };
}

export class DeliverableService {
  private readonly events: EventService;
  private readonly executions: ExecutionService;
  private readonly tickets: TicketService;
  private readonly workspaces: WorkspaceService;
  private readonly inspector: GitInspectionProvider;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: DeliverableServiceOptions = {},
  ) {
    this.events = new EventService(database);
    this.executions = new ExecutionService(database);
    this.tickets = new TicketService(database);
    this.workspaces = new WorkspaceService(database, { now: options.now });
    this.inspector = options.gitInspector ?? unavailableInspector();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  submit(input: SubmitDeliverableInput): DeliverableRecord {
    const ticketId = requireText(input.ticketId, "ticketId");
    const workspaceId = requireText(input.workspaceId, "workspaceId");
    const lockToken = requireText(input.lockToken, "lockToken");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const actorId = requireText(input.actor.id, "actor.id");
    const timestamp = validateTimestamp(input.now ?? this.now(), "now");
    if (!Array.isArray(input.testEvidence) || input.testEvidence.length === 0) {
      throw new DeliverableServiceError(
        "VALIDATION_ERROR",
        "At least one test evidence is required",
      );
    }

    const workspace = this.workspaces.getWorkspace(workspaceId);
    if (!workspace)
      throw new DeliverableServiceError("NOT_FOUND", "Workspace not found");
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) throw new DeliverableServiceError("NOT_FOUND", "Ticket not found");
    if (ticket.projectId !== workspace.projectId) {
      throw new DeliverableServiceError(
        "CONFLICT",
        "Ticket belongs to another project",
      );
    }
    if (workspace.ticketId && workspace.ticketId !== ticket.id) {
      throw new DeliverableServiceError(
        "CONFLICT",
        "Workspace is reserved for another ticket",
      );
    }
    const execution = input.executionId
      ? this.executions.getExecution(requireText(input.executionId, "executionId"))
      : undefined;
    if (input.executionId && !execution) {
      throw new DeliverableServiceError("NOT_FOUND", "Execution not found");
    }
    if (execution) {
      if (execution.projectId !== ticket.projectId) {
        throw new DeliverableServiceError(
          "CONFLICT",
          "Execution belongs to another project",
        );
      }
      if (
        execution.requestedWorkspaceId &&
        execution.requestedWorkspaceId !== workspace.id
      ) {
        throw new DeliverableServiceError(
          "CONFLICT",
          "Execution requested another workspace",
        );
      }
    }

    this.workspaces.assertLockHeld(workspace.id, lockToken, timestamp);
    let inspection: GitInspection;
    try {
      inspection = this.inspector.inspect({
        workspace,
        requestedRef: input.requestedRef,
      });
    } catch (error) {
      if (error instanceof DeliverableServiceError) throw error;
      throw new DeliverableServiceError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Git inspection failed",
      );
    }
    inspection = this.validateInspection(inspection, workspace);

    const id = requireText(input.id ?? `dvr_${randomUUID()}`, "id");
    const evidence = input.testEvidence.map((item) => normalizeTestEvidence(item, id));
    const requestFingerprint = fingerprint(input, inspection, evidence);
    const correlationId = input.correlationId?.trim() || randomUUID();

    return transaction(this.database, () => {
      const existingRequest = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              deliverable_id AS deliverableId,
              request_fingerprint AS requestFingerprint
            FROM deliverable_submission_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as
        | {
            idempotencyKey: string;
            deliverableId: string;
            requestFingerprint: string;
          }
        | undefined;
      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new DeliverableServiceError(
            "CONFLICT",
            "Idempotency key was already used for another deliverable",
          );
        }
        return this.requireDeliverable(existingRequest.deliverableId);
      }

      this.database
        .prepare(
          `
            INSERT INTO deliverables
              (id, ticket_id, execution_id, project_id, workspace_id,
               repository_path, git_ref, git_commit, git_branch,
               working_tree_status, diff_text, state,
               submitted_by_type, submitted_by_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
          `,
        )
        .run(
          id,
          ticket.id,
          execution?.id ?? null,
          ticket.projectId,
          workspace.id,
          workspace.repositoryPath,
          inspection.gitRef,
          inspection.commit,
          inspection.branch?.trim() || null,
          inspection.workingTreeStatus,
          inspection.diff,
          input.actor.type,
          actorId,
          timestamp,
        );
      for (const item of evidence) {
        this.database
          .prepare(
            `
              INSERT INTO deliverable_test_evidence
                (id, deliverable_id, command, source, outcome, exit_code,
                 stdout, stderr, started_at, finished_at, duration_ms)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            item.id,
            id,
            item.command,
            item.source,
            item.outcome,
            item.exitCode,
            item.stdout,
            item.stderr,
            item.startedAt,
            item.finishedAt,
            item.durationMs,
          );
      }
      this.database
        .prepare(
          `
            INSERT INTO deliverable_submission_requests
              (idempotency_key, deliverable_id, request_fingerprint)
            VALUES (?, ?, ?)
          `,
        )
        .run(idempotencyKey, id, requestFingerprint);
      this.events.recordEvent({
        type: "deliverable.submitted",
        version: 1,
        projectId: ticket.projectId,
        actor: input.actor,
        correlationId,
        payload: {
          deliverableId: id,
          ticketId: ticket.id,
          executionId: execution?.id ?? null,
          gitRef: inspection.gitRef,
          workingTreeStatus: inspection.workingTreeStatus,
          testOutcomes: evidence.map((item) => item.outcome),
        },
      });
      return this.requireDeliverable(id);
    });
  }

  getDeliverable(deliverableId: string) {
    const id = requireText(deliverableId, "deliverableId");
    const row = this.database.prepare(`${DELIVERABLE_SELECT} WHERE id = ?`).get(id) as
      DeliverableRow | undefined;
    return row ? this.toRecord(row) : undefined;
  }

  requireDeliverable(deliverableId: string) {
    const deliverable = this.getDeliverable(deliverableId);
    if (!deliverable) {
      throw new DeliverableServiceError("NOT_FOUND", "Deliverable not found");
    }
    return deliverable;
  }

  listByTicket(ticketId: string) {
    const id = requireText(ticketId, "ticketId");
    return (
      this.database
        .prepare(`${DELIVERABLE_SELECT} WHERE ticket_id = ? ORDER BY created_at, id`)
        .all(id) as DeliverableRow[]
    ).map((row) => this.toRecord(row));
  }

  private validateInspection(
    inspection: GitInspection,
    workspace: WorkspaceRecord,
  ): GitInspection {
    if (inspection.repositoryPath !== workspace.repositoryPath) {
      throw new DeliverableServiceError(
        "CONFLICT",
        "Git inspection belongs to another repository",
      );
    }
    if (inspection.refVerified !== true) {
      throw new DeliverableServiceError("VALIDATION_ERROR", "Git ref was not verified");
    }
    if (!/^[0-9a-f]{40}$/.test(inspection.commit)) {
      throw new DeliverableServiceError("VALIDATION_ERROR", "Git commit is invalid");
    }
    if (!WORKING_TREE_STATUSES.includes(inspection.workingTreeStatus)) {
      throw new DeliverableServiceError(
        "VALIDATION_ERROR",
        "Unknown working tree status",
      );
    }
    const gitRef = requireText(inspection.gitRef, "gitRef");
    if (
      !/^[A-Za-z0-9._/-]+$/.test(gitRef) ||
      gitRef.startsWith("/") ||
      gitRef.endsWith("/") ||
      gitRef.startsWith(".") ||
      gitRef.includes("..") ||
      gitRef.includes("//")
    ) {
      throw new DeliverableServiceError("VALIDATION_ERROR", "Git ref is unsafe");
    }
    if (typeof inspection.diff !== "string") {
      throw new DeliverableServiceError("VALIDATION_ERROR", "Git diff is invalid");
    }
    const diff = redact(inspection.diff);
    return {
      ...inspection,
      gitRef,
      branch: inspection.branch?.trim() || null,
      diff,
    };
  }

  private toRecord(row: DeliverableRow) {
    const evidence = (
      this.database
        .prepare(`${EVIDENCE_SELECT} WHERE deliverable_id = ? ORDER BY created_at, id`)
        .all(row.id) as TestEvidenceRow[]
    ).map(toEvidence);
    return toDeliverable(row, evidence);
  }
}
