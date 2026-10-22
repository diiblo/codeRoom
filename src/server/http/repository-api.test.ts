import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ProjectService } from "../projects/service.js";
import { buildApp } from "../app.js";

const applications: Array<ReturnType<typeof buildApp>> = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  const projects = new ProjectService(database);
  projects.createProject({
    id: "prj_1",
    organizationId: "org_1",
    name: "One",
    idempotencyKey: "project_1",
  });
  const parent = mkdtempSync(join(tmpdir(), "coderoom-api-repository-"));
  temporaryDirectories.push(parent);
  const repositoryPath = join(parent, "repo");
  mkdirSync(join(repositoryPath, ".git", "objects"), { recursive: true });
  mkdirSync(join(repositoryPath, ".git", "refs"), { recursive: true });
  writeFileSync(join(repositoryPath, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(repositoryPath, ".git", "config"), "[core]\n");
  return { database, repositoryPath };
}

describe("API de liaison dépôt-projet", () => {
  it("réserve la liaison au propriétaire humain et expose le chemin au projet", async () => {
    const { database, repositoryPath } = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/prj_1/repository",
      headers: {
        "x-coderoom-actor-id": "owner_1",
        "x-coderoom-actor-type": "human",
        "idempotency-key": "repository_link_1",
      },
      payload: { path: repositoryPath },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repository: {
        projectId: "prj_1",
        repositoryPath,
        access: { readable: true, writable: true },
      },
    });

    const project = await app.inject({
      method: "GET",
      url: "/api/projects/prj_1",
      headers: { "x-coderoom-actor-id": "owner_1", "x-coderoom-actor-type": "human" },
    });
    expect(project.statusCode).toBe(200);
    expect(project.json().project.repositoryPath).toBe(repositoryPath);
  });

  it("refuse une identité agent et un chemin traversant", async () => {
    const { database, repositoryPath } = createFixture();
    const app = buildApp(database);
    applications.push(app);

    const agentResponse = await app.inject({
      method: "PUT",
      url: "/api/projects/prj_1/repository",
      headers: {
        "x-coderoom-actor-id": "agt_1",
        "x-coderoom-actor-type": "agent",
        "idempotency-key": "repository_link_1",
      },
      payload: { path: repositoryPath },
    });
    expect(agentResponse.statusCode).toBe(403);

    const traversalResponse = await app.inject({
      method: "PUT",
      url: "/api/projects/prj_1/repository",
      headers: {
        "x-coderoom-actor-id": "owner_1",
        "x-coderoom-actor-type": "human",
        "idempotency-key": "repository_link_2",
      },
      payload: { path: `${repositoryPath}/../repo` },
    });
    expect(traversalResponse.statusCode).toBe(422);
    expect(traversalResponse.json().error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Repository path must not contain traversal segments",
    });
  });
});
