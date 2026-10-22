// Run inside a disposable Compose container; fixtures never mutate the user's database.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";

const require = createRequire("/tmp/coderoom-ui-qa/package.json");
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");
const artifacts = "/workspace/.runtime/ui-qa";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  locale: "fr-FR",
});
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
const projects = [
  {
    id: "prj_portal",
    name: "Portail client",
    description: "Une expérience unifiée pour nos clients.",
    status: "active",
  },
  {
    id: "prj_mobile",
    name: "Application mobile",
    description: "Le produit, partout avec vous.",
    status: "active",
  },
  {
    id: "prj_design",
    name: "Design system",
    description: "Composants et standards de l’équipe.",
    status: "archived",
  },
].map((item) => ({
  ...item,
  organizationId: "org_local",
  repositoryPath: null,
  createdAt: "2026-10-22T09:00:00Z",
}));
const agents = [
  {
    id: "agt_alex",
    displayName: "Alex Martin",
    role: "Développeur frontend",
    description: "Interfaces et accessibilité",
    instructions: "Tester les parcours clavier.",
    archivedAt: null,
    createdAt: "2026-10-22T09:00:00Z",
    provider: null,
    providerState: "missing",
    executable: false,
  },
];
let unavailable = false;
let failSave = false;
let emptySummary = false;
let failDashboard = false;
let tools = [
  { id: "codex", source: "known-path" },
  { id: "opencode", source: "path" },
];
const requests = [];
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  requests.push({ path, method });
  const reply = (value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  if (method === "OPTIONS") return route.fulfill({ status: 204 });
  if (unavailable)
    return reply({ error: { message: "Service temporairement indisponible" } }, 503);
  if (path === "/api/v1/status")
    return reply({ hostTools: { state: "connected", tools } });
  if (path === "/api/projects" && method === "GET") return reply({ items: projects });
  if (path === "/api/agents" && method === "GET") return reply({ items: agents });
  if (path === "/api/dashboard" && failDashboard)
    return reply(
      { error: { message: "Statistiques temporairement indisponibles" } },
      503,
    );
  if (path === "/api/dashboard" && emptySummary)
    return reply({
      organizationId: "org_local",
      projects: { active: 0, archived: 0 },
      agents: { active: 0, archived: 0 },
      assignments: { active: 0 },
      tickets: {
        todo: 0,
        in_progress: 0,
        in_review: 0,
        done: 0,
        blocked: 0,
        cancelled: 0,
      },
      executions: {
        queued: 0,
        running: 0,
        awaiting_approval: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        unknown: 0,
      },
      approvals: { pending: 0 },
      recentProjects: [],
      recentActivity: [],
    });
  if (path === "/api/dashboard")
    return reply({
      organizationId: "org_local",
      projects: {
        active: projects.filter((p) => p.status === "active").length,
        archived: projects.filter((p) => p.status !== "active").length,
      },
      agents: {
        active: agents.filter((a) => !a.archivedAt).length,
        archived: agents.filter((a) => a.archivedAt).length,
      },
      assignments: { active: 3 },
      tickets: {
        todo: 8,
        in_progress: 5,
        in_review: 3,
        done: 12,
        blocked: 2,
        cancelled: 1,
      },
      executions: {
        queued: 2,
        running: 1,
        awaiting_approval: 1,
        succeeded: 14,
        failed: 1,
        cancelled: 0,
        unknown: 0,
      },
      approvals: { pending: 1 },
      recentProjects: projects,
      recentActivity: [
        {
          id: "evt_1",
          type: "ticket.created",
          projectId: "prj_portal",
          createdAt: "2026-10-22T10:00:00Z",
        },
        {
          id: "evt_2",
          type: "execution.completed",
          projectId: "prj_mobile",
          createdAt: "2026-10-22T09:00:00Z",
        },
      ],
    });
  if ((path === "/api/projects" || path === "/api/agents") && method === "POST") {
    if (failSave)
      return reply({ error: { message: "Enregistrement refusé pour ce test" } }, 422);
    const body = request.postDataJSON();
    if (path === "/api/projects") {
      const project = {
        ...body,
        status: "active",
        repositoryPath: null,
        createdAt: "2026-10-22T09:00:00Z",
      };
      projects.push(project);
      return reply({ project: { project } }, 201);
    }
    assert.equal(body.provider, undefined, "Global profile must not define a provider");
    const agent = {
      ...body,
      archivedAt: null,
      createdAt: "2026-10-22T09:00:00Z",
      provider: null,
      providerState: "missing",
      executable: false,
    };
    agents.push(agent);
    return reply({ agent }, 201);
  }
  const projectMatch = path.match(
    /^\/api\/projects\/([^/]+)(\/archive|\/assignments|\/tickets|\/executions)?$/,
  );
  if (projectMatch) {
    const project = projects.find((p) => p.id === projectMatch[1]);
    if (!project) return reply({ error: { message: "Espace introuvable" } }, 404);
    if (projectMatch[2] === "/archive") {
      project.status = "archived";
      return reply({ project });
    }
    if (["/assignments", "/tickets", "/executions"].includes(projectMatch[2]))
      return reply({ items: [] });
    if (method === "PATCH") Object.assign(project, request.postDataJSON());
    return reply({
      project,
      mainConversation: {
        id: "main_1",
        projectId: project.id,
        kind: "main",
        createdAt: project.createdAt,
      },
    });
  }
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)(\/archive)?$/);
  if (agentMatch) {
    const agent = agents.find((a) => a.id === agentMatch[1]);
    if (!agent) return reply({}, 404);
    if (agentMatch[2]) agent.archivedAt = "2026-10-22T11:00:00Z";
    else Object.assign(agent, request.postDataJSON());
    return reply({ agent });
  }
  if (path === "/api/approvals") return reply({ items: [] });
  return reply(
    { error: { message: `Unexpected fixture request: ${method} ${path}` } },
    404,
  );
});

