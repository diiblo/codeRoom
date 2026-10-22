import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ProjectService } from "./service.js";
import {
  ProjectRepositoryService,
  ProjectRepositoryServiceError,
} from "./repository-service.js";

const temporaryDirectories: string[] = [];

function createGitRepository(parent: string, name: string) {
  const repositoryPath = join(parent, name);
  const gitPath = join(repositoryPath, ".git");
  mkdirSync(join(gitPath, "objects"), { recursive: true });
  mkdirSync(join(gitPath, "refs"), { recursive: true });
  writeFileSync(join(gitPath, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(gitPath, "config"), "[core]\n repositoryformatversion = 0\n");
  return repositoryPath;
}

describe("project repository service", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: ProjectRepositoryService;
  let parent: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    const projects = new ProjectService(database);
    projects.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "One",
      idempotencyKey: "project_1",
    });
    projects.createProject({
      id: "prj_2",
      organizationId: "org_1",
      name: "Two",
      idempotencyKey: "project_2",
    });
    service = new ProjectRepositoryService(database);
    parent = mkdtempSync(join(tmpdir(), "coderoom-repositories-"));
    temporaryDirectories.push(parent);
  });

  afterEach(() => {
    database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function input(projectId: string, path: string, idempotencyKey = "link_1") {
    return {
      projectId,
      path,
      idempotencyKey,
      actor: { type: "human" as const, id: "owner_1" },
      correlationId: "corr_1",
    };
  }

  it("lie un dépôt Git canonique, expose ses permissions et audite la liaison", () => {
    const repositoryPath = createGitRepository(parent, "one");

    const linked = service.linkRepository(input("prj_1", repositoryPath));

    expect(linked).toEqual({
      projectId: "prj_1",
      repositoryPath,
      access: { readable: true, writable: true },
    });
    expect(
      database
        .prepare("SELECT repository_path AS repositoryPath FROM projects WHERE id = ?")
        .get("prj_1"),
    ).toEqual({ repositoryPath });
    expect(
      database
        .prepare("SELECT event_type AS type, project_id AS projectId FROM audit_events")
        .get(),
    ).toEqual({ type: "project.repository_linked", projectId: "prj_1" });
  });

  it("rejoue une même demande et refuse une réutilisation contradictoire", () => {
    const firstPath = createGitRepository(parent, "one");
    const secondPath = createGitRepository(parent, "two");
    const first = service.linkRepository(input("prj_1", firstPath));

    expect(service.linkRepository(input("prj_1", firstPath))).toEqual(first);
    expect(() => service.linkRepository(input("prj_1", secondPath))).toThrowError(
      new ProjectRepositoryServiceError(
        "CONFLICT",
        "Idempotency key was already used for another repository link",
      ),
    );
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_events").get(),
    ).toMatchObject({ count: 1 });
  });

  it("cloisonne un dépôt entre projets et refuse les projets archivés", () => {
    const repositoryPath = createGitRepository(parent, "shared");
    service.linkRepository(input("prj_1", repositoryPath, "link_1"));

    expect(() =>
      service.linkRepository(input("prj_2", repositoryPath, "link_2")),
    ).toThrowError(
      new ProjectRepositoryServiceError(
        "CONFLICT",
        "Repository is already linked to another project",
      ),
    );

    database
      .prepare("UPDATE projects SET status = 'archived' WHERE id = ?")
      .run("prj_2");
    const otherPath = createGitRepository(parent, "archived");
    expect(() =>
      service.linkRepository(input("prj_2", otherPath, "link_3")),
    ).toThrowError(
      new ProjectRepositoryServiceError(
        "FORBIDDEN",
        "Archived projects are not mutable",
      ),
    );
  });

  it("refuse les chemins relatifs, traversants, symlinkés, absents et non-Git", () => {
    const repositoryPath = createGitRepository(parent, "real");
    const linkPath = join(parent, "link");
    symlinkSync(repositoryPath, linkPath, "dir");
    const nonGitPath = join(parent, "not-git");
    mkdirSync(nonGitPath);

    expect(() => service.linkRepository(input("prj_1", "relative/repo"))).toThrowError(
      new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path must be absolute",
      ),
    );
    expect(() =>
      service.linkRepository(input("prj_1", `${repositoryPath}/../real`, "link_2")),
    ).toThrowError(
      new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path must not contain traversal segments",
      ),
    );
    expect(() =>
      service.linkRepository(input("prj_1", linkPath, "link_3")),
    ).toThrowError(
      new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path must not contain symbolic links",
      ),
    );
    expect(() =>
      service.linkRepository(input("prj_1", join(parent, "missing"), "link_4")),
    ).toThrowError(
      new ProjectRepositoryServiceError("NOT_FOUND", "Repository path does not exist"),
    );
    expect(() =>
      service.linkRepository(input("prj_1", nonGitPath, "link_5")),
    ).toThrowError(
      new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path is not a Git repository",
      ),
    );
  });

  it("n'exécute aucune commande Git et persiste la liaison après migration", () => {
    const repositoryPath = createGitRepository(parent, "persisted");
    service.linkRepository(input("prj_1", repositoryPath));

    expect(
      database
        .prepare(
          `
            SELECT repository_path AS repositoryPath
            FROM projects
            WHERE id = ?
          `,
        )
        .get("prj_1"),
    ).toEqual({ repositoryPath });
    expect(
      database
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name = 'project_repository_link_requests'
          `,
        )
        .get(),
    ).toEqual({ name: "project_repository_link_requests" });
  });
});
