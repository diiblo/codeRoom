import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { applyMigrations, migrations } from "./migrator.js";
import { createCoreRepository, transaction } from "./repository.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("core SQLite storage", () => {
  it("applique la migration sur une base vide et la rejoue sans erreur", () => {
    const database = openDatabase(":memory:");

    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("assignments"),
    ).toBeTruthy();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toMatchObject({ count: 22 });

    applyMigrations(database);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toMatchObject({ count: 22 });
    expect(
      database
        .prepare("SELECT id, name FROM organizations WHERE id = ?")
        .get("org_local"),
    ).toMatchObject({ id: "org_local", name: "Local workspace" });
    database.close();
  });

  it("refuse deux affectations actives pour le même agent et projet", () => {
    const database = openDatabase(":memory:");
    const repository = createCoreRepository(database);

    repository.createOrganization({ id: "org_1", name: "Local" });
    repository.createAgent({
      id: "agt_1",
      provider: "codex",
      displayName: "Codex",
      role: "developer",
    });
    repository.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "Demo",
    });
    repository.createAssignment({
      id: "asgn_1",
      projectId: "prj_1",
      agentId: "agt_1",
    });

    expect(() =>
      repository.createAssignment({
        id: "asgn_2",
        projectId: "prj_1",
        agentId: "agt_1",
      }),
    ).toThrow();

    database.close();
  });

  it("conserve les données après fermeture et réouverture", () => {
    const directory = mkdtempSync(join(tmpdir(), "coderoom-db-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "coderoom.sqlite");

    let database = openDatabase(filename);
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    database.close();

    database = openDatabase(filename);
    expect(
      database.prepare("SELECT name FROM organizations WHERE id = ?").get("org_1"),
    ).toMatchObject({ name: "Local" });
    database.close();
  });

  it("annule toute la transaction si une écriture échoue", () => {
    const database = openDatabase(":memory:");
    const repository = createCoreRepository(database);

    expect(() =>
      transaction(database, () => {
        repository.createOrganization({ id: "org_1", name: "Local" });
        repository.createOrganization({ id: "org_1", name: "Duplicate" });
      }),
    ).toThrow();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM organizations").get(),
    ).toMatchObject({ count: 1 });

    database.close();
  });

  it("refuse le démarrage si une migration échoue sans corrompre la base", () => {
    const directory = mkdtempSync(join(tmpdir(), "coderoom-migration-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "coderoom.sqlite");

    let database = openDatabase(filename);
    createCoreRepository(database).createOrganization({
      id: "org_1",
      name: "Local",
    });
    database.close();

    const failingMigration = {
      version: 23,
      name: "failing",
      sql: `
        CREATE TABLE migration_should_rollback (id INTEGER);
        INSERT INTO missing_table VALUES (1);
      `,
    };

    expect(() => openDatabase(filename, [...migrations, failingMigration])).toThrow();

    database = openDatabase(filename);
    expect(
      database.prepare("SELECT name FROM organizations WHERE id = ?").get("org_1"),
    ).toMatchObject({ name: "Local" });
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("migration_should_rollback"),
    ).toBeUndefined();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toMatchObject({ count: 22 });
    database.close();
  });
});
