import { useEffect, useState } from "react";
import { ApiClient, type DashboardSummary, type TicketState } from "./api";
import { routeHref } from "./navigation";
import {
  EmptyState,
  Icon,
  LoadingState,
  PageHeader,
  errorMessage,
  formatDate,
  type IconName,
} from "./ui";

const TICKET_STATES: Array<{ id: TicketState; label: string }> = [
  { id: "todo", label: "À faire" },
  { id: "in_progress", label: "En cours" },
  { id: "in_review", label: "En revue" },
  { id: "done", label: "Terminés" },
  { id: "blocked", label: "Bloqués" },
  { id: "cancelled", label: "Annulés" },
];

function Metric({
  label,
  value,
  detail,
  icon,
  href,
}: {
  label: string;
  value: number;
  detail: string;
  icon: IconName;
  href?: string;
}) {
  const content = (
    <>
      <div className="dashboard-metric-top">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon name={icon} size={19} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  return href ? (
    <a className="dashboard-metric" href={href}>
      {content}
    </a>
  ) : (
    <article className="dashboard-metric">{content}</article>
  );
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    "message.posted": "Nouveau message",
    "execution.queued": "Exécution mise en attente",
    "execution.started": "Exécution démarrée",
    "execution.completed": "Exécution terminée",
    "execution.failed": "Échec d’une exécution",
    "execution.cancelled": "Exécution annulée",
    "execution.state_changed": "État d’une exécution modifié",
    "execution.cancel_requested": "Arrêt d’une exécution demandé",
    "ticket.created": "Ticket créé",
    "ticket.updated": "Ticket mis à jour",
    "ticket.assigned": "Ticket attribué",
    "ticket.state_changed": "État d’un ticket modifié",
    "ticket.transitioned": "État d’un ticket modifié",
    "approval.requested": "Approbation demandée",
    "approval.resolved": "Approbation traitée",
    "review.recorded": "Revue enregistrée",
  };
  return labels[type] ?? "Activité du projet";
}

