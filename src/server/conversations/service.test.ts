import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { MessageService } from "../messages/service.js";
import { ConversationService, ConversationServiceError } from "./service.js";

describe("conversation service", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: ConversationService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    for (const [id, displayName] of [
      ["agt_1", "One"],
      ["agt_2", "Two"],
      ["agt_3", "Three"],
      ["agt_4", "Four"],
    ]) {
      repository.createAgent({
        id,
        provider: "codex",
        displayName,
        role: "developer",
      });
    }
    repository.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "One",
    });
    repository.createProject({
      id: "prj_2",
      organizationId: "org_1",
      name: "Two",
    });
    for (const [id, projectId, agentId] of [
      ["asgn_1", "prj_1", "agt_1"],
      ["asgn_2", "prj_1", "agt_2"],
      ["asgn_3", "prj_1", "agt_3"],
      ["asgn_4", "prj_2", "agt_1"],
      ["asgn_5", "prj_2", "agt_2"],
      ["asgn_6", "prj_2", "agt_4"],
    ]) {
      repository.createAssignment({
        id,
        projectId,
        agentId,
        permissionSet: ["message.read", "message.send"],
      });
    }
    database
      .prepare("INSERT INTO conversations (id, project_id, kind) VALUES (?, ?, 'main')")
      .run("conv_main_1", "prj_1");
    database
      .prepare("INSERT INTO conversations (id, project_id, kind) VALUES (?, ?, 'main')")
      .run("conv_main_2", "prj_2");
    service = new ConversationService(database);
  });

  afterEach(() => database.close());

  it("garantit un main unique et dérive ses participants des affectations", () => {
    const main = service.getMainConversation("prj_1");
    expect(main).toMatchObject({
      conversation: { id: "conv_main_1", projectId: "prj_1", kind: "main" },
      participants: [{ agentId: "agt_1" }, { agentId: "agt_2" }, { agentId: "agt_3" }],
    });
    expect(
      service.listAccessibleConversations({ projectId: "prj_1", agentId: "agt_1" }),
    ).toMatchObject([{ id: "conv_main_1", kind: "main" }]);

    expect(() =>
      database
        .prepare(
          "INSERT INTO conversations (id, project_id, kind) VALUES (?, ?, 'main')",
        )
        .run("conv_main_duplicate", "prj_1"),
    ).toThrow();

    database
      .prepare(
        "UPDATE assignments SET status = 'archived', archived_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), "asgn_3");
    expect(service.listParticipants("conv_main_1")).not.toContainEqual(
      expect.objectContaining({ agentId: "agt_3" }),
    );
  });

  it("crée une conversation directe idempotente dans un seul projet", () => {
    const first = service.createDirectConversation({
      id: "conv_direct_1",
      projectId: "prj_1",
      participantAgentIds: ["agt_2", "agt_1"],
      idempotencyKey: "req_1",
    });
    const repeated = service.createDirectConversation({
      id: "conv_direct_1",
      projectId: "prj_1",
      participantAgentIds: ["agt_1", "agt_2"],
      idempotencyKey: "req_1",
    });
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      conversation: { id: "conv_direct_1", kind: "direct", projectId: "prj_1" },
      participants: [{ agentId: "agt_1" }, { agentId: "agt_2" }],
    });
    expect(
      service.canAccess({ conversationId: "conv_direct_1", agentId: "agt_1" }),
    ).toBe(true);
    expect(
      service.canAccess({ conversationId: "conv_direct_1", agentId: "agt_3" }),
    ).toBe(false);
    expect(() =>
      service.assertAccessible({ conversationId: "conv_direct_1", agentId: "agt_3" }),
    ).toThrowError(
      new ConversationServiceError("FORBIDDEN", "Conversation access denied"),
    );
    expect(() =>
      service.createDirectConversation({
        id: "conv_cross_project",
        projectId: "prj_1",
        participantAgentIds: ["agt_1", "agt_4"],
        idempotencyKey: "req_cross_project",
      }),
    ).toThrowError(
      new ConversationServiceError(
        "FORBIDDEN",
        "Agent is not an active member of this project",
      ),
    );
  });

  it("gère l'ajout et le retrait idempotents des participants directs", () => {
    service.createDirectConversation({
      id: "conv_direct_1",
      projectId: "prj_1",
      participantAgentIds: ["agt_1", "agt_2"],
      idempotencyKey: "req_1",
    });
    const added = service.addParticipant({
      conversationId: "conv_direct_1",
      agentId: "agt_3",
    });
    expect(added).toMatchObject({
      conversationId: "conv_direct_1",
      agentId: "agt_3",
    });
    expect(
      service.addParticipant({ conversationId: "conv_direct_1", agentId: "agt_3" }),
    ).toEqual(added);
    expect(
      service.canAccess({ conversationId: "conv_direct_1", agentId: "agt_3" }),
    ).toBe(true);
    service.removeParticipant({
      conversationId: "conv_direct_1",
      agentId: "agt_3",
    });
    service.removeParticipant({
      conversationId: "conv_direct_1",
      agentId: "agt_3",
    });
    expect(
      service.canAccess({ conversationId: "conv_direct_1", agentId: "agt_3" }),
    ).toBe(false);
  });

  it("crée une conversation ticket unique et la limite aux membres du projet", () => {
    database
      .prepare(
        `
          INSERT INTO tickets
            (id, project_id, title, body, author_type, author_id, acceptance_criteria)
          VALUES (?, ?, ?, ?, 'agent', ?, ?)
        `,
      )
      .run(
        "ticket_1",
        "prj_1",
        "Ticket conversation",
        "Keep the discussion scoped",
        "agt_1",
        JSON.stringify(["A conversation exists"]),
      );

    const first = service.createTicketConversation({
      projectId: "prj_1",
      ticketId: "ticket_1",
    });
    const repeated = service.createTicketConversation({
      projectId: "prj_1",
      ticketId: "ticket_1",
    });

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      conversation: {
        kind: "ticket",
        projectId: "prj_1",
        ticketId: "ticket_1",
      },
      participants: [{ agentId: "agt_1" }, { agentId: "agt_2" }, { agentId: "agt_3" }],
    });
    expect(
      service.listAccessibleConversations({ projectId: "prj_1", agentId: "agt_1" }),
    ).toContainEqual(
      expect.objectContaining({ id: first.conversation.id, kind: "ticket" }),
    );
    expect(
      service.canAccess({ conversationId: first.conversation.id, agentId: "agt_4" }),
    ).toBe(false);
    expect(() =>
      database
        .prepare(
          "INSERT INTO conversations (id, project_id, kind, ticket_id) VALUES (?, ?, 'ticket', ?)",
        )
        .run("conv_duplicate_ticket", "prj_1", "ticket_1"),
    ).toThrow();
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM conversations WHERE kind = 'ticket'")
        .get(),
    ).toMatchObject({ count: 1 });
    expect(service.getTicketConversation("ticket_1")).toEqual(first);

    const messages = new MessageService(database);
    messages.sendMessage({
      id: "msg_ticket_1",
      conversationId: first.conversation.id,
      identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      text: "Historique ticket disponible",
      idempotencyKey: "msg_ticket_request_1",
    });
    expect(
      messages.listMessages({
        conversationId: first.conversation.id,
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      }).items,
    ).toMatchObject([{ id: "msg_ticket_1", conversationId: first.conversation.id }]);
  });

  it("refuse les créations invalides et les changements du main", () => {
    expect(() =>
      service.createDirectConversation({
        id: "conv_direct_1",
        projectId: "prj_1",
        participantAgentIds: ["agt_1"],
        idempotencyKey: "req_1",
      }),
    ).toThrowError(
      new ConversationServiceError(
        "VALIDATION_ERROR",
        "A direct conversation requires at least two participants",
      ),
    );
    expect(() =>
      service.addParticipant({ conversationId: "conv_main_1", agentId: "agt_1" }),
    ).toThrowError(
      new ConversationServiceError(
        "FORBIDDEN",
        "Main conversation membership follows project assignments",
      ),
    );
    expect(() =>
      service.createDirectConversation({
        id: "conv_direct_1",
        projectId: "prj_1",
        participantAgentIds: ["agt_1", "agt_2"],
        idempotencyKey: "req_1",
      }),
    ).not.toThrow();
    expect(() =>
      service.createDirectConversation({
        id: "conv_other",
        projectId: "prj_2",
        participantAgentIds: ["agt_1", "agt_2"],
        idempotencyKey: "req_1",
      }),
    ).toThrowError(
      new ConversationServiceError(
        "CONFLICT",
        "Idempotency key was already used for another conversation request",
      ),
    );
  });
});
