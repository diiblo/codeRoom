import { useEffect, useState, type FormEvent } from "react";
import {
  ApiClient,
  clientId,
  type Agent,
  type Assignment,
  type ProjectAggregate,
  type LocalIdentity,
} from "./api";
import { ActivityView } from "./ActivityView";
import { MessagingView } from "./MessagingView";
import { TicketsView } from "./TicketsView";
import { routeHref, type ProjectTab } from "./navigation";
import {
  Badge,
  EmptyState,
  Icon,
  LoadingState,
  Modal,
  PageHeader,
  errorMessage,
  formText,
  formatDate,
  type IconName,
} from "./ui";

const TABS: Array<{ id: ProjectTab; label: string; icon: IconName }> = [
  { id: "overview", label: "Vue d’ensemble", icon: "dashboard" },
  { id: "tickets", label: "Tickets", icon: "ticket" },
  { id: "collaborators", label: "Équipe", icon: "users" },
  { id: "messaging", label: "Messages", icon: "message" },
  { id: "activity", label: "Activité", icon: "activity" },
];

const PERMISSIONS = [
  ["project.read", "Consulter le projet"],
  ["message.read", "Lire les messages"],
  ["message.send", "Envoyer des messages"],
  ["execution.request", "Demander une exécution"],
];

function AssignmentEditor({
  api,
  projectId,
  agents,
  providers,
  onClose,
  onSaved,
}: {
  api: ApiClient;
  projectId: string;
  agents: Agent[];
  providers: Array<{ id: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const permissionSet = new FormData(form)
      .getAll("permissions")
      .filter((value): value is string => typeof value === "string");
    if (!permissionSet.length) {
      setError("Choisissez au moins un droit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createAssignment(projectId, {
        id: clientId("assignment"),
        agentId: formText(form, "agentId"),
        provider: formText(form, "provider"),
        permissionSet,
      });
      onSaved();
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Affecter un profil" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-fields">
          <label>
            Profil
            <select name="agentId" required defaultValue="">
              <option value="" disabled>
                Choisir un profil
              </option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName} — {agent.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fournisseur pour cet espace
            <select
              name="provider"
              required
              defaultValue=""
              disabled={!providers.length}
            >
              <option value="" disabled>
                {providers.length ? "Choisir un outil détecté" : "Aucun outil détecté"}
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.id}
                </option>
              ))}
            </select>
          </label>
          {!providers.length && (
            <p className="muted-copy">
              Démarrez le broker hôte pour détecter vos outils.
            </p>
          )}
          <fieldset className="permission-fieldset">
            <legend>Droits dans cet espace</legend>
            {PERMISSIONS.map(([value, label]) => (
              <label className="check-row" key={value}>
                <input
                  name="permissions"
                  type="checkbox"
                  value={value}
                  defaultChecked={value === "project.read"}
                />
                {label}
              </label>
            ))}
          </fieldset>
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
            onClick={onClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            className="primary-button"
            disabled={busy || !providers.length || !agents.length}
            type="submit"
          >
            {busy ? "Affectation…" : "Affecter le profil"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectWorkspace({
  api,
  projectId,
  tab,
  agents,
  providers,
  identity,
}: {
  api: ApiClient;
  projectId: string;
  tab: ProjectTab;
  agents: Agent[];
  providers: Array<{ id: string }>;
  identity: LocalIdentity;
}) {
  const [context, setContext] = useState<ProjectAggregate | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [showAssignment, setShowAssignment] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    Promise.all([api.getProject(projectId), api.listAssignments(projectId)])
      .then(([context, assignments]) => {
        if (current) {
          setContext(context);
          setAssignments(assignments.items);
        }
      })
      .catch((error: unknown) => {
        if (current) setError(errorMessage(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, projectId, revision]);

  if (loading) return <LoadingState label="Ouverture de l’espace…" />;
  if (error || !context)
    return (
      <>
        <PageHeader
          title="Espace indisponible"
          description="Cet espace n’a pas pu être ouvert."
        />
        <div className="notice notice-error" role="alert">
          {error || "Espace introuvable."}
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Réessayer
          </button>
        </div>
        <a className="text-button" href="#/espaces">
          Retour aux espaces
        </a>
      </>
    );
  const active = context.project.status === "active";
  const activeAssignments = assignments.filter(
    (assignment) => assignment.status === "active",
  );
  const availableAgents = agents.filter(
    (agent) =>
      agent.archivedAt === null &&
      !activeAssignments.some((assignment) => assignment.agentId === agent.id),
  );
  const description =
    context.project.description ||
    "Retrouvez l’équipe, les échanges et le travail de cet espace.";
  return (
    <>
      <a className="back-link" href="#/espaces">
        <Icon name="back" size={17} />
        Tous les espaces
      </a>
      <PageHeader title={context.project.name} description={description}>
        <Badge tone={active ? "good" : "muted"}>
          {active ? "Espace actif" : "Espace archivé"}
        </Badge>
      </PageHeader>
      {!active && (
        <p className="notice">
          Cet espace est archivé. Son historique reste disponible.
        </p>
      )}
      <nav className="view-tabs" aria-label="Vue de l’espace">
        {TABS.map((item) => (
          <a
            key={item.id}
            className={tab === item.id ? "is-active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            href={routeHref({ page: "project", projectId, tab: item.id })}
          >
            <Icon name={item.icon} size={18} />
            {item.label}
          </a>
        ))}
      </nav>
      {tab === "overview" ? (
        <section className="project-overview">
          <div className="overview-metrics">
            <div>
              <span>Équipe active</span>
              <strong>{activeAssignments.length}</strong>
              <small>
                profil{activeAssignments.length > 1 ? "s" : ""} affecté
                {activeAssignments.length > 1 ? "s" : ""}
              </small>
            </div>
            <div>
              <span>Conversation principale</span>
              <strong className="text-metric">
                {context.mainConversation ? "Prête" : "Indisponible"}
              </strong>
              <small>Le fil commun du projet</small>
            </div>
            <div>
              <span>Dépôt Git</span>
              <strong className="text-metric">
                {context.project.repositoryPath ? "Lié" : "Non lié"}
              </strong>
              <small>{context.project.repositoryPath || "Aucun dépôt associé"}</small>
            </div>
          </div>
          <div className="project-overview-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Équipe du projet</h2>
                <a
                  className="text-button"
                  href={routeHref({ page: "project", projectId, tab: "collaborators" })}
                >
                  Gérer l’équipe
                  <Icon name="arrow" size={16} />
                </a>
              </div>
              {!activeAssignments.length ? (
                <EmptyState icon="users" title="L’équipe reste à composer">
                  Ouvrez l’onglet Équipe pour affecter vos profils et choisir leurs
                  fournisseurs.
                </EmptyState>
              ) : (
                <div className="team-list">
                  {activeAssignments.map((assignment) => {
                    const agent = agents.find(
                      (agent) => agent.id === assignment.agentId,
                    );
                    return (
                      <div className="team-row" key={assignment.id}>
                        <span className="entity-avatar profile-avatar">
                          {agent?.displayName.slice(0, 2).toUpperCase() || "?"}
                        </span>
                        <div>
                          <strong>{agent?.displayName || assignment.agentId}</strong>
                          <small>{agent?.role || "Profil indisponible"}</small>
                        </div>
                        <Badge>{assignment.provider || "Sans fournisseur"}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>Informations</h2>
              </div>
              <dl className="project-facts">
                <div>
                  <dt>Création</dt>
                  <dd>{formatDate(context.project.createdAt)}</dd>
                </div>
                <div>
                  <dt>État</dt>
                  <dd>{active ? "Actif" : "Archivé"}</dd>
                </div>
                <div>
                  <dt>Conversation</dt>
                  <dd>
                    {context.mainConversation
                      ? "Groupe principal créé"
                      : "Non disponible"}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </section>
      ) : tab === "collaborators" ? (
        <section className="project-team">
          <div className="section-title-line">
            <div>
              <h2>Équipe affectée</h2>
              <p className="section-supporting-copy">
                Choisissez un profil, son fournisseur et ses droits pour ce projet.
              </p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!active || !availableAgents.length}
              onClick={() => setShowAssignment(true)}
            >
              <Icon name="plus" size={18} />
              Affecter un profil
            </button>
          </div>
          {!availableAgents.length && active && (
            <p className="muted-copy">
              {agents.some((agent) => agent.archivedAt === null) ? (
                "Tous les profils actifs sont déjà affectés."
              ) : (
                <>
                  Créez d’abord un profil dans le{" "}
                  <a href="#/profils">registre des profils</a>.
                </>
              )}
            </p>
          )}
          <section className="directory-panel">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Profil</th>
                    <th scope="col">Fournisseur</th>
                    <th scope="col">Droits</th>
                    <th scope="col">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <th scope="row">
                        {agents.find((agent) => agent.id === assignment.agentId)
                          ?.displayName || assignment.agentId}
                      </th>
                      <td>{assignment.provider || "Non défini"}</td>
                      <td>
                        <div className="permission-chips">
                          {assignment.permissionSet.map((permission) => (
                            <span key={permission}>
                              {PERMISSIONS.find(([id]) => id === permission)?.[1] ||
                                permission}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <Badge tone={assignment.status === "active" ? "good" : "muted"}>
                          {assignment.status === "active" ? "Actif" : "Archivé"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!assignments.length && (
              <EmptyState icon="users" title="Aucun profil affecté">
                Les membres de votre équipe apparaîtront ici.
              </EmptyState>
            )}
          </section>
        </section>
      ) : tab === "tickets" ? (
        <TicketsView
          api={api}
          projectId={projectId}
          actorType={identity.actorType}
          agents={agents}
        />
      ) : tab === "activity" ? (
        <ActivityView api={api} projectId={projectId} actorType={identity.actorType} />
      ) : (
        <MessagingView
          api={api}
          projectId={projectId}
          actorId={identity.actorId}
          actorType={identity.actorType}
          assignmentId={identity.assignmentId}
          agents={agents}
          assignments={assignments}
        />
      )}
      {showAssignment && (
        <AssignmentEditor
          api={api}
          projectId={projectId}
          agents={availableAgents}
          providers={providers}
          onClose={() => setShowAssignment(false)}
          onSaved={() => setRevision((value) => value + 1)}
        />
      )}
    </>
  );
}
