import { useCallback, useEffect, useState } from "react";
import {
  ApiClient,
  ApiClientError,
  type ActorType,
  type Approval,
  type ApprovalStatus,
  type AuditEvent,
  type Execution,
  type ExecutionState,
} from "./api";

type ActivityViewProps = {
  api: ApiClient;
  projectId: string;
  actorType: ActorType;
};

type PendingAction =
  { kind: "cancel"; id: string } | { kind: "approved" | "denied"; id: string };

const EXECUTION_LABELS: Record<ExecutionState, string> = {
  queued: "En attente",
  running: "En cours",
  awaiting_approval: "Décision requise",
  succeeded: "Réussie",
  failed: "Échec",
  cancelled: "Annulée",
  unknown: "À réconcilier",
};

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: "À décider",
  approved: "Acceptée",
  denied: "Refusée",
  expired: "Expirée",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "La lecture de l’activité a échoué.";
}

function toneForExecution(state: ExecutionState) {
  if (state === "succeeded") return "good" as const;
  if (state === "failed" || state === "unknown") return "warn" as const;
  if (state === "awaiting_approval") return "accent" as const;
  return "muted" as const;
}

function toneForApproval(status: ApprovalStatus) {
  if (status === "approved") return "good" as const;
  if (status === "denied" || status === "expired") return "warn" as const;
  return "accent" as const;
}

function StatusBadge({
  children,
  tone,
}: {
  children: string;
  tone: "accent" | "good" | "warn" | "muted";
}) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}

function isActiveExecution(execution: Execution) {
  return ["queued", "running", "awaiting_approval"].includes(execution.state);
}

async function settle<T>(promise: Promise<T>) {
  try {
    return { status: "fulfilled" as const, value: await promise };
  } catch (reason: unknown) {
    return { status: "rejected" as const, reason };
  }
}

