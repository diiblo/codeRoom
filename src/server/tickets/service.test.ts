import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ConversationService } from "../conversations/service.js";
import { EventService } from "../events/service.js";
import { TicketService, TicketServiceError } from "./service.js";

const databases: Array<ReturnType<typeof openDatabase>> = [];
const temporaryDirectories: string[] = [];
const CLOCK = "2026-01-01T00:00:00.000Z";

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(filename = ":memory:") {
  const database = openDatabase(filename);
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
  repository.createProject({ id: "prj_2", organizationId: "org_1", name: "Two" });
  return database;
}

function createInput(
  overrides: Partial<Parameters<TicketService["createTicket"]>[0]> = {},
) {
  return {
    id: "ticket_1",
    projectId: "prj_1",
    title: "Ajouter une recherche",
    body: "Permettre de rechercher dans les projets.",
    author: { type: "human" as const, id: "owner_1" },
    acceptanceCriteria: ["Une recherche retourne un résultat déterministe"],
    idempotencyKey: "ticket_request_1",
    now: CLOCK,
    ...overrides,
  };
}

describe("TicketService", () => {
  it("crée idempotemment un ticket et le relit après réouverture de la DB", () => {
    const directory = mkdtempSync(join(tmpdir(), "coderoom-tickets-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "tickets.sqlite");

    let database = createFixture(filename);
    const service = new TicketService(database, { now: () => CLOCK });
    const first = service.createTicket(createInput());
    expect(first).toMatchObject({
      id: "ticket_1",
      projectId: "prj_1",
      state: "todo",
      authorType: "human",
      authorId: "owner_1",
    });
    expect(service.createTicket(createInput())).toEqual(first);
    const ticketConversation = new ConversationService(database).getTicketConversation(
      first.id,
    );
    expect(ticketConversation).toMatchObject({
      conversation: {
        projectId: "prj_1",
        kind: "ticket",
        ticketId: first.id,
      },
    });
    expect(service.listTransitions(first.id)).toMatchObject([
      { fromState: null, toState: "todo", actorId: "owner_1", reason: "created" },
    ]);
    expect(() =>
      service.createTicket(createInput({ title: "Autre titre" })),
    ).toThrowError(
      new TicketServiceError(
        "CONFLICT",
        "Idempotency key was already used for another ticket request",
      ),
    );
    database.close();
    databases.splice(databases.indexOf(database), 1);

    database = openDatabase(filename);
    databases.push(database);
    const restarted = new TicketService(database, { now: () => CLOCK });
    expect(restarted.getTicket(first.id)).toEqual(first);
    expect(restarted.listTransitions(first.id)).toHaveLength(1);
    expect(new ConversationService(database).getTicketConversation(first.id)).toEqual(
      ticketConversation,
    );
  });

  it("refuse la clôture directe, impose la raison de blocage et trace les transitions", () => {
    const database = createFixture();
    const service = new TicketService(database, { now: () => CLOCK });
    service.createTicket(createInput());

    expect(() =>
      service.transitionTicket({
        ticketId: "ticket_1",
        nextState: "done",
        actor: { type: "human", id: "owner_1" },
        idempotencyKey: "transition_direct_done",
        now: CLOCK,
      }),
    ).toThrowError(
      new TicketServiceError(
        "INVALID_TRANSITION",
        "Cannot transition ticket from todo to done",
      ),
    );
    expect(() =>
      service.transitionTicket({
        ticketId: "ticket_1",
        nextState: "blocked",
        actor: { type: "human", id: "owner_1" },
        idempotencyKey: "transition_blocked_missing_reason",
        now: CLOCK,
      }),
    ).toThrowError(
      new TicketServiceError("VALIDATION_ERROR", "A blocked ticket requires a reason"),
    );

    const blocked = service.transitionTicket({
      ticketId: "ticket_1",
      nextState: "blocked",
      actor: { type: "agent", id: "agt_1" },
      idempotencyKey: "transition_blocked",
      reason: "Le dépôt de référence est indisponible",
      now: "2026-01-01T00:00:01.000Z",
    });
    expect(blocked).toMatchObject({
      state: "blocked",
      blockedFromState: "todo",
      blockedReason: "Le dépôt de référence est indisponible",
    });
    expect(
      service.transitionTicket({
        ticketId: "ticket_1",
        nextState: "blocked",
        actor: { type: "agent", id: "agt_1" },
        idempotencyKey: "transition_blocked",
        reason: "Le dépôt de référence est indisponible",
        now: "2026-01-01T00:00:02.000Z",
      }),
    ).toEqual(blocked);

    service.transitionTicket({
      ticketId: "ticket_1",
      nextState: "in_progress",
      actor: { type: "agent", id: "agt_1" },
      idempotencyKey: "transition_progress",
      now: "2026-01-01T00:00:03.000Z",
    });
    service.transitionTicket({
      ticketId: "ticket_1",
      nextState: "in_review",
      actor: { type: "agent", id: "agt_1" },
      idempotencyKey: "transition_review",
      now: "2026-01-01T00:00:04.000Z",
    });
    const done = service.transitionTicket({
      ticketId: "ticket_1",
      nextState: "done",
      actor: { type: "human", id: "owner_1" },
      idempotencyKey: "transition_done",
      reason: "Revue validée",
      now: "2026-01-01T00:00:05.000Z",
    });
    expect(done).toMatchObject({ state: "done", blockedReason: null });
    expect(() =>
      service.transitionTicket({
        ticketId: "ticket_1",
        nextState: "todo",
        actor: { type: "human", id: "owner_1" },
        idempotencyKey: "transition_reopen_missing_reason",
        now: "2026-01-01T00:00:06.000Z",
      }),
    ).toThrowError(
      new TicketServiceError(
        "VALIDATION_ERROR",
        "Reopening a done ticket requires a reason",
      ),
    );
    const reopened = service.transitionTicket({
      ticketId: "ticket_1",
      nextState: "todo",
      actor: { type: "human", id: "owner_1" },
      idempotencyKey: "transition_reopen",
      reason: "Corrections demandées",
      now: "2026-01-01T00:00:07.000Z",
    });
    expect(reopened).toMatchObject({ state: "todo" });
    expect(service.listTransitions("ticket_1")).toHaveLength(6);
    expect(
      new EventService(database)
        .listEvents({ projectId: "prj_1" })
        .items.map((event) => event.type),
    ).toEqual([
      "ticket.created",
      "ticket.state_changed",
      "ticket.state_changed",
      "ticket.state_changed",
      "ticket.state_changed",
      "ticket.state_changed",
    ]);
  });

  it("garde les tickets cloisonnés par projet et refuse un projet archivé", () => {
    const database = createFixture();
    const service = new TicketService(database, { now: () => CLOCK });
    service.createTicket(createInput());
    service.createTicket(
      createInput({
        id: "ticket_2",
        projectId: "prj_2",
        idempotencyKey: "ticket_request_2",
      }),
    );

    expect(service.listTickets({ projectId: "prj_1" })).toMatchObject([
      { id: "ticket_1", projectId: "prj_1" },
    ]);
    database
      .prepare("UPDATE projects SET status = 'archived' WHERE id = ?")
      .run("prj_1");
    expect(() =>
      service.createTicket(
        createInput({ id: "ticket_3", idempotencyKey: "ticket_request_3" }),
      ),
    ).toThrowError(
      new TicketServiceError("FORBIDDEN", "Archived projects are not mutable"),
    );
  });
});
