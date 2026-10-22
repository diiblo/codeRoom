import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "../agents/service.js";
import { ApprovalService } from "../approvals/service.js";
import { AssignmentService } from "../assignments/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ExecutionService } from "../executions/service.js";
import { ProjectService } from "../projects/service.js";
import { buildApp } from "../app.js";

const applications: Array<ReturnType<typeof buildApp>> = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
});

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  const agents = new AgentService(database);
  agents.createAgent({
    id: "agt_1",
    provider: "codex",
    displayName: "One",
    role: "developer",
  });
  agents.createAgent({
    id: "agt_2",
    provider: "claude",
    displayName: "Two",
    role: "reviewer",
  });
  const projects = new ProjectService(database);
  projects.createProject({
    id: "prj_1",
    organizationId: "org_1",
    name: "One",
    mainConversationId: "conv_main_1",
    idempotencyKey: "project_req_1",
  });
  projects.createProject({
    id: "prj_2",
    organizationId: "org_1",
    name: "Two",
    mainConversationId: "conv_main_2",
    idempotencyKey: "project_req_2",
  });
  const assignments = new AssignmentService(database);
  assignments.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: [
      "project.read",
      "message.read",
      "message.send",
      "ticket.read",
      "ticket.create",
      "ticket.assign",
      "ticket.update",
      "git.write_scoped",
    ],
    idempotencyKey: "assignment_req_1",
  });
  assignments.createAssignment({
    id: "asgn_2",
    projectId: "prj_2",
    agentId: "agt_2",
    permissionSet: ["project.read", "message.read", "message.send"],
    idempotencyKey: "assignment_req_2",
  });
  return database;
}

function identityHeaders() {
  return {
    "x-coderoom-actor-id": "agt_1",
    "x-coderoom-assignment-id": "asgn_1",
  };
}

function humanHeaders() {
  return {
    "x-coderoom-actor-id": "owner_1",
    "x-coderoom-actor-type": "human",
  };
}

