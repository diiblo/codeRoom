import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";

export const PROVIDER_STATUSES = [
  "available",
  "unavailable",
  "not-installed",
  "unsupported",
] as const;

export const UNASSIGNED_PROVIDER = "__unassigned__";

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export type AgentProviderState = ProviderStatus | "missing";

export const PROVIDER_CAPABILITIES = [
  "streaming",
  "nativeResume",
  "nativeApproval",
  "structuredActions",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export type CapabilityStatus = "supported" | "unsupported" | "unverified";
export type ProviderCapabilities = Partial<
  Record<ProviderCapability, CapabilityStatus>
>;

export type ProviderRecord = {
  provider: string;
  displayName: string;
  status: ProviderStatus;
  capabilities: ProviderCapabilities;
  createdAt: string;
  updatedAt: string;
};

export type AgentRecord = {
  id: string;
  provider: string | null;
  displayName: string;
  role: string;
  instructions: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  providerState: AgentProviderState;
  executable: boolean;
};

export type RegisterProviderInput = {
  provider: string;
  displayName: string;
  status?: ProviderStatus;
  capabilities?: ProviderCapabilities;
};

export type UpdateProviderInput = {
  provider: string;
  displayName?: string;
  status?: ProviderStatus;
  capabilities?: ProviderCapabilities;
};

export type CreateAgentInput = {
  id: string;
  provider?: string | null;
  displayName: string;
  role: string;
  instructions?: string;
  description?: string;
};

export type UpdateAgentInput = {
  agentId: string;
  provider?: string | null;
  displayName?: string;
  role?: string;
  instructions?: string;
  description?: string | null;
};

export type ListAgentsInput = {
  includeArchived?: boolean;
  provider?: string;
};

export class AgentServiceError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "FORBIDDEN"
      | "CAPABILITY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "AgentServiceError";
  }
}

type ProviderRow = {
  provider: string;
  displayName: string;
  status: ProviderStatus;
  capabilities: string;
  createdAt: string;
  updatedAt: string;
};

