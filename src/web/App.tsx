import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiClient,
  type ActorType,
  type Agent,
  type LocalIdentity,
  type Project,
} from "./api";
import { DashboardView } from "./DashboardView";
import { ProjectsDirectory, ProfilesDirectory } from "./Directories";
import { parseRoute, routeHref, type Route } from "./navigation";
import { ProjectWorkspace } from "./ProjectWorkspace";
import {
  Badge,
  Icon,
  LoadingState,
  Modal,
  errorMessage,
  formText,
  type IconName,
} from "./ui";

type LocalSettings = LocalIdentity & { organizationId: string };
export type HostStatus = {
  hostTools?: {
    state: "unconfigured" | "invalid" | "unavailable" | "connected";
    tools: Array<{ id: string; source: string }>;
  };
};

const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? "http://127.0.0.1:3000";
const SETTINGS_KEY = "coderoom-ui-settings";
const NAVIGATION: Array<{
  page: "dashboard" | "projects" | "profiles";
  label: string;
  icon: IconName;
}> = [
  { page: "dashboard", label: "Dashboard", icon: "dashboard" },
  { page: "projects", label: "Espaces de travail", icon: "folder" },
  { page: "profiles", label: "Profils", icon: "users" },
];

function readSettings(): LocalSettings {
  const defaults: LocalSettings = {
    actorId: "local-owner",
    actorType: "human",
    organizationId: "org_local",
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? "null",
    ) as Partial<LocalSettings> | null;
    if (!saved || typeof saved !== "object") return defaults;
    return {
      actorId:
        typeof saved.actorId === "string" && saved.actorId.trim()
          ? saved.actorId
          : defaults.actorId,
      actorType:
        saved.actorType === "agent" || saved.actorType === "system"
          ? saved.actorType
          : "human",
      organizationId:
        typeof saved.organizationId === "string" && saved.organizationId.trim()
          ? saved.organizationId
          : defaults.organizationId,
      ...(typeof saved.assignmentId === "string" && saved.assignmentId
        ? { assignmentId: saved.assignmentId }
        : {}),
    };
  } catch {
    return defaults;
  }
}

function SettingsDialog({
  settings,
  status,
  onClose,
  onSave,
}: {
  settings: LocalSettings;
  status: HostStatus | null;
  onClose: () => void;
  onSave: (settings: LocalSettings) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSave({
      actorId: formText(form, "actorId"),
      actorType: formText(form, "actorType") as ActorType,
      organizationId: formText(form, "organizationId"),
      ...(formText(form, "assignmentId")
        ? { assignmentId: formText(form, "assignmentId") }
        : {}),
    });
  }
  const tools = status?.hostTools?.tools ?? [];
  return (
    <Modal title="Paramètres locaux" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-fields">
          <label>
            Organisation
            <input
              name="organizationId"
              defaultValue={settings.organizationId}
              required
            />
          </label>
          <p className="muted-copy">Ces paramètres s’appliquent à ce navigateur.</p>
          {tools.length > 0 && (
            <section className="detected-tools" aria-label="Outils détectés">
              <h3>Outils disponibles sur l’hôte</h3>
              <div>
                {tools.map((tool) => (
                  <Badge key={tool.id} tone="good">
                    {tool.id}
                  </Badge>
                ))}
              </div>
            </section>
          )}
          <details className="advanced-settings">
            <summary>Identité locale avancée</summary>
            <p className="muted-copy">
              L’API vérifie les droits associés à cette identité. Ces champs ne donnent
              aucun droit supplémentaire.
            </p>
            <div className="form-fields">
              <label>
                Identifiant
                <input name="actorId" defaultValue={settings.actorId} required />
              </label>
              <label>
                Type
                <select name="actorType" defaultValue={settings.actorType}>
                  <option value="human">Humain</option>
                  <option value="agent">Agent</option>
                  <option value="system">Système</option>
                </select>
              </label>
              <label>
                Affectation
                <input
                  name="assignmentId"
                  defaultValue={settings.assignmentId ?? ""}
                  placeholder="Si l’identité est un agent"
                />
              </label>
            </div>
          </details>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary-button">
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function App() {
  const [settings, setSettings] = useState(readSettings);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [revision, setRevision] = useState(0);
  const api = useMemo(() => new ApiClient(apiOrigin, settings), [settings]);

  useEffect(() => {
    const changeRoute = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", changeRoute);
    return () => window.removeEventListener("hashchange", changeRoute);
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    Promise.all([api.listProjects(settings.organizationId, true), api.listAgents(true)])
      .then(([projects, agents]) => {
        if (current) {
          setProjects(projects.items);
          setAgents(agents.items);
        }
      })
      .catch((error: unknown) => {
        if (current) setError(errorMessage(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    fetch(`${apiOrigin}/api/v1/status`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Status unavailable");
        const status = (await response.json()) as HostStatus;
        if (current) setStatus(status);
      })
      .catch(() => {
        if (current) setStatus(null);
      });
    return () => {
      current = false;
    };
  }, [api, settings.organizationId, revision]);

  function refresh() {
    setRevision((value) => value + 1);
  }
  function saveSettings(next: LocalSettings) {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* The server remains authoritative. */
    }
    setShowSettings(false);
  }
  const activePage = route.page === "project" ? "projects" : route.page;
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Aller au contenu
      </a>
      <aside className="app-sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">
            CodeRoom<span>Votre équipe, au même endroit.</span>
          </span>
        </div>
        <nav className="main-navigation" aria-label="Navigation principale">
          {NAVIGATION.map((item) => (
            <a
              key={item.page}
              href={routeHref({ page: item.page })}
              className={`main-nav-link ${activePage === item.page ? "is-selected" : ""}`}
              aria-current={activePage === item.page ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-local-dot" />
          <div>
            <strong>Environnement local</strong>
            <span>Vos données sur votre machine</span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <span className="topbar-label">Espace de collaboration</span>
          <div className="topbar-tools">
            <span
              className={`connection-label ${error ? "is-error" : loading ? "is-loading" : ""}`}
            >
              <span />
              {loading
                ? "Synchronisation…"
                : error
                  ? "Connexion à vérifier"
                  : "Synchronisé"}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Ouvrir les paramètres locaux"
              onClick={() => setShowSettings(true)}
            >
              <Icon name="settings" />
            </button>
            <span className="local-avatar" aria-label="Session locale">
              L
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="page-content">
          {error ? (
            <div className="notice notice-error" role="alert">
              <span>{error}</span>
              <button type="button" className="secondary-button" onClick={refresh}>
                Réessayer
              </button>
            </div>
          ) : loading ? (
            <LoadingState label="Chargement de vos données…" />
          ) : route.page === "dashboard" ? (
            <DashboardView
              api={api}
              organizationId={settings.organizationId}
              onRefresh={refresh}
            />
          ) : route.page === "projects" ? (
            <ProjectsDirectory
              api={api}
              projects={projects}
              organizationId={settings.organizationId}
              onChanged={refresh}
            />
          ) : route.page === "profiles" ? (
            <ProfilesDirectory api={api} agents={agents} onChanged={refresh} />
          ) : (
            <ProjectWorkspace
              key={`${route.projectId}:${settings.organizationId}`}
              api={api}
              projectId={route.projectId}
              tab={route.tab}
              agents={agents}
              identity={settings}
              providers={status?.hostTools?.tools ?? []}
            />
          )}
        </main>
      </div>
      {showSettings && (
        <SettingsDialog
          settings={settings}
          status={status}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
    </div>
  );
}
