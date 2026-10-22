import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { MentionRoutingService, parseMentions } from "./service.js";

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
    permissionSet: ["message.send", "execution.request"],
  });
  repository.createAssignment({
    id: "asgn_2",
    projectId: "prj_1",
    agentId: "agt_2",
    permissionSet: ["message.send", "execution.request"],
  });
  repository.createAssignment({
    id: "asgn_3",
    projectId: "prj_1",
    agentId: "agt_3",
    permissionSet: ["message.send"],
  });
  repository.createAssignment({
    id: "asgn_4",
    projectId: "prj_2",
    agentId: "agt_1",
    permissionSet: ["message.send", "execution.request"],
  });
  database
    .prepare(
      `
        INSERT INTO providers (provider, display_name, status)
        VALUES ('fake', 'Fake', 'available')
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO conversations (id, project_id, kind)
        VALUES ('conv_main_1', 'prj_1', 'main'), ('conv_main_2', 'prj_2', 'main')
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO conversations (id, project_id, kind)
        VALUES ('conv_direct_1', 'prj_1', 'direct')
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO conversation_participants (conversation_id, agent_id)
        VALUES ('conv_direct_1', 'agt_1'), ('conv_direct_1', 'agt_2')
      `,
    )
    .run();
  return database;
}

function insertMessage(
  database: ReturnType<typeof openDatabase>,
  input: {
    id: string;
    conversationId: string;
    text: string;
    authorType?: "agent" | "human" | "system";
    authorId?: string;
  },
) {
  database
    .prepare(
      `
        INSERT INTO messages
          (id, conversation_id, author_type, author_id, body, message_references)
        VALUES (?, ?, ?, ?, ?, '[]')
      `,
    )
    .run(
      input.id,
      input.conversationId,
      input.authorType ?? "human",
      input.authorId ?? "human_1",
      input.text,
    );
}

describe("mention routing service", () => {
  it("parse les ids, déduplique et ignore @tous et les adresses email", () => {
    expect(parseMentions("Bonjour @agt_2, @agt_2 @tous et x@agt_3")).toEqual([
      { targetAgentId: "agt_2", triggerKind: "mention" },
    ]);
  });

  it("ne crée aucune intention pour un message ordinaire ou @tous", () => {
    const database = createFixture();
    const service = new MentionRoutingService(database);
    insertMessage(database, {
      id: "msg_plain",
      conversationId: "conv_main_1",
      text: "Bonjour tout le monde",
    });
    insertMessage(database, {
      id: "msg_all",
      conversationId: "conv_main_1",
      text: "@tous, voici une information",
    });

    expect(service.routeMessage("msg_plain").intentions).toEqual([]);
    expect(service.routeMessage("msg_all").intentions).toEqual([]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM mention_intentions").get(),
    ).toMatchObject({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM executions").get(),
    ).toMatchObject({
      count: 0,
    });
  });

  it("met une mention valide en file une seule fois malgré répétition et rediffusion", () => {
    const database = createFixture();
    const service = new MentionRoutingService(database);
    insertMessage(database, {
      id: "msg_valid",
      conversationId: "conv_main_1",
      text: "Peux-tu regarder @agt_2 @agt_2 ?",
    });

    const first = service.routeMessage("msg_valid");
    const repeated = service.routeMessage("msg_valid");
    expect(first.intentions).toHaveLength(1);
    expect(first.intentions[0]).toMatchObject({
      messageId: "msg_valid",
      targetAgentId: "agt_2",
      status: "queued",
      assignmentId: "asgn_2",
      executionId: expect.any(String),
      reason: null,
    });
    expect(repeated).toEqual(first);
    expect(service.listIntentions("msg_valid")).toEqual(first.intentions);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM mention_intentions WHERE message_id = ?",
        )
        .get("msg_valid"),
    ).toMatchObject({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM executions").get(),
    ).toMatchObject({
      count: 1,
    });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("mention.routed"),
    ).toMatchObject({ count: 1 });
  });

  it("conserve un refus durable pour une cible absente, archivée ou hors conversation", () => {
    const database = createFixture();
    const service = new MentionRoutingService(database);
    insertMessage(database, {
      id: "msg_absent",
      conversationId: "conv_main_1",
      text: "@ghost peux-tu aider ?",
    });
    expect(service.routeMessage("msg_absent").intentions[0]).toMatchObject({
      status: "rejected",
      targetAgentId: "ghost",
      reason: "recipient_absent",
    });

    database
      .prepare(
        "UPDATE agents SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
      )
      .run("agt_2");
    insertMessage(database, {
      id: "msg_archived",
      conversationId: "conv_main_1",
      text: "@agt_2 peux-tu aider ?",
    });
    expect(service.routeMessage("msg_archived").intentions[0]).toMatchObject({
      status: "rejected",
      targetAgentId: "agt_2",
      reason: "recipient_archived",
    });

    database.prepare("UPDATE agents SET archived_at = NULL WHERE id = ?").run("agt_2");
    database
      .prepare(
        "DELETE FROM conversation_participants WHERE conversation_id = ? AND agent_id = ?",
      )
      .run("conv_direct_1", "agt_2");
    insertMessage(database, {
      id: "msg_private",
      conversationId: "conv_direct_1",
      text: "@agt_2 message privé",
    });
    expect(service.routeMessage("msg_private").intentions[0]).toMatchObject({
      status: "rejected",
      targetAgentId: "agt_2",
      reason: "conversation_membership_required",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM executions").get(),
    ).toMatchObject({
      count: 0,
    });
  });

  it("désactive les mentions issues d'une sortie d'agent et bloque A-B-A", () => {
    const database = createFixture();
    const service = new MentionRoutingService(database);
    insertMessage(database, {
      id: "msg_agent_a",
      conversationId: "conv_main_1",
      authorType: "agent",
      authorId: "agt_1",
      text: "@agt_2 réponse automatique",
    });
    insertMessage(database, {
      id: "msg_agent_b",
      conversationId: "conv_main_1",
      authorType: "agent",
      authorId: "agt_2",
      text: "@agt_1 réponse automatique",
    });

    expect(service.routeMessage("msg_agent_a").intentions[0]).toMatchObject({
      status: "rejected",
      reason: "agent_auto_mention_disabled",
    });
    expect(service.routeMessage("msg_agent_b").intentions[0]).toMatchObject({
      status: "rejected",
      reason: "agent_auto_mention_disabled",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM executions").get(),
    ).toMatchObject({
      count: 0,
    });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("mention.rejected"),
    ).toMatchObject({ count: 2 });
  });
});
