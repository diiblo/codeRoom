import { useState, type FormEvent } from "react";
import { ApiClient, clientId, type Agent, type Project } from "./api";
import {
  ArchiveDialog,
  Badge,
  EmptyState,
  Icon,
  Modal,
  PageHeader,
  Pagination,
  errorMessage,
  formText,
  formatDate,
} from "./ui";
import { routeHref } from "./navigation";

const PAGE_SIZE = 10;
type Filter = "all" | "active" | "archived";

function DirectoryTools({
  search,
  setSearch,
  filter,
  setFilter,
  noun,
  count,
}: {
  search: string;
  setSearch: (value: string) => void;
  filter: Filter;
  setFilter: (value: Filter) => void;
  noun: string;
  count: number;
}) {
  return (
    <div className="directory-toolbar">
      <div className="search-field">
        <Icon name="search" size={19} />
        <input
          aria-label={`Rechercher ${noun}`}
          type="search"
          placeholder={`Rechercher ${noun}…`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="directory-filters">
        <span>
          {count} résultat{count > 1 ? "s" : ""}
        </span>
        <select
          aria-label="Filtrer par statut"
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          <option value="all">Tous les statuts</option>
          <option value="active">Actifs</option>
          <option value="archived">Archivés</option>
        </select>
      </div>
    </div>
  );
}

export function ProjectsDirectory({
  api,
  projects,
  organizationId,
  onChanged,
}: {
  api: ApiClient;
  projects: Project[];
  organizationId: string;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ project?: Project } | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = search.trim().toLocaleLowerCase("fr-FR");
  const filtered = projects.filter(
    (project) =>
      (filter === "all" || project.status === filter) &&
      `${project.name} ${project.description ?? ""}`
        .toLocaleLowerCase("fr-FR")
        .includes(query),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
  );
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      if (editor.project)
        await api.updateProject(editor.project.id, {
          name: formText(form, "name"),
          description: formText(form, "description") || null,
        });
      else
        await api.createProject({
          id: clientId("project"),
          organizationId,
          name: formText(form, "name"),
          description: formText(form, "description") || undefined,
        });
      setEditor(null);
      onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!archiving || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveProject(archiving.id);
      setArchiving(null);
      onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Espaces de travail"
        description="Tous vos projets, leurs équipes et leurs conversations."
      >
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setError(null);
            setEditor({});
          }}
        >
          <Icon name="plus" size={18} />
          Ajouter un espace
        </button>
      </PageHeader>
      <section className="directory-panel" aria-label="Liste des espaces de travail">
        <DirectoryTools
          noun="un espace"
          count={filtered.length}
          search={search}
          setSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          filter={filter}
          setFilter={(value) => {
            setFilter(value);
            setPage(1);
          }}
        />
        <div className="data-table-wrap">
          <table className="data-table directory-table">
            <thead>
              <tr>
                <th scope="col">Espace</th>
                <th scope="col">Statut</th>
                <th scope="col">Dépôt Git</th>
                <th scope="col">Création</th>
                <th scope="col" className="actions-column">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => (
                <tr key={project.id}>
                  <th scope="row">
                    <a
                      className="table-entity"
                      href={routeHref({
                        page: "project",
                        projectId: project.id,
                        tab: "overview",
                      })}
                    >
                      <span className="entity-avatar">
                        <Icon name="folder" />
                      </span>
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.description || "Aucune description"}</small>
                      </span>
                      <Icon name="arrow" size={16} />
                    </a>
                  </th>
                  <td data-label="Statut">
                    <Badge tone={project.status === "active" ? "good" : "muted"}>
                      {project.status === "active" ? "Actif" : "Archivé"}
                    </Badge>
                  </td>
                  <td data-label="Dépôt Git">
                    <span className="table-muted">
                      {project.repositoryPath ? "Lié" : "Non lié"}
                    </span>
                  </td>
                  <td className="table-date" data-label="Création">
                    {formatDate(project.createdAt)}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Modifier ${project.name}`}
                        disabled={project.status !== "active"}
                        onClick={() => {
                          setError(null);
                          setEditor({ project });
                        }}
                      >
                        <Icon name="edit" size={18} />
                      </button>
                      <button
                        className="icon-button archive-action"
                        type="button"
                        aria-label={`Archiver ${project.name}`}
                        disabled={project.status !== "active"}
                        onClick={() => {
                          setError(null);
                          setArchiving(project);
                        }}
                      >
                        <Icon name="archive" size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <EmptyState
            title={
              projects.length
                ? "Aucun espace trouvé"
                : "Votre premier espace vous attend"
            }
          >
            {projects.length
              ? "Modifiez votre recherche ou le filtre de statut."
              : "Utilisez « Ajouter un espace » pour démarrer un projet."}
          </EmptyState>
        )}
        <Pagination
          page={currentPage}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </section>
      <p className="page-footnote">
        <Icon name="folder" size={16} />
        Cliquez sur le nom d’un espace pour l’ouvrir et y travailler.
      </p>
      {editor && (
        <Modal
          title={editor.project ? "Modifier l’espace" : "Ajouter un espace"}
          busy={busy}
          onClose={() => setEditor(null)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-fields">
              <label>
                Nom de l’espace
                <input
                  name="name"
                  defaultValue={editor.project?.name ?? ""}
                  placeholder="Ex. Application client"
                  required
                  autoFocus
                  maxLength={160}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={editor.project?.description ?? ""}
                  placeholder="Quel est l’objectif de ce projet ?"
                  rows={4}
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Annuler
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy
                  ? "Enregistrement…"
                  : editor.project
                    ? "Enregistrer"
                    : "Créer l’espace"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {archiving && (
        <ArchiveDialog
          name={archiving.name}
          busy={busy}
          error={error}
          onClose={() => setArchiving(null)}
          onConfirm={() => void archive()}
        />
      )}
    </>
  );
}

export function ProfilesDirectory({
  api,
  agents,
  onChanged,
}: {
  api: ApiClient;
  agents: Agent[];
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ agent?: Agent } | null>(null);
  const [archiving, setArchiving] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = search.trim().toLocaleLowerCase("fr-FR");
  const filtered = agents.filter(
    (agent) =>
      (filter === "all" ||
        (filter === "active"
          ? agent.archivedAt === null
          : agent.archivedAt !== null)) &&
      `${agent.displayName} ${agent.role} ${agent.description ?? ""}`
        .toLocaleLowerCase("fr-FR")
        .includes(query),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
  );
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const form = event.currentTarget;
    const input = {
      displayName: formText(form, "displayName"),
      role: formText(form, "role"),
      instructions: formText(form, "instructions"),
      description: formText(form, "description"),
    };
    setBusy(true);
    setError(null);
    try {
      if (editor.agent) await api.updateAgent(editor.agent.id, input);
      else await api.createAgent({ id: clientId("agent"), ...input });
      setEditor(null);
      onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!archiving || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveAgent(archiving.id);
      setArchiving(null);
      onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Profils"
        description="Créez vos collaborateurs IA, puis affectez-les à vos projets."
      >
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setError(null);
            setEditor({});
          }}
        >
          <Icon name="plus" size={18} />
          Ajouter un profil
        </button>
      </PageHeader>
      <section className="directory-panel" aria-label="Liste des profils">
        <DirectoryTools
          noun="un profil"
          count={filtered.length}
          search={search}
          setSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          filter={filter}
          setFilter={(value) => {
            setFilter(value);
            setPage(1);
          }}
        />
        <div className="data-table-wrap">
          <table className="data-table directory-table">
            <thead>
              <tr>
                <th scope="col">Profil</th>
                <th scope="col">Rôle</th>
                <th scope="col">Statut</th>
                <th scope="col">Création</th>
                <th scope="col" className="actions-column">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((agent) => (
                <tr key={agent.id}>
                  <th scope="row">
                    <div className="table-entity">
                      <span className="entity-avatar profile-avatar">
                        {agent.displayName.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{agent.displayName}</strong>
                        <small>{agent.description || "Aucune description"}</small>
                      </span>
                    </div>
                  </th>
                  <td data-label="Rôle">{agent.role}</td>
                  <td data-label="Statut">
                    <Badge tone={agent.archivedAt === null ? "good" : "muted"}>
                      {agent.archivedAt === null ? "Actif" : "Archivé"}
                    </Badge>
                  </td>
                  <td className="table-date" data-label="Création">
                    {formatDate(agent.createdAt)}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Modifier ${agent.displayName}`}
                        disabled={agent.archivedAt !== null}
                        onClick={() => {
                          setError(null);
                          setEditor({ agent });
                        }}
                      >
                        <Icon name="edit" size={18} />
                      </button>
                      <button
                        className="icon-button archive-action"
                        type="button"
                        aria-label={`Archiver ${agent.displayName}`}
                        disabled={agent.archivedAt !== null}
                        onClick={() => {
                          setError(null);
                          setArchiving(agent);
                        }}
                      >
                        <Icon name="archive" size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <EmptyState
            icon="users"
            title={agents.length ? "Aucun profil trouvé" : "Composez votre équipe IA"}
          >
            {agents.length
              ? "Modifiez votre recherche ou le filtre de statut."
              : "Utilisez « Ajouter un profil » pour définir une identité, un rôle et des instructions."}
          </EmptyState>
        )}
        <Pagination
          page={currentPage}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </section>
      <p className="page-footnote">
        <Icon name="users" size={16} />
        Le fournisseur est choisi lors de l’affectation à un espace.
      </p>
      {editor && (
        <Modal
          title={editor.agent ? "Modifier le profil" : "Ajouter un profil"}
          busy={busy}
          onClose={() => setEditor(null)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-fields">
              <div className="form-grid">
                <label>
                  Nom et prénom
                  <input
                    name="displayName"
                    defaultValue={editor.agent?.displayName ?? ""}
                    placeholder="Ex. Alex Martin"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Rôle
                  <input
                    name="role"
                    defaultValue={editor.agent?.role ?? ""}
                    placeholder="Ex. Développeur frontend"
                    required
                  />
                </label>
              </div>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={editor.agent?.description ?? ""}
                  rows={2}
                  placeholder="Spécialités et responsabilités…"
                />
              </label>
              <label>
                Instructions et skills
                <textarea
                  name="instructions"
                  defaultValue={editor.agent?.instructions ?? ""}
                  rows={5}
                  placeholder="Méthodes, compétences et consignes de travail…"
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Annuler
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy
                  ? "Enregistrement…"
                  : editor.agent
                    ? "Enregistrer"
                    : "Créer le profil"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {archiving && (
        <ArchiveDialog
          name={archiving.displayName}
          busy={busy}
          error={error}
          onClose={() => setArchiving(null)}
          onConfirm={() => void archive()}
        />
      )}
    </>
  );
}