export function DashboardView({
  api,
  organizationId,
  onRefresh,
}: {
  api: ApiClient;
  organizationId: string;
  onRefresh: () => void;
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api
      .getDashboard(organizationId)
      .then((summary) => {
        if (current) setSummary(summary);
      })
      .catch((error: unknown) => {
        if (current) setError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [api, organizationId]);
  const totalTickets = summary
    ? Object.values(summary.tickets).reduce((total, value) => total + value, 0)
    : 0;
  const maxTickets = summary ? Math.max(1, ...Object.values(summary.tickets)) : 1;
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Une vue d’ensemble de vos projets et du travail de vos équipes."
      >
        <button className="secondary-button" type="button" onClick={onRefresh}>
          <Icon name="refresh" size={17} />
          Actualiser
        </button>
      </PageHeader>
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : !summary ? (
        <LoadingState label="Lecture des statistiques…" />
      ) : (
        <>
          <div className="dashboard-metrics" aria-label="Statistiques globales">
            <Metric
              label="Espaces actifs"
              href="#/espaces"
              value={summary.projects.active}
              detail={`${summary.projects.archived} espace${summary.projects.archived > 1 ? "s" : ""} archivé${summary.projects.archived > 1 ? "s" : ""}`}
              icon="folder"
            />
            <Metric
              label="Profils actifs"
              href="#/profils"
              value={summary.agents.active}
              detail={`${summary.assignments.active} affectation${summary.assignments.active > 1 ? "s" : ""} dans les espaces actifs`}
              icon="users"
            />
            <Metric
              label="Tickets ouverts"
              value={
                summary.tickets.todo +
                summary.tickets.in_progress +
                summary.tickets.in_review +
                summary.tickets.blocked
              }
              detail={`${totalTickets} ticket${totalTickets > 1 ? "s" : ""} au total`}
              icon="ticket"
            />
            <Metric
              label="Approbations"
              value={summary.approvals.pending}
              detail="Demandes en attente de décision"
              icon="check"
            />
          </div>
          <div className="dashboard-grid">
            <section className="panel" aria-labelledby="ticket-distribution-title">
              <div className="panel-heading">
                <div>
                  <h2 id="ticket-distribution-title">Répartition des tickets</h2>
                  <p>État actuel dans l’ensemble des espaces</p>
                </div>
              </div>
              {totalTickets > 0 ? (
                <>
                  <div
                    className="workflow-chart"
                    role="img"
                    aria-label={TICKET_STATES.map(
                      ({ id, label }) => `${label} : ${summary.tickets[id]}`,
                    ).join(", ")}
                  >
                    {TICKET_STATES.map(({ id }) => (
                      <div className="workflow-bar" key={id} aria-hidden="true">
                        <strong>{summary.tickets[id]}</strong>
                        <span
                          style={{
                            height: `${(summary.tickets[id] / maxTickets) * 78}%`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="workflow-labels" aria-hidden="true">
                    {TICKET_STATES.map(({ id, label }) => (
                      <span key={id}>{label}</span>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState icon="ticket" title="Aucun ticket pour le moment">
                  Les tickets de vos projets apparaîtront ici, répartis par état.
                </EmptyState>
              )}
            </section>
            <section className="panel" aria-labelledby="execution-summary-title">
              <div className="panel-heading">
                <div>
                  <h2 id="execution-summary-title">Exécutions</h2>
                  <p>Suivi des tâches confiées aux agents</p>
                </div>
              </div>
              <div className="execution-stats">
                <div className="execution-stat-line">
                  <span>
                    <i className="stat-dot" />
                    En attente
                  </span>
                  <strong>{summary.executions.queued}</strong>
                </div>
                <div className="execution-stat-line">
                  <span>
                    <i className="stat-dot" />
                    En cours
                  </span>
                  <strong>{summary.executions.running}</strong>
                </div>
                <div className="execution-stat-line">
                  <span>
                    <i className="stat-dot good" />
                    Réussies
                  </span>
                  <strong>{summary.executions.succeeded}</strong>
                </div>
                <div className="execution-stat-line">
                  <span>
                    <i className="stat-dot warn" />
                    Échecs / à vérifier
                  </span>
                  <strong>
                    {summary.executions.failed + summary.executions.unknown}
                  </strong>
                </div>
                <div className="execution-stat-line">
                  <span>
                    <i className="stat-dot warn" />
                    En attente d’approbation
                  </span>
                  <strong>{summary.executions.awaiting_approval}</strong>
                </div>
                <div className="execution-stat-line">
                  <span>
                    <i className="stat-dot" />
                    Annulées
                  </span>
                  <strong>{summary.executions.cancelled}</strong>
                </div>
              </div>
            </section>
          </div>
          <section className="panel" aria-labelledby="recent-activity-title">
            <div className="panel-heading">
              <div>
                <h2 id="recent-activity-title">Activité récente</h2>
                <p>Les derniers événements de vos espaces</p>
              </div>
              <Icon name="activity" size={20} />
            </div>
            {!summary.recentActivity.length ? (
              <EmptyState icon="activity" title="Tout est calme ici">
                Les échanges, tickets et exécutions alimenteront ce journal.
              </EmptyState>
            ) : (
              <div className="dashboard-activity">
                {summary.recentActivity.map((event) => (
                  <a
                    key={event.id}
                    className="dashboard-event"
                    href={routeHref({
                      page: "project",
                      projectId: event.projectId,
                      tab: "activity",
                    })}
                  >
                    <span className="entity-avatar">
                      <Icon name="activity" size={18} />
                    </span>
                    <div>
                      <strong>{eventLabel(event.type)}</strong>
                      <small>
                        {summary.recentProjects.find(
                          (project) => project.id === event.projectId,
                        )?.name || "Voir l’espace concerné"}
                      </small>
                    </div>
                    <time dateTime={event.createdAt}>
                      {formatDate(event.createdAt)}
                    </time>
                    <Icon name="arrow" size={17} />
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
