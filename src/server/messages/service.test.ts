import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ConversationService } from "../conversations/service.js";
import { MessageService, MessageServiceError } from "./service.js";

function createFixture(filename = ":memory:") {
  const database = openDatabase(filename);
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
  repository.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: ["message.read", "message.send"],
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
    permissionSet: ["message.read"],
  });
  repository.createAssignment({
    id: "asgn_4",
    projectId: "prj_2",
    agentId: "agt_1",
    permissionSet: ["message.read", "message.send"],
  });
  repository.createAssignment({
    id: "asgn_5",
    projectId: "prj_2",
    agentId: "agt_4",
    permissionSet: ["message.read", "message.send"],
  });
  new ConversationService(database).createDirectConversation({
    id: "conv_direct_1",
    projectId: "prj_1",
    participantAgentIds: ["agt_1", "agt_2"],
    idempotencyKey: "conv_req_1",
  });
  new ConversationService(database).createDirectConversation({
    id: "conv_direct_2",
    projectId: "prj_2",
    participantAgentIds: ["agt_1", "agt_4"],
    idempotencyKey: "conv_req_2",
  });
  return database;
}

describe("message service", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: MessageService;

  beforeEach(() => {
    database = createFixture();
    service = new MessageService(database);
  });

  afterEach(() => database.close());

  it("persiste l'auteur serveur et expurge les champs de référence inconnus", () => {
    const first = service.sendMessage({
      id: "msg_1",
      conversationId: "conv_direct_1",
      identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      text: "Bonjour",
      references: [
        {
          type: "project",
          id: "prj_1",
          secret: "must-not-be-stored",
        },
      ],
      idempotencyKey: "msg_req_1",
    });
    const repeated = service.sendMessage({
      id: "msg_1",
      conversationId: "conv_direct_1",
      identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      text: "Bonjour",
      references: [{ type: "project", id: "prj_1" }],
      idempotencyKey: "msg_req_1",
    });
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      id: "msg_1",
      conversationId: "conv_direct_1",
      authorType: "agent",
      authorId: "agt_1",
      text: "Bonjour",
      references: [{ type: "project", id: "prj_1" }],
    });
    expect(JSON.stringify(first)).not.toContain("must-not-be-stored");
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE id = ?")
        .get("msg_1"),
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("message.posted"),
    ).toMatchObject({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM event_outbox").get(),
    ).toMatchObject({
      count: 1,
    });
  });

  it("lit un historique paginé dans un ordre stable", () => {
    for (const number of [1, 2, 3, 4, 5]) {
      service.sendMessage({
        id: `msg_0${number}`,
        conversationId: "conv_direct_1",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
        text: `Message ${number}`,
        idempotencyKey: `msg_req_${number}`,
      });
    }

    const newest = service.listMessages({
      conversationId: "conv_direct_1",
      identity: { type: "agent", id: "agt_2", assignmentId: "asgn_2" },
      limit: 2,
    });
    expect(newest.items.map((message) => message.id)).toEqual(["msg_04", "msg_05"]);
    expect(newest.nextCursor).toBeDefined();

    const middle = service.listMessages({
      conversationId: "conv_direct_1",
      identity: { type: "agent", id: "agt_2", assignmentId: "asgn_2" },
      limit: 2,
      before: newest.nextCursor,
    });
    expect(middle.items.map((message) => message.id)).toEqual(["msg_02", "msg_03"]);
    expect(middle.nextCursor).toBeDefined();

    const oldest = service.listMessages({
      conversationId: "conv_direct_1",
      identity: { type: "agent", id: "agt_2", assignmentId: "asgn_2" },
      limit: 2,
      before: middle.nextCursor,
    });
    expect(oldest.items.map((message) => message.id)).toEqual(["msg_01"]);
    expect(oldest.nextCursor).toBeUndefined();
  });

  it("refuse l'usurpation, les accès privés et les références cross-project", () => {
    expect(() =>
      service.sendMessage({
        id: "msg_spoof",
        conversationId: "conv_direct_1",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
        untrustedAuthorId: "agt_2",
        text: "spoof",
        idempotencyKey: "msg_req_spoof",
      }),
    ).toThrowError(
      new MessageServiceError("FORBIDDEN", "Message sending is not authorized"),
    );
    expect(() =>
      service.listMessages({
        conversationId: "conv_direct_1",
        identity: { type: "agent", id: "agt_3", assignmentId: "asgn_3" },
      }),
    ).toThrowError(new MessageServiceError("FORBIDDEN", "Conversation access denied"));
    expect(() =>
      service.sendMessage({
        id: "msg_cross_ref",
        conversationId: "conv_direct_1",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
        text: "cross reference",
        references: [{ type: "project", id: "prj_2" }],
        idempotencyKey: "msg_req_cross_ref",
      }),
    ).toThrowError(
      new MessageServiceError(
        "FORBIDDEN",
        "Message reference belongs to another project",
      ),
    );
    expect(() =>
      service.listMessages({
        conversationId: "conv_direct_1",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_4" },
      }),
    ).toThrowError(
      new MessageServiceError("FORBIDDEN", "Message reading is not authorized"),
    );
  });

  it("conserve l'historique après réouverture de la base", () => {
    const directory = mkdtempSync(join(tmpdir(), "coderoom-messages-"));
    const filename = join(directory, "messages.sqlite");
    const fileDatabase = createFixture(filename);
    const fileService = new MessageService(fileDatabase);
    fileService.sendMessage({
      id: "msg_persisted",
      conversationId: "conv_direct_1",
      identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      text: "Après redémarrage",
      idempotencyKey: "msg_req_persisted",
    });
    fileDatabase.close();
    const reopened = openDatabase(filename);
    try {
      const page = new MessageService(reopened).listMessages({
        conversationId: "conv_direct_1",
        identity: { type: "agent", id: "agt_2", assignmentId: "asgn_2" },
      });
      expect(page.items).toMatchObject([
        { id: "msg_persisted", text: "Après redémarrage" },
      ]);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
