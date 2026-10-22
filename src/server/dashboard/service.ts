import type { DatabaseSync } from "../db/sqlite.js";
import { EXECUTION_STATES, type ExecutionState } from "../executions/service.js";
import type { ProjectStatus } from "../projects/service.js";
import { TICKET_STATES, type TicketState } from "../tickets/service.js";

export type DashboardSummary = {
  organizationId: string;
  projects: Record<ProjectStatus, number>;
  /** Profiles are global: these counts are independent of organizationId. */
  agents: { active: number; archived: number };
  assignments: { active: number };
  tickets: Record<TicketState, number>;
  executions: Record<ExecutionState, number>;
  approvals: { pending: number };
  recentProjects: Array<{
    id: string;
    name: string;
    status: ProjectStatus;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    projectId: string;
    createdAt: string;
  }>;
};

export class DashboardServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DashboardServiceError";
  }
}

type StateCount<State extends string> = { state: State; count: number };

function stateCounts<State extends string>(
  states: readonly State[],
  rows: StateCount<State>[],
): Record<State, number> {
  const counts = Object.fromEntries(states.map((state) => [state, 0])) as Record<
    State,
    number
  >;
  for (const row of rows) counts[row.state] = row.count;
  return counts;
}

export class DashboardService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  getDashboard(organizationIdInput: string): DashboardSummary {
    const organizationId = organizationIdInput.trim();
    if (!organizationId) {
      throw new DashboardServiceError("VALIDATION_ERROR", "organizationId is required");
    }

    // A deferred read transaction keeps one snapshot without taking a write lock.
    this.database.exec("BEGIN");
    try {
      const summary = this.readDashboard(organizationId);
      this.database.exec("COMMIT");
      return summary;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private readDashboard(organizationId: string): DashboardSummary {
    if (
      !this.database
        .prepare("SELECT id FROM organizations WHERE id = ?")
        .get(organizationId)
    ) {
      throw new DashboardServiceError("NOT_FOUND", "Organization not found");
    }

    const projects = stateCounts(
      ["active", "archived"] as const,
      this.database
        .prepare(
          `SELECT status AS state, COUNT(*) AS count FROM projects
           WHERE organization_id = ? GROUP BY status`,
        )
        .all(organizationId) as StateCount<ProjectStatus>[],
    );
    const agents = stateCounts(
      ["active", "archived"] as const,
      this.database
        .prepare(
          `SELECT CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END AS state,
                  COUNT(*) AS count
           FROM agents GROUP BY state`,
        )
        .all() as StateCount<"active" | "archived">[],
    );
    const assignments = this.database
      .prepare(
        `SELECT COUNT(*) AS active FROM assignments a
         INNER JOIN projects p ON p.id = a.project_id
         WHERE p.organization_id = ? AND p.status = 'active'
           AND a.status = 'active' AND a.archived_at IS NULL`,
      )
      .get(organizationId) as DashboardSummary["assignments"];
    const tickets = stateCounts(
      TICKET_STATES,
      this.database
        .prepare(
          `SELECT t.state, COUNT(*) AS count FROM tickets t
           INNER JOIN projects p ON p.id = t.project_id
           WHERE p.organization_id = ? GROUP BY t.state`,
        )
        .all(organizationId) as StateCount<TicketState>[],
    );
    const executions = stateCounts(
      EXECUTION_STATES,
      this.database
        .prepare(
          `SELECT e.state, COUNT(*) AS count FROM executions e
           INNER JOIN projects p ON p.id = e.project_id
           WHERE p.organization_id = ? GROUP BY e.state`,
        )
        .all(organizationId) as StateCount<ExecutionState>[],
    );
    const approvals = this.database
      .prepare(
        `SELECT COUNT(*) AS pending FROM approvals a
         INNER JOIN projects p ON p.id = a.project_id
         WHERE p.organization_id = ? AND a.status = 'pending'
           AND julianday(a.expires_at) > julianday(?)`,
      )
      .get(organizationId, this.now()) as DashboardSummary["approvals"];
    // Projects have no updated_at: use creation time, with an ID tie-breaker.
    const recentProjects = this.database
      .prepare(
        `SELECT id, name, status, created_at AS createdAt FROM projects
         WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 5`,
      )
      .all(organizationId) as DashboardSummary["recentProjects"];
    // Only expose event metadata; payloads can contain private operational data.
    const recentActivity = this.database
      .prepare(
        `SELECT e.id, e.event_type AS type, e.project_id AS projectId,
                e.created_at AS createdAt
         FROM audit_events e INNER JOIN projects p ON p.id = e.project_id
         WHERE p.organization_id = ?
         ORDER BY e.created_at DESC, e.id DESC LIMIT 10`,
      )
      .all(organizationId) as DashboardSummary["recentActivity"];

    return {
      organizationId,
      projects,
      agents,
      assignments,
      tickets,
      executions,
      approvals,
      recentProjects,
      recentActivity,
    };
  }
}