describe("HTTP API du socle", () => {
  it("expose les projets, agents et affectations via les services métier", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const createdAgent = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: identityHeaders(),
      payload: {
        id: "agt_3",
        displayName: "Three",
        role: "tester",
      },
    });
    expect(createdAgent.statusCode).toBe(201);
    expect(createdAgent.json()).toMatchObject({ agent: { id: "agt_3" } });

    const assignment = await app.inject({
      method: "POST",
      url: "/api/projects/prj_1/assignments",
      headers: {
        ...identityHeaders(),
        "idempotency-key": "assignment_req_3",
      },
      payload: {
        id: "asgn_3",
        agentId: "agt_3",
        provider: "codex",
        permissionSet: ["message.read"],
      },
    });
    expect(assignment.statusCode).toBe(201);

    const listedAgents = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: identityHeaders(),
    });
    expect(listedAgents.statusCode).toBe(200);
    expect(listedAgents.json().items).toHaveLength(3);

    const listedAssignments = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/assignments",
      headers: identityHeaders(),
    });
    expect(listedAssignments.statusCode).toBe(200);
    expect(listedAssignments.json().items).toMatchObject([
      { id: "asgn_1", projectId: "prj_1" },
      { id: "asgn_3", projectId: "prj_1", provider: "codex" },
    ]);
    expect(listedAssignments.json().items).not.toContainEqual(
      expect.objectContaining({ projectId: "prj_2" }),
    );
  });

  it("rend la création de projet idempotente et les erreurs typées", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const headers = {
      ...identityHeaders(),
      "idempotency-key": "project_req_3",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: {
        id: "prj_3",
        organizationId: "org_1",
        name: "Three",
        mainConversationId: "conv_main_3",
      },
    });
    expect(first.statusCode).toBe(201);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: {
        id: "prj_3",
        organizationId: "org_1",
        name: "Three",
        mainConversationId: "conv_main_3",
      },
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toEqual(first.json());

    const conflict = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: {
        ...headers,
        "x-correlation-id": "corr_conflict",
      },
      payload: {
        id: "prj_other",
        organizationId: "org_1",
        name: "Contradictory",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: {
        code: "CONFLICT",
        message: "Idempotency key was already used for another project request",
        correlationId: "corr_conflict",
      },
    });

    const missingIdentity = await app.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(missingIdentity.statusCode).toBe(401);
    expect(missingIdentity.json().error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  });

  it("expose la modification et l’archivage d’un projet", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/projects/prj_1",
      headers: humanHeaders(),
      payload: { name: "Projet renommé", description: "Nouvelle direction" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      project: {
        id: "prj_1",
        name: "Projet renommé",
        description: "Nouvelle direction",
        status: "active",
      },
    });

    const archived = await app.inject({
      method: "POST",
      url: "/api/projects/prj_1/archive",
      headers: humanHeaders(),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      project: { id: "prj_1", status: "archived" },
    });

    const activeProjects = await app.inject({
      method: "GET",
      url: "/api/projects?organizationId=org_1",
      headers: humanHeaders(),
    });
    expect(activeProjects.json().items).not.toContainEqual(
      expect.objectContaining({ id: "prj_1" }),
    );

    const allProjects = await app.inject({
      method: "GET",
      url: "/api/projects?organizationId=org_1&includeArchived=true",
      headers: humanHeaders(),
    });
    expect(allProjects.json().items).toContainEqual(
      expect.objectContaining({ id: "prj_1", status: "archived" }),
    );
  });

  it("expose les actions tickets structurées et rejette une attribution cross-project", async () => {
    const database = createFixture();
    const executions = new ExecutionService(database, {
      now: () => "2026-01-01T00:00:00.000Z",
    });
    executions.enqueue({
      id: "exec_ticket_1",
      projectId: "prj_1",
      assignmentId: "asgn_1",
      triggerId: "trigger_ticket_1",
      instruction: "Create a ticket",
      contextRefs: ["project:prj_1"],
      idempotencyKey: "exec_ticket_request_1",
    });
    executions.reserveNext("worker_ticket_1", "2026-01-01T00:00:00.000Z");
    const app = buildApp(database);
    applications.push(app);

    const create = await app.inject({
      method: "POST",
      url: "/api/actions",
      headers: identityHeaders(),
      payload: {
        type: "ticket.create",
        executionId: "exec_ticket_1",
        projectId: "prj_1",
        idempotencyKey: "ticket_action_create_1",
        payload: {
          title: "API ticket",
          body: "Created from a structured agent action",
          acceptanceCriteria: ["The action is visible in the API"],
        },
      },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toMatchObject({
      result: {
        actionType: "ticket.create",
        replayed: false,
        ticket: { projectId: "prj_1", title: "API ticket", state: "todo" },
      },
    });
    const ticketId = create.json().result.ticket.id as string;

    const repeated = await app.inject({
      method: "POST",
      url: "/api/actions",
      headers: identityHeaders(),
      payload: {
        type: "ticket.create",
        executionId: "exec_ticket_1",
        projectId: "prj_1",
        idempotencyKey: "ticket_action_create_1",
        payload: {
          title: "API ticket",
          body: "Created from a structured agent action",
          acceptanceCriteria: ["The action is visible in the API"],
        },
      },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({ result: { replayed: true } });

    const listed = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/tickets",
      headers: identityHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toMatchObject([{ id: ticketId, projectId: "prj_1" }]);

    const conversations = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/conversations",
      headers: identityHeaders(),
    });
    expect(conversations.statusCode).toBe(200);
    expect(conversations.json().items).toContainEqual(
      expect.objectContaining({ kind: "ticket", ticketId }),
    );

    const crossProjectAssignment = await app.inject({
      method: "POST",
      url: "/api/actions",
      headers: identityHeaders(),
      payload: {
        type: "ticket.assign",
        executionId: "exec_ticket_1",
        projectId: "prj_1",
        idempotencyKey: "ticket_action_assign_cross_project",
        payload: { ticketId, ownerId: "agt_2" },
      },
    });
    expect(crossProjectAssignment.statusCode).toBe(403);
    expect(crossProjectAssignment.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("protège les conversations, messages et activité par l'identité serveur", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const conversation = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/conversations",
      headers: identityHeaders(),
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json().items).toMatchObject([
      { id: "conv_main_1", projectId: "prj_1", kind: "main" },
    ]);

    const message = await app.inject({
      method: "POST",
      url: "/api/conversations/conv_main_1/messages",
      headers: {
        ...identityHeaders(),
        "idempotency-key": "message_req_1",
        "x-correlation-id": "corr_message",
      },
      payload: { id: "msg_1", text: "Bonjour" },
    });
    expect(message.statusCode).toBe(201);
    expect(message.json()).toMatchObject({
      message: { id: "msg_1", authorId: "agt_1" },
      routing: { messageId: "msg_1", intentions: [] },
    });

    const history = await app.inject({
      method: "GET",
      url: "/api/conversations/conv_main_1/messages?limit=1",
      headers: identityHeaders(),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toMatchObject([{ id: "msg_1" }]);

    const activity = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/activity",
      headers: identityHeaders(),
    });
    expect(activity.statusCode).toBe(200);
    expect(activity.json().items).toMatchObject([
      { type: "message.posted", projectId: "prj_1", correlationId: "corr_message" },
    ]);

    const mention = await app.inject({
      method: "POST",
      url: "/api/conversations/conv_main_1/messages",
      headers: {
        ...identityHeaders(),
        "idempotency-key": "message_req_mention",
      },
      payload: { id: "msg_mention", text: "@agt_1 à vérifier" },
    });
    expect(mention.statusCode).toBe(201);
    expect(mention.json()).toMatchObject({
      routing: {
        messageId: "msg_mention",
        intentions: [
          {
            targetAgentId: "agt_1",
            status: "rejected",
            reason: "agent_auto_mention_disabled",
          },
        ],
      },
    });

    const spoof = await app.inject({
      method: "POST",
      url: "/api/conversations/conv_main_1/messages",
      headers: {
        ...identityHeaders(),
        "idempotency-key": "message_req_spoof",
      },
      payload: { id: "msg_spoof", text: "spoof", authorId: "agt_2" },
    });
    expect(spoof.statusCode).toBe(422);
    expect(spoof.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(JSON.stringify(spoof.json())).not.toContain("agt_2");

    const missingIdentity = await app.inject({
      method: "GET",
      url: "/api/conversations/conv_main_1/messages",
    });
    expect(missingIdentity.statusCode).toBe(401);
  });

  it("relit les exécutions par projet et garde les décisions propriétaire fail-closed", async () => {
    const database = createFixture();
    const executions = new ExecutionService(database, {
      now: () => "2026-01-01T00:00:00.000Z",
    });
    executions.enqueue({
      id: "exec_1",
      projectId: "prj_1",
      assignmentId: "asgn_1",
      triggerId: "trigger_1",
      instruction: "Inspect the repository",
      contextRefs: ["project:prj_1"],
      idempotencyKey: "exec_req_1",
    });
    executions.reserveNext("worker_1", "2026-01-01T00:00:00.000Z");
    const approval = new ApprovalService(database, {
      now: () => "2026-01-01T00:00:00.000Z",
      executionService: executions,
    }).requestApproval({
      id: "approval_1",
      actionRequestId: "action_1",
      executionId: "exec_1",
      actionType: "git.write",
      requiredPermission: "git.write_scoped",
      payload: { path: "src/app.ts" },
      idempotencyKey: "approval_req_1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    const app = buildApp(database);
    applications.push(app);

    const listedExecutions = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/executions",
      headers: humanHeaders(),
    });
    expect(listedExecutions.statusCode).toBe(200);
    expect(listedExecutions.json().items).toMatchObject([
      { id: "exec_1", state: "awaiting_approval", errorMessage: null },
    ]);

    const listedApprovals = await app.inject({
      method: "GET",
      url: "/api/approvals?projectId=prj_1&status=pending",
      headers: humanHeaders(),
    });
    expect(listedApprovals.statusCode).toBe(200);
    expect(listedApprovals.json().items).toMatchObject([
      { id: approval.id, status: "pending", projectId: "prj_1" },
    ]);

    const decision = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/decision`,
      headers: { ...humanHeaders(), "idempotency-key": "decision_1" },
      payload: { decision: "approved" },
    });
    expect(decision.statusCode).toBe(403);
    expect(decision.json()).toMatchObject({
      error: { code: "FORBIDDEN", message: "Approval owner authorization failed" },
    });

    const stillPending = await app.inject({
      method: "GET",
      url: "/api/approvals?projectId=prj_1&status=pending",
      headers: humanHeaders(),
    });
    expect(stillPending.json().items).toMatchObject([
      { id: approval.id, status: "pending" },
    ]);

    const crossProject = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1/executions",
      headers: {
        "x-coderoom-actor-id": "agt_2",
        "x-coderoom-assignment-id": "asgn_2",
      },
    });
    expect(crossProject.statusCode).toBe(403);
  });

  it("rejette les inputs invalides sans exposer une erreur interne", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/conversations/conv_main_1/messages?limit=not-a-number",
      headers: identityHeaders(),
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "limit must be an integer" },
    });
    expect(invalid.json().error).not.toHaveProperty("stack");
  });
});