export function ActivityView({ api, projectId, actorType }: ActivityViewProps) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    const [executionsResult, approvalsResult] = await Promise.all([
      settle(api.listExecutions(projectId)),
      settle(api.listApprovals(projectId)),
    ]);
    const activityResult =
      actorType === "agent" ? await settle(api.listActivity(projectId)) : undefined;
    const failures: string[] = [];

    if (executionsResult.status === "fulfilled") {
      setExecutions(executionsResult.value.items);
    } else {
      failures.push(`Exécutions : ${errorMessage(executionsResult.reason)}`);
    }

    if (approvalsResult.status === "fulfilled") {
      setApprovals(approvalsResult.value.items);
    } else {
      failures.push(`Approbations : ${errorMessage(approvalsResult.reason)}`);
    }

    if (actorType === "agent") {
      if (activityResult?.status === "fulfilled") {
        setEvents(activityResult.value.items);
      } else if (activityResult) {
        failures.push(`Journal : ${errorMessage(activityResult.reason)}`);
      }
    } else {
      setEvents([]);
    }

    setError(failures.length ? failures.join(" · ") : null);
    setLoading(false);
    setRefreshing(false);
  }, [actorType, api, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function confirmAction() {
    if (!pendingAction) return;
    setActionError(null);
    try {
      if (pendingAction.kind === "cancel") {
        const response = await api.cancelExecution(pendingAction.id);
        setNotice(
          response.result.status === "requested"
            ? "L’arrêt a été demandé au worker."
            : "L’exécution est annulée.",
        );
      } else {
        await api.decideApproval(pendingAction.id, {
          decision: pendingAction.kind,
          reason:
            pendingAction.kind === "denied"
              ? "Décision refusée depuis la supervision"
              : undefined,
        });
        setNotice(
          pendingAction.kind === "approved"
            ? "Approbation acceptée."
            : "Approbation refusée.",
        );
      }
      setPendingAction(null);
      await refresh();
    } catch (requestError: unknown) {
      setActionError(errorMessage(requestError));
    }
  }

  const pendingApprovals = approvals.filter(
    (approval) => approval.status === "pending",
  );
  const activeExecutions = executions.filter(isActiveExecution);
  const failedExecutions = executions.filter(
    (execution) => execution.state === "failed" || execution.state === "unknown",
  );

  return (
    <section className="activity-view" aria-labelledby="activity-title">
      <div className="section-title-line">
        <div>
          <p className="eyebrow">Processus et décisions</p>
          <h2 id="activity-title">Activité du projet</h2>
          <p className="section-supporting-copy">
            Les états viennent de la base persistante. Actualiser relit le serveur ;
            aucun bouton ne valide une action localement.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Lecture…" : "Actualiser"}
        </button>
      </div>

      {error && (
        <div className="activity-notice activity-notice-error" role="alert">
          <strong>Lecture partielle.</strong>
          <span>{error}</span>
        </div>
      )}
      {actionError && (
        <div className="activity-notice activity-notice-error" role="alert">
          <strong>Action refusée.</strong>
          <span>{actionError}</span>
          <button
            className="notice-close"
            type="button"
            onClick={() => setActionError(null)}
          >
            Fermer
          </button>
        </div>
      )}
      {notice && (
        <div className="activity-notice activity-notice-success" role="status">
          <span>{notice}</span>
          <button
            className="notice-close"
            type="button"
            onClick={() => setNotice(null)}
          >
            Fermer
          </button>
        </div>
      )}

      <div className="activity-summary" aria-label="Résumé de l’activité">
        <div>
          <span>Actives</span>
          <strong>{activeExecutions.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Incidents</span>
          <strong>{failedExecutions.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Décisions en attente</span>
          <strong>{pendingApprovals.length.toString().padStart(2, "0")}</strong>
        </div>
      </div>

      <div className="activity-grid">
        <section className="activity-module" aria-labelledby="executions-title">
          <div className="module-heading">
            <div>
              <p className="eyebrow">File d’exécution</p>
              <h2 id="executions-title">Exécutions</h2>
            </div>
            <span className="module-count">{executions.length} au total</span>
          </div>
          {loading ? (
            <p className="muted-copy">Lecture des exécutions…</p>
          ) : executions.length === 0 ? (
            <div className="activity-empty">
              <span>—</span>
              <p>Aucune exécution persistée pour ce projet.</p>
            </div>
          ) : (
            <div className="execution-list">
              {executions.map((execution) => {
                const canCancel = actorType === "agent" && isActiveExecution(execution);
                const isConfirming =
                  pendingAction?.kind === "cancel" && pendingAction.id === execution.id;
                return (
                  <article className="execution-row" key={execution.id}>
                    <div className="execution-row-heading">
                      <div>
                        <strong>{execution.instruction}</strong>
                        <span>
                          {execution.id} · {formatDate(execution.createdAt)}
                        </span>
                      </div>
                      <StatusBadge tone={toneForExecution(execution.state)}>
                        {EXECUTION_LABELS[execution.state]}
                      </StatusBadge>
                    </div>
                    {(execution.errorCode || execution.errorMessage) && (
                      <p className="execution-error">
                        {execution.errorCode ?? "EXECUTION_ERROR"}:{" "}
                        {execution.errorMessage ?? "Erreur non détaillée"}
                      </p>
                    )}
                    <div className="execution-row-footer">
                      <span>Affectation {execution.assignmentId}</span>
                      {isActiveExecution(execution) && (
                        <div className="activity-actions">
                          <button
                            className="quiet-button"
                            type="button"
                            disabled={!canCancel}
                            title={
                              canCancel
                                ? undefined
                                : "Réservé à l’identité agent affectée"
                            }
                            onClick={() =>
                              setPendingAction({ kind: "cancel", id: execution.id })
                            }
                          >
                            Annuler
                          </button>
                          {isConfirming && (
                            <div className="confirm-strip">
                              <span>Confirmer l’arrêt ?</span>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => void confirmAction()}
                              >
                                Confirmer
                              </button>
                              <button
                                className="quiet-button"
                                type="button"
                                onClick={() => setPendingAction(null)}
                              >
                                Garder
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="activity-module" aria-labelledby="approvals-title">
          <div className="module-heading">
            <div>
              <p className="eyebrow">Boîte personnelle</p>
              <h2 id="approvals-title">Approbations</h2>
            </div>
            <span className="module-count">{pendingApprovals.length} à traiter</span>
          </div>
          {loading ? (
            <p className="muted-copy">Lecture des décisions…</p>
          ) : approvals.length === 0 ? (
            <div className="activity-empty">
              <span>✓</span>
              <p>Aucune décision enregistrée pour ce projet.</p>
            </div>
          ) : (
            <div className="approval-list">
              {approvals.map((approval) => {
                const isPending = approval.status === "pending";
                const isConfirming =
                  pendingAction?.id === approval.id && pendingAction.kind !== "cancel";
                return (
                  <article className="approval-row" key={approval.id}>
                    <div className="approval-row-heading">
                      <div>
                        <strong>{approval.actionType}</strong>
                        <span>
                          {approval.requiredPermission} ·{" "}
                          {formatDate(approval.requestedAt)}
                        </span>
                      </div>
                      <StatusBadge tone={toneForApproval(approval.status)}>
                        {APPROVAL_LABELS[approval.status]}
                      </StatusBadge>
                    </div>
                    <p className="approval-context">
                      Exécution <code>{approval.executionId}</code>
                    </p>
                    {isPending && (
                      <div className="approval-actions">
                        {!isConfirming ? (
                          <>
                            <button
                              className="primary-button"
                              type="button"
                              onClick={() =>
                                setPendingAction({ kind: "approved", id: approval.id })
                              }
                            >
                              Accepter
                            </button>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() =>
                                setPendingAction({ kind: "denied", id: approval.id })
                              }
                            >
                              Refuser
                            </button>
                          </>
                        ) : (
                          <div className="confirm-strip">
                            <span>
                              {pendingAction.kind === "approved"
                                ? "Confirmer l’acceptation ?"
                                : "Confirmer le refus ?"}
                            </span>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => void confirmAction()}
                            >
                              Confirmer
                            </button>
                            <button
                              className="quiet-button"
                              type="button"
                              onClick={() => setPendingAction(null)}
                            >
                              Garder
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {approval.decisionReason && (
                      <p className="approval-reason">{approval.decisionReason}</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {actorType === "agent" && (
        <section
          className="activity-module activity-timeline"
          aria-labelledby="timeline-title"
        >
          <div className="module-heading">
            <div>
              <p className="eyebrow">Journal durable</p>
              <h2 id="timeline-title">Derniers événements</h2>
            </div>
            <span className="module-count">{events.length} entrées</span>
          </div>
          {events.length === 0 ? (
            <p className="muted-copy">
              Aucun événement disponible pour cette identité.
            </p>
          ) : (
            <div className="event-list">
              {events.map((event) => (
                <article className="event-row" key={event.id}>
                  <span className="event-marker" aria-hidden="true" />
                  <div>
                    <strong>{event.type}</strong>
                    <span>
                      {event.actorType} · {event.actorId} ·{" "}
                      {formatDate(event.createdAt)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