async function checkA11y(label) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
    `Accessibility: ${label}`,
  );
}
async function title(value) {
  await page.getByRole("heading", { level: 1, name: value, exact: true }).waitFor();
  assert.equal(await page.locator("h1").count(), 1);
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    true,
    "Page must fit the viewport",
  );
}

try {
  await page.goto(process.env.CODEROOM_QA_URL || "http://web:5173");
  await title("Dashboard");
  await page.getByRole("heading", { name: "Répartition des tickets" }).waitFor();
  assert.equal(
    await page
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .getByRole("link")
      .count(),
    3,
  );
  await checkA11y("dashboard");
  await page.screenshot({ path: `${artifacts}/dashboard-desktop.png`, fullPage: true });

  await page.getByRole("link", { name: "Espaces de travail", exact: true }).click();
  await title("Espaces de travail");
  assert.equal(
    await page.getByRole("button", { name: "Ajouter un espace", exact: true }).count(),
    1,
  );
  await checkA11y("projects");
  await page.screenshot({ path: `${artifacts}/espaces-desktop.png`, fullPage: true });
  await page.getByRole("searchbox", { name: "Rechercher un espace" }).fill("mobile");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("link", { name: /Portail client/ }).click();
  await title("Portail client");
  assert.match(page.url(), /#\/espaces\/prj_portal\/overview$/);
  await page.reload();
  await title("Portail client");
  await page.getByRole("link", { name: "Équipe", exact: true }).click();
  await page.getByRole("button", { name: "Affecter un profil", exact: true }).click();
  const provider = page.getByRole("combobox", { name: "Fournisseur pour cet espace" });
  assert.deepEqual(await provider.locator("option").allTextContents(), [
    "Choisir un outil détecté",
    "codex",
    "opencode",
  ]);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("link", { name: "Vue d’ensemble", exact: true }).click();
  await page.screenshot({ path: `${artifacts}/espace-ouvert.png`, fullPage: true });
  for (const name of ["Tickets", "Messages", "Activité"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await page.locator("main section").first().waitFor();
    await checkA11y(`project ${name}`);
  }
  await page.getByRole("link", { name: "Tous les espaces", exact: true }).click();
  await page
    .getByRole("button", { name: "Modifier Portail client", exact: true })
    .click();
  await page
    .getByLabel("Nom de l’espace", { exact: true })
    .fill("Portail client amélioré");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("link", { name: /Portail client amélioré/ }).waitFor();
  await page.getByRole("button", { name: "Ajouter un espace", exact: true }).click();
  await page.getByLabel("Nom de l’espace", { exact: true }).fill("Espace QA");
  failSave = true;
  await page.getByRole("button", { name: "Créer l’espace", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByLabel("Nom de l’espace", { exact: true }).inputValue(),
    "Espace QA",
  );
  failSave = false;
  await page.getByRole("button", { name: "Créer l’espace", exact: true }).click();
  await page.getByRole("link", { name: /Espace QA/ }).waitFor();
  await page.getByRole("button", { name: "Archiver Espace QA", exact: true }).click();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  assert.equal(projects.find((p) => p.name === "Espace QA").status, "active");
  await page.getByRole("button", { name: "Archiver Espace QA", exact: true }).click();
  await page.getByRole("button", { name: "Archiver", exact: true }).click();
  await page.getByRole("button", { name: "Archiver Espace QA", exact: true }).waitFor();
  assert.equal(projects.find((p) => p.name === "Espace QA").status, "archived");

  await page.getByRole("link", { name: "Profils", exact: true }).click();
  await title("Profils");
  assert.equal(
    await page.getByRole("button", { name: "Ajouter un profil", exact: true }).count(),
    1,
  );
  await page.getByRole("button", { name: "Ajouter un profil", exact: true }).click();
  await page.getByLabel("Nom et prénom", { exact: true }).fill("Camille QA");
  await page.getByLabel("Rôle", { exact: true }).fill("Relecture");
  await page
    .getByLabel("Instructions et skills", { exact: true })
    .fill("Vérifier les critères.");
  await checkA11y("profile form");
  await page.getByRole("button", { name: "Créer le profil", exact: true }).click();
  await page.getByText("Camille QA", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Modifier Camille QA", exact: true }).click();
  await page.getByLabel("Rôle", { exact: true }).fill("Relectrice");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("cell", { name: "Relectrice", exact: true }).waitFor();
  await page.getByRole("button", { name: "Archiver Camille QA", exact: true }).click();
  await page.getByRole("button", { name: "Archiver", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Filtrer par statut" })
    .selectOption("archived");
  await page.getByText("Camille QA", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Filtrer par statut" }).selectOption("all");
  await checkA11y("profiles");
  await page.screenshot({ path: `${artifacts}/profils-desktop.png`, fullPage: true });

  const projectCount = projects.length;
  for (let index = 0; index < 11; index++)
    projects.push({
      ...projects[0],
      id: `pagination_${index}`,
      name: `Espace ${index + 1}`,
    });
  await page.reload();
  await title("Profils");
  await page.getByRole("link", { name: "Espaces de travail", exact: true }).click();
  await title("Espaces de travail");
  assert.equal(await page.locator("tbody tr").count(), 10);
  await page.getByRole("button", { name: "Page suivante", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 5);
  await page.getByRole("searchbox").fill("amélioré");
  assert.equal(await page.locator("tbody tr").count(), 1);
  projects.splice(projectCount);
  await page.reload();
  await title("Espaces de travail");

  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Dashboard", "Espaces de travail", "Profils"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await title(name);
    if (name === "Dashboard")
      await page.getByRole("heading", { name: "Répartition des tickets" }).waitFor();
    await noOverflow();
    await checkA11y(`mobile ${name}`);
    await page.screenshot({
      path: `${artifacts}/${name === "Dashboard" ? "dashboard" : name === "Profils" ? "profils" : "espaces"}-mobile.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Ouvrir les paramètres locaux" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Ouvrir les paramètres locaux" })
      .evaluate((element) => element === globalThis.document.activeElement),
    true,
    "Modal restores keyboard focus",
  );

  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["Dashboard", "Espaces de travail", "Profils"]) {
      await page.getByRole("link", { name, exact: true }).click();
      await title(name);
      if (name === "Dashboard")
        await page.getByRole("heading", { name: "Répartition des tickets" }).waitFor();
      await noOverflow();
    }
  }

  tools = [];
  unavailable = true;
  await page.reload();
  await page.getByRole("alert").waitFor();
  unavailable = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await title("Profils");
  await page.getByRole("button", { name: "Ouvrir les paramètres locaux" }).click();
  assert.equal(
    await page.getByText("Outils disponibles sur l’hôte", { exact: true }).count(),
    0,
  );
  await page.keyboard.press("Escape");
  projects.splice(0);
  agents.splice(0);
  await page.reload();
  await title("Profils");
  await page.getByRole("heading", { name: "Composez votre équipe IA" }).waitFor();
  await noOverflow();
  await page.getByRole("link", { name: "Espaces de travail", exact: true }).click();
  await title("Espaces de travail");
  await page
    .getByRole("heading", { name: "Votre premier espace vous attend" })
    .waitFor();
  emptySummary = true;
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await title("Dashboard");
  await page.getByRole("heading", { name: "Aucun ticket pour le moment" }).waitFor();
  await checkA11y("empty dashboard");
  failDashboard = true;
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await page.getByRole("alert").waitFor();
  failDashboard = false;
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await page.getByRole("heading", { name: "Aucun ticket pour le moment" }).waitFor();
  assert.deepEqual(failures, []);

  const realPage = await context.newPage();
  await realPage.route("**/api/**", async (route) => {
    assert.equal(route.request().method(), "GET", "Real API smoke is read-only");
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `http://api:3000${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await realPage.goto("http://web:5173/#/espaces");
  await realPage
    .getByRole("heading", { level: 1, name: "Espaces de travail", exact: true })
    .waitFor();
  await realPage.screenshot({ path: `${artifacts}/espaces-reels.png`, fullPage: true });
  await realPage.getByRole("link", { name: "Dashboard", exact: true }).click();
  await realPage.getByRole("heading", { name: "Répartition des tickets" }).waitFor();
  assert.equal(await realPage.getByRole("alert").count(), 0);
  await realPage.close();
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "three primary entries",
        "single page title and add action",
        "workspace URL and reload",
        "project CRUD and cancellation",
        "profile CRUD",
        "project tabs",
        "pagination and search reset",
        "provider discovery dropdown",
        "failed save preserves form",
        "responsive 320/390/768/1440px no overflow",
        "WCAG axe desktop/mobile/forms",
        "modal Escape and focus restoration",
        "network error and retry",
        "empty registry",
        "empty dashboard and aggregate failure",
        "no missing tools shown",
        "read-only real API dashboard and projects",
      ],
      interceptedRequests: requests.length,
      screenshots: artifacts,
    }),
  );
} finally {
  await browser.close();
}
