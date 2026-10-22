import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository, transaction } from "../db/repository.js";
import { EventService } from "./service.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function appendEvent(
  database: ReturnType<typeof openDatabase>,
  service: EventService,
  input: Parameters<EventService["recordEvent"]>[0],
) {
  return transaction(database, () => service.recordEvent(input));
}

describe("event service", () => {
  it("garde la mutation et l'outbox atomiques", () => {
    const database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    const service = new EventService(database);

    expect(() =>
      transaction(database, () => {
        repository.createOrganization({ id: "org_1", name: "Local" });
        repository.createProject({
          id: "prj_1",
          organizationId: "org_1",
          name: "Rollback",
        });
        service.recordEvent({
          id: "evt_rollback",
          type: "project.created",
          version: 1,
          projectId: "prj_1",
          actor: { type: "system", id: "coderoom" },
          correlationId: "corr_rollback",
        });
        throw new Error("simulated crash");
      }),
    ).toThrow("simulated crash");
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM projects").get(),
    ).toMatchObject({
      count: 0,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_events").get(),
    ).toMatchObject({
      count: 0,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM event_outbox").get(),
    ).toMatchObject({
      count: 0,
    });

    transaction(database, () => {
      repository.createOrganization({ id: "org_1", name: "Local" });
      repository.createProject({
        id: "prj_1",
        organizationId: "org_1",
        name: "Committed",
      });
      service.recordEvent({
        id: "evt_committed",
        type: "project.created",
        version: 1,
        projectId: "prj_1",
        actor: { type: "system", id: "coderoom" },
        correlationId: "corr_committed",
      });
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM projects").get(),
    ).toMatchObject({
      count: 1,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM event_outbox").get(),
    ).toMatchObject({
      count: 1,
    });
    database.close();
  });

  it("lit par curseur et cloisonne par projet", () => {
    const database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
    repository.createProject({ id: "prj_2", organizationId: "org_1", name: "Two" });
    const service = new EventService(database);

    for (const [id, projectId, createdAt] of [
      ["evt_1", "prj_1", "2026-01-01T00:00:00.001Z"],
      ["evt_2", "prj_1", "2026-01-01T00:00:00.002Z"],
      ["evt_3", "prj_1", "2026-01-01T00:00:00.003Z"],
      ["evt_other", "prj_2", "2026-01-01T00:00:00.004Z"],
    ]) {
      appendEvent(database, service, {
        id,
        type: "message.posted",
        version: 1,
        projectId,
        actor: { type: "agent", id: "agt_1" },
        correlationId: id,
        createdAt,
        payload: { messageId: id },
      });
    }

    const newest = service.listEvents({ projectId: "prj_1", limit: 2 });
    expect(newest.items.map((event) => event.id)).toEqual(["evt_2", "evt_3"]);
    expect(newest.items.every((event) => event.projectId === "prj_1")).toBe(true);
    expect(newest.nextCursor).toBeDefined();

    const oldest = service.listEvents({
      projectId: "prj_1",
      limit: 2,
      before: newest.nextCursor,
    });
    expect(oldest.items.map((event) => event.id)).toEqual(["evt_1"]);
    expect(oldest.items.some((event) => event.id === "evt_other")).toBe(false);
    database.close();
  });

  it("retrouve l'événement après le redémarrage du publisher", () => {
    const directory = mkdtempSync(join(tmpdir(), "coderoom-events-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "events.sqlite");

    let database = openDatabase(filename);
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
    const service = new EventService(database);
    appendEvent(database, service, {
      id: "evt_restart",
      type: "project.created",
      version: 1,
      projectId: "prj_1",
      actor: { type: "system", id: "coderoom" },
      correlationId: "corr_restart",
    });

    expect(service.claimPending(1)).toMatchObject([
      { event: { id: "evt_restart" }, attempts: 1 },
    ]);
    database.close();

    database = openDatabase(filename);
    const restartedService = new EventService(database);
    expect(restartedService.claimPending(1)).toMatchObject([
      { event: { id: "evt_restart" }, attempts: 2 },
    ]);
    restartedService.markPublished("evt_restart");
    restartedService.markPublished("evt_restart");
    expect(restartedService.claimPending(1)).toEqual([]);
    expect(restartedService.pendingCount()).toBe(0);
    database.close();
  });

  it("expurge les secrets et les sorties brutes du payload", () => {
    const database = openDatabase(":memory:");
    const service = new EventService(database);
    appendEvent(database, service, {
      id: "evt_safe",
      type: "execution.failed",
      version: 1,
      actor: { type: "system", id: "coderoom" },
      correlationId: "corr_safe",
      payload: {
        executionId: "exec_1",
        token: "do-not-store",
        nested: { password: "do-not-store-either" },
        stdout: "raw command output",
      },
    });

    const event = service.listEvents().items[0];
    expect(event.payload).toEqual({
      executionId: "exec_1",
      token: "[REDACTED]",
      nested: { password: "[REDACTED]" },
      stdout: "[REDACTED]",
    });
    expect(JSON.stringify(event)).not.toContain("do-not-store");
    database.close();
  });
});