type AgentRow = {
  id: string;
  provider: string;
  displayName: string;
  role: string;
  instructions: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  providerStatus: ProviderStatus | null;
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new AgentServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function optionalProvider(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function storedProvider(value: string | null) {
  return value ?? UNASSIGNED_PROVIDER;
}

function normalizeProviderStatus(value: ProviderStatus | undefined): ProviderStatus {
  const status = value ?? "unavailable";
  if (!(PROVIDER_STATUSES as readonly string[]).includes(status)) {
    throw new AgentServiceError("VALIDATION_ERROR", "Unknown provider status");
  }
  return status;
}

function normalizeCapabilities(
  capabilities: ProviderCapabilities | undefined,
): ProviderCapabilities {
  const normalized: ProviderCapabilities = {};
  for (const capability of PROVIDER_CAPABILITIES) {
    const value = capabilities?.[capability];
    if (value === undefined) continue;
    if (!("supported" === value || "unsupported" === value || "unverified" === value)) {
      throw new AgentServiceError(
        "VALIDATION_ERROR",
        `Unknown capability status for ${capability}`,
      );
    }
    normalized[capability] = value;
  }
  return normalized;
}

function serializeCapabilities(capabilities: ProviderCapabilities) {
  return JSON.stringify(capabilities);
}

function parseCapabilities(value: string): ProviderCapabilities {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: ProviderCapabilities = {};
    for (const capability of PROVIDER_CAPABILITIES) {
      const status = (parsed as Record<string, unknown>)[capability];
      if (
        status === "supported" ||
        status === "unsupported" ||
        status === "unverified"
      ) {
        result[capability] = status;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function sameCapabilities(left: ProviderCapabilities, right: ProviderCapabilities) {
  return serializeCapabilities(left) === serializeCapabilities(right);
}

export class AgentService {
  constructor(private readonly database: DatabaseSync) {}

  registerProvider(input: RegisterProviderInput): ProviderRecord {
    const provider = requireText(input.provider, "provider");
    const displayName = requireText(input.displayName, "displayName");
    const status = normalizeProviderStatus(input.status);
    const capabilities = normalizeCapabilities(input.capabilities);

    return transaction(this.database, () => {
      const existing = this.readProvider(provider);
      if (existing) {
        if (
          existing.record.displayName === displayName &&
          existing.record.status === status &&
          sameCapabilities(existing.record.capabilities, capabilities)
        ) {
          return existing.record;
        }
        throw new AgentServiceError(
          "CONFLICT",
          "Provider is already registered with different metadata",
        );
      }
      this.database
        .prepare(
          `
            INSERT INTO providers (provider, display_name, status, capabilities)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(provider, displayName, status, serializeCapabilities(capabilities));
      return this.readProvider(provider)?.record as ProviderRecord;
    });
  }

  getProvider(provider: string): ProviderRecord | undefined {
    return this.readProvider(requireText(provider, "provider"))?.record;
  }

  listProviders(): ProviderRecord[] {
    return this.database
      .prepare(
        `
          SELECT
            provider,
            display_name AS displayName,
            status,
            capabilities,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM providers
          ORDER BY provider
        `,
      )
      .all()
      .map((row) => this.providerFromRow(row as ProviderRow));
  }

  updateProvider(input: UpdateProviderInput): ProviderRecord {
    const provider = requireText(input.provider, "provider");
    return transaction(this.database, () => {
      const existing = this.readProvider(provider);
      if (!existing) {
        throw new AgentServiceError("NOT_FOUND", "Provider not found");
      }
      const displayName =
        input.displayName === undefined
          ? existing.record.displayName
          : requireText(input.displayName, "displayName");
      const status = normalizeProviderStatus(input.status ?? existing.record.status);
      const capabilities =
        input.capabilities === undefined
          ? existing.record.capabilities
          : normalizeCapabilities(input.capabilities);
      this.database
        .prepare(
          `
            UPDATE providers
            SET display_name = ?, status = ?, capabilities = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE provider = ?
          `,
        )
        .run(displayName, status, serializeCapabilities(capabilities), provider);
      return this.readProvider(provider)?.record as ProviderRecord;
    });
  }

  deleteProvider(providerInput: string): void {
    const provider = requireText(providerInput, "provider");
    transaction(this.database, () => {
      const existing = this.readProvider(provider);
      if (!existing) {
        throw new AgentServiceError("NOT_FOUND", "Provider not found");
      }
      this.database.prepare("DELETE FROM providers WHERE provider = ?").run(provider);
    });
  }

  createAgent(input: CreateAgentInput): AgentRecord {
    const id = requireText(input.id, "id");
    const provider = optionalProvider(input.provider);
    const displayName = requireText(input.displayName, "displayName");
    const role = requireText(input.role, "role");
    const instructions = input.instructions?.trim() ?? "";
    const description = input.description?.trim() || null;

    return transaction(this.database, () => {
      const existing = this.readAgent(id);
      if (existing) {
        if (
          existing.provider === provider &&
          existing.displayName === displayName &&
          existing.role === role &&
          existing.instructions === instructions &&
          existing.description === description
        ) {
          return existing;
        }
        throw new AgentServiceError(
          "CONFLICT",
          "Agent is already registered with different metadata",
        );
      }
      this.database
        .prepare(
          `
            INSERT INTO agents
              (id, provider, display_name, role, instructions, description)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          id,
          storedProvider(provider),
          displayName,
          role,
          instructions,
          description,
        );
      return this.readAgent(id) as AgentRecord;
    });
  }

  getAgent(agentId: string): AgentRecord | undefined {
    return this.readAgent(requireText(agentId, "agentId"));
  }

  listAgents(input: ListAgentsInput = {}): AgentRecord[] {
    const conditions = ["1 = 1"];
    const parameters: string[] = [];
    if (!input.includeArchived) conditions.push("a.archived_at IS NULL");
    if (input.provider !== undefined) {
      conditions.push("a.provider = ?");
      parameters.push(requireText(input.provider, "provider"));
    }
    return this.database
      .prepare(
        `
          SELECT
            a.id,
            a.provider,
            a.display_name AS displayName,
            a.role,
            a.instructions,
            a.description,
            a.archived_at AS archivedAt,
            a.created_at AS createdAt,
            p.status AS providerStatus
          FROM agents a
          LEFT JOIN providers p ON p.provider = a.provider
          WHERE ${conditions.join(" AND ")}
          ORDER BY a.created_at, a.id
        `,
      )
      .all(...parameters)
      .map((row) => this.agentFromRow(row as AgentRow));
  }

  updateAgent(input: UpdateAgentInput): AgentRecord {
    const agentId = requireText(input.agentId, "agentId");
    return transaction(this.database, () => {
      const current = this.readAgent(agentId);
      if (!current) {
        throw new AgentServiceError("NOT_FOUND", "Agent not found");
      }
      if (current.archivedAt !== null) {
        throw new AgentServiceError("FORBIDDEN", "Archived agents are not mutable");
      }
      const provider =
        input.provider === undefined
          ? current.provider
          : optionalProvider(input.provider);
      const displayName =
        input.displayName === undefined
          ? current.displayName
          : requireText(input.displayName, "displayName");
      const role =
        input.role === undefined ? current.role : requireText(input.role, "role");
      const instructions = input.instructions?.trim() ?? current.instructions;
      const description =
        input.description === undefined
          ? current.description
          : input.description?.trim() || null;
      this.database
        .prepare(
          `
            UPDATE agents
            SET provider = ?, display_name = ?, role = ?, instructions = ?,
                description = ?
            WHERE id = ?
          `,
        )
        .run(
          storedProvider(provider),
          displayName,
          role,
          instructions,
          description,
          agentId,
        );
      return this.readAgent(agentId) as AgentRecord;
    });
  }

  archiveAgent(agentIdInput: string): AgentRecord {
    const agentId = requireText(agentIdInput, "agentId");
    return transaction(this.database, () => {
      const current = this.readAgent(agentId);
      if (!current) {
        throw new AgentServiceError("NOT_FOUND", "Agent not found");
      }
      if (current.archivedAt === null) {
        this.database
          .prepare(
            "UPDATE agents SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          )
          .run(agentId);
      }
      return this.readAgent(agentId) as AgentRecord;
    });
  }

  assertExecutable(agentIdInput: string): AgentRecord {
    const agent = this.getAgent(agentIdInput);
    if (!agent) {
      throw new AgentServiceError("NOT_FOUND", "Agent not found");
    }
    if (agent.archivedAt !== null) {
      throw new AgentServiceError("FORBIDDEN", "Archived agents cannot execute");
    }
    if (!agent.executable) {
      throw new AgentServiceError(
        "CAPABILITY_UNAVAILABLE",
        `Provider ${agent.provider ?? "not assigned"} is not executable`,
      );
    }
    return agent;
  }

  private readProvider(provider: string): { record: ProviderRecord } | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            provider,
            display_name AS displayName,
            status,
            capabilities,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM providers
          WHERE provider = ?
        `,
      )
      .get(provider) as ProviderRow | undefined;
    if (!row) return undefined;
    return {
      record: this.providerFromRow(row),
    };
  }

  private providerFromRow(row: ProviderRow): ProviderRecord {
    return {
      provider: row.provider,
      displayName: row.displayName,
      status: row.status,
      capabilities: parseCapabilities(row.capabilities),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private readAgent(agentId: string): AgentRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            a.id,
            a.provider,
            a.display_name AS displayName,
            a.role,
            a.instructions,
            a.description,
            a.archived_at AS archivedAt,
            a.created_at AS createdAt,
            p.status AS providerStatus
          FROM agents a
          LEFT JOIN providers p ON p.provider = a.provider
          WHERE a.id = ?
        `,
      )
      .get(agentId) as AgentRow | undefined;
    return row ? this.agentFromRow(row) : undefined;
  }

  private agentFromRow(row: AgentRow): AgentRecord {
    const provider = row.provider === UNASSIGNED_PROVIDER ? null : row.provider;
    const providerState =
      provider === null ? "missing" : (row.providerStatus ?? "missing");
    return {
      id: row.id,
      provider,
      displayName: row.displayName,
      role: row.role,
      instructions: row.instructions,
      description: row.description,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      providerState,
      executable: row.archivedAt === null && providerState === "available",
    };
  }
}
