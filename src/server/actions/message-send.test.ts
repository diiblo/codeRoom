import { afterEach, describe, expect, it } from "vitest";
import { ConversationService } from "../conversations/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ExecutionService } from "../executions/service.js";
import {
  MessageSendActionError,
  StructuredMessageActionService,
} from "./message-send.js";

const databases: Array<ReturnType<typeof openDatabase>> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  for (const [id, displayName] of [
    ["agt_1", "One"],
    ["agt_2", "Two"],
    ["agt_3", "Three"],
  ]) {
    repository.createAgent({
      id,
      provider: "fake",
      displayName,
      role: "developer",
    });
  }
  repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
  repository.createProject({ id: "prj_2", organizationId: "org_1", name: "Two" });
  repository.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: ["message.read", "message.send", "execution.request"],
  });
  repository.createAssignment({
    id: "asgn_2",
    projectId: "prj_1",
    agentId: "agt_2",
    permissionSet: ["message.read", "message.send"],
  });
  repository.createAssignment({
    id: "asgn_3",
    projectId: "prj_1",
    agentId: "agt_3",
    permissionSet: ["message.read", "message.send"],
  });
  repository.createAssignment({
    id: "asgn_4",
    projectId: "prj_2",
    agentId: "agt_1",
    permissionSet: ["message.read", "message.send", "execution.request"],
  });
  const conversations = new ConversationService(database);
  conversations.createDirectConversation({
    id: "conv_direct_1",
    projectId: "prj_1",
    participantAgentIds: ["agt_1", "agt_2"],
    idempotencyKey: "conv_req_1",
  });
  conversations.createDirectConversation({
    id: "conv_direct_2",
    projectId: "prj_1",
    participantAgentIds: ["agt_2", "agt_3"],
    idempotencyKey: "conv_req_2",
  });
  return database;
}

function runningExecution(database: ReturnType<typeof openDatabase>) {
  const executions = new ExecutionService(database);
  executions.enqueue({
    id: "exec_1",
    projectId: "prj_1",
    assignmentId: "asgn_1",
    triggerId: "trigger_1",
    instruction: "Inspect the repository",
    contextRefs: ["project:prj_1"],
    idempotencyKey: "exec_request_1",
  });
  return executions.reserveNext("worker_1", "2026-01-01T00:00:00.000Z");
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    action: {
      type: "message.send",
      actionId: "client-controlled-action-id",
      executionId: "exec_1",
      projectId: "prj_1",
      idempotencyKey: "action_request_1",
      payload: {
        conversationId: "conv_direct_1",
        text: "Please review this change",
      },
      ...overrides,
    },
    identity: { type: "agent" as const, id: "agt_1", assignmentId: "asgn_1" },
  };
}

describe("structured message.send action", () => {
  it("publie un message authentifié et rejoue le même résultat sans doublon", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredMessageActionService(database);

    const first = service.handle(action());
    const repeated = service.handle(action());

    expect(first).toMatchObject({
      actionId: expect.stringMatching(/^act_/),
      executionId: "exec_1",
      replayed: false,
      message: {
        conversationId: "conv_direct_1",
        authorType: "agent",
        authorId: "agt_1",
        text: "Please review this change",
      },
    });
    expect(first.actionId).not.toBe("client-controlled-action-id");
    expect(repeated).toMatchObject({
      actionId: first.actionId,
      executionId: "exec_1",
      replayed: true,
      message: first.message,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toMatchObject({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM message_send_actions").get(),
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("action.message_send.accepted"),
    ).toMatchObject({ count: 1 });
  });

  it("refuse un doublon contradictoire et garde une trace du refus", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredMessageActionService(database);
    service.handle(action());

    expect(() =>
      service.handle(
        action({
          payload: {
            conversationId: "conv_direct_1",
            text: "A different message",
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<MessageSendActionError>>({ code: "CONFLICT" }),
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("action.message_send.rejected"),
    ).toMatchObject({ count: 1 });
  });

  it("refuse l'identité falsifiée et le projet de l'exécution", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredMessageActionService(database);

    expect(() =>
      service.handle({
        ...action(),
        identity: { type: "agent", id: "agt_2", assignmentId: "asgn_2" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MessageSendActionError>>({ code: "FORBIDDEN" }),
    );
    expect(() =>
      service.handle(
        action({
          projectId: "prj_2",
          idempotencyKey: "action_request_cross_project",
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<MessageSendActionError>>({ code: "FORBIDDEN" }),
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toMatchObject({ count: 0 });
  });

  it("refuse une conversation privée dont l'agent n'est pas membre", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredMessageActionService(database);

    expect(() =>
      service.handle(
        action({
          idempotencyKey: "action_request_private_forbidden",
          payload: {
            conversationId: "conv_direct_2",
            text: "This must not cross the private boundary",
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<MessageSendActionError>>({ code: "FORBIDDEN" }),
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toMatchObject({ count: 0 });
  });

  it("rejette un payload qui tente de transporter une action JSON arbitraire", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredMessageActionService(database);

    expect(() =>
      service.handle(
        action({
          idempotencyKey: "action_request_unknown_field",
          payload: {
            conversationId: "conv_direct_1",
            text: "Message",
            command: "rm -rf /",
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<MessageSendActionError>>({
        code: "VALIDATION_ERROR",
      }),
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toMatchObject({ count: 0 });
  });
});
