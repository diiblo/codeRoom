import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClient,
  ApiClientError,
  type Agent,
  type Ticket,
  type TicketDetail,
} from "./api";

type TicketsViewProps = {
  api: ApiClient;
  projectId: string;
  actorType: "human" | "agent" | "system";
  agents: Agent[];
};

const STATE_LABELS: Record<Ticket["state"], string> = {
  todo: "À faire",
  in_progress: "En cours",
  in_review: "En revue",
  done: "Terminé",
  blocked: "Bloqué",
  cancelled: "Annulé",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(state: Ticket["state"]) {
  if (state === "done") return "good";
  if (state === "blocked" || state === "cancelled") return "warn";
  if (state === "in_review") return "accent";
  return "muted";
}

function ticketStatus(ticket: Ticket) {
  return (
    <span className={`status-badge status-badge-${statusTone(ticket.state)}`}>
      {STATE_LABELS[ticket.state]}
    </span>
  );
}

function evidenceSummary(detail: TicketDetail) {
  const evidence = detail.deliverables.flatMap(
    (deliverable) => deliverable.testEvidence,
  );
  if (evidence.length === 0) return { label: "Preuve absente", tone: "warn" as const };
  if (evidence.some((item) => item.outcome !== "passed")) {
    return { label: "Tests à surveiller", tone: "warn" as const };
  }
  return { label: "Tests passés", tone: "good" as const };
}

export function TicketsView({ api, projectId, actorType, agents }: TicketsViewProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailRequestRef = useRef(0);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.listTickets(projectId);
      setTickets(response.items);
      setSelectedTicketId((current) =>
        current && response.items.some((ticket) => ticket.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
      setError(null);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : "Les tickets n’ont pas pu être chargés.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  const loadDetail = useCallback(
    async (ticketId: string) => {
      const requestId = ++detailRequestRef.current;
      setDetailLoading(true);
      try {
        const response = await api.getTicket(ticketId);
        if (requestId !== detailRequestRef.current) return;
        setDetail(response);
        setError(null);
      } catch (requestError: unknown) {
        if (requestId !== detailRequestRef.current) return;
        setError(
          requestError instanceof ApiClientError
            ? requestError.message
            : "La fiche du ticket n’a pas pu être chargée.",
        );
      } finally {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    setDetail(null);
    setSelectedTicketId(null);
    void loadTickets();
  }, [loadTickets, projectId]);

  useEffect(() => {
    if (selectedTicketId) void loadDetail(selectedTicketId);
  }, [loadDetail, selectedTicketId]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, tickets],
  );
  const owner = detail?.ticket.ownerId
    ? agents.find((agent) => agent.id === detail.ticket.ownerId)
    : undefined;
  const summary = detail ? evidenceSummary(detail) : null;
  const canReview = actorType === "human" && detail?.ticket.state === "in_review";

  async function submitReview(decision: "accepted" | "rejected") {
    if (!detail || !canReview) return;
    if (decision === "rejected" && !reviewReason.trim()) {
      setError("Un retour est requis pour demander des corrections.");
      return;
    }
    const deliverable = detail.deliverables[0];
    if (!deliverable) {
      setError("Aucun livrable n’est disponible pour cette revue.");
      return;
    }
    setReviewing(true);
    setError(null);
    try {
      await api.submitReview(detail.ticket.id, {
        deliverableId: deliverable.id,
        decision,
        ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {}),
      });
      setReviewReason("");
      setNotice(
        decision === "accepted"
          ? "Ticket accepté et clôturé."
          : "Corrections demandées.",
      );
      await Promise.all([loadTickets(), loadDetail(detail.ticket.id)]);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : "La revue n’a pas pu être enregistrée.",
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <section className="tickets-view" aria-labelledby="tickets-title">
      <div className="section-title-line tickets-heading">
        <div>
          <p className="eyebrow">Développement vérifiable</p>
          <h2 id="tickets-title">Tickets et revue</h2>
          <p className="section-supporting-copy">
            Suivez l’intention, le travail livré et la décision qui clôture le ticket.
          </p>
        </div>
        <div className="tickets-heading-status">
          <span>{tickets.length} ticket(s)</span>
          <span className="ticket-signal" aria-hidden="true" />
        </div>
      </div>

      {error && (
        <div className="ticket-inline-notice ticket-inline-notice-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div
          className="ticket-inline-notice ticket-inline-notice-success"
          role="status"
        >
          {notice}
        </div>
      )}

      {loading ? (
        <div className="ticket-loading" role="status">
          <span className="loading-line" />
          <span className="loading-line loading-line-short" />
          Lecture des tickets…
        </div>
      ) : tickets.length === 0 ? (
        <div className="ticket-empty">
          <span className="ticket-empty-mark" aria-hidden="true">
            □
          </span>
          <div>
            <h3>Aucun ticket dans cet espace</h3>
            <p>
              Les tickets créés par une exécution agent apparaîtront ici avec leur
              responsable et leur preuve de livraison.
            </p>
          </div>
        </div>
      ) : (
        <div className="ticket-workbench">
          <nav className="ticket-queue" aria-label="Tickets du projet">
            <div className="ticket-queue-heading">
              <span>File de travail</span>
              <span>{tickets.length.toString().padStart(2, "0")}</span>
            </div>
            <div className="ticket-queue-list">
              {tickets.map((ticket) => {
                const ticketOwner = ticket.ownerId
                  ? agents.find((agent) => agent.id === ticket.ownerId)
                  : undefined;
                return (
                  <button
                    className={`ticket-queue-item ${ticket.id === selectedTicketId ? "is-selected" : ""}`}
                    key={ticket.id}
                    type="button"
                    onClick={() => {
                      setSelectedTicketId(ticket.id);
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    <span className="ticket-queue-state" aria-hidden="true" />
                    <span className="ticket-queue-copy">
                      <strong>{ticket.title}</strong>
                      <small>
                        {ticketOwner?.displayName ?? "Sans responsable"} ·{" "}
                        {STATE_LABELS[ticket.state]}
                      </small>
                    </span>
                    <span className="ticket-queue-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <article className="ticket-detail" aria-live="polite">
            {detailLoading || !detail || !selectedTicket ? (
              <div className="ticket-detail-loading">
                <span className="loading-line" />
                Lecture de la fiche…
              </div>
            ) : (
              <>
                <header className="ticket-detail-header">
                  <div>
                    <div className="ticket-detail-kicker">
                      <span>{detail.ticket.id}</span>
                      {ticketStatus(detail.ticket)}
                    </div>
                    <h3>{detail.ticket.title}</h3>
                    <p>{detail.ticket.body}</p>
                  </div>
                  <div className="ticket-detail-owner">
                    <span className="ticket-detail-owner-label">Responsable</span>
                    <strong>
                      {owner?.displayName ?? detail.ticket.ownerId ?? "Non affecté"}
                    </strong>
                    <small>{owner?.role ?? "Aucune affectation active"}</small>
                  </div>
                </header>

                <div className="ticket-fact-strip">
                  <div>
                    <span>Créé</span>
                    <strong>{formatDate(detail.ticket.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Mis à jour</span>
                    <strong>{formatDate(detail.ticket.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>Livrables</span>
                    <strong>
                      {detail.deliverables.length.toString().padStart(2, "0")}
                    </strong>
                  </div>
                  <div>
                    <span>Revue</span>
                    <strong>
                      {detail.reviews.length ? "Historique" : "En attente"}
                    </strong>
                  </div>
                </div>

                <section
                  className="ticket-detail-section"
                  aria-labelledby="criteria-title"
                >
                  <div className="ticket-section-heading">
                    <div>
                      <span className="eyebrow">Contrat de sortie</span>
                      <h4 id="criteria-title">Critères d’acceptation</h4>
                    </div>
                    <span className="ticket-section-count">
                      {detail.ticket.acceptanceCriteria.length
                        .toString()
                        .padStart(2, "0")}
                    </span>
                  </div>
                  <ul className="criteria-list">
                    {detail.ticket.acceptanceCriteria.map((criterion) => (
                      <li key={criterion}>
                        <span aria-hidden="true">□</span>
                        {criterion}
                      </li>
                    ))}
                  </ul>
                </section>

                <section
                  className="ticket-detail-section"
                  aria-labelledby="evidence-title"
                >
                  <div className="ticket-section-heading">
                    <div>
                      <span className="eyebrow">Preuve attachée</span>
                      <h4 id="evidence-title">Git et tests</h4>
                    </div>
                    {summary && (
                      <span className={`status-badge status-badge-${summary.tone}`}>
                        {summary.label}
                      </span>
                    )}
                  </div>
                  {detail.deliverables.length === 0 ? (
                    <div className="ticket-warning">
                      <strong>Livrable absent.</strong>
                      <span>
                        Le ticket ne peut pas passer en revue sans preuve Git et test.
                      </span>
                    </div>
                  ) : (
                    <div className="deliverable-list">
                      {detail.deliverables.map((deliverable) => (
                        <article className="deliverable-block" key={deliverable.id}>
                          <div className="deliverable-heading">
                            <div>
                              <strong>{deliverable.gitRef}</strong>
                              <span>
                                {deliverable.gitCommit.slice(0, 8)} ·{" "}
                                {deliverable.workingTreeStatus === "clean"
                                  ? "propre"
                                  : "modifié"}
                              </span>
                            </div>
                            <span className="deliverable-source">
                              {deliverable.submittedBy.id}
                            </span>
                          </div>
                          <div className="test-evidence-list">
                            {deliverable.testEvidence.length === 0 ? (
                              <div className="ticket-warning compact">
                                <strong>Preuve de test manquante.</strong>
                                <span>
                                  Ce livrable doit être complété avant la revue.
                                </span>
                              </div>
                            ) : (
                              deliverable.testEvidence.map((evidence) => (
                                <div className="test-evidence-row" key={evidence.id}>
                                  <span
                                    className={`evidence-dot evidence-dot-${evidence.outcome}`}
                                    aria-hidden="true"
                                  />
                                  <div>
                                    <strong>{evidence.command}</strong>
                                    <span>
                                      {evidence.outcome === "passed"
                                        ? "Test passé"
                                        : evidence.outcome === "failed"
                                          ? `Échec · code ${evidence.exitCode ?? "inconnu"}`
                                          : "Résultat bloqué"}
                                    </span>
                                  </div>
                                  <time dateTime={evidence.finishedAt}>
                                    {formatDate(evidence.finishedAt)}
                                  </time>
                                </div>
                              ))
                            )}
                          </div>
                          <details className="diff-details">
                            <summary>Voir le diff capturé</summary>
                            <pre>
                              {deliverable.diff || "Aucun changement textuel capturé."}
                            </pre>
                          </details>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                {detail.reviews.length > 0 && (
                  <section
                    className="ticket-detail-section"
                    aria-labelledby="history-title"
                  >
                    <div className="ticket-section-heading">
                      <div>
                        <span className="eyebrow">Décisions tracées</span>
                        <h4 id="history-title">Historique de revue</h4>
                      </div>
                    </div>
                    <div className="review-history">
                      {detail.reviews.map((review) => (
                        <div className="review-history-row" key={review.id}>
                          <span
                            className={`review-history-mark review-history-mark-${review.decision}`}
                            aria-hidden="true"
                          />
                          <div>
                            <strong>
                              {review.decision === "accepted"
                                ? "Accepté"
                                : "Corrections demandées"}
                            </strong>
                            <span>
                              {review.reviewer.id} · {formatDate(review.createdAt)}
                            </span>
                          </div>
                          {review.reason && <p>{review.reason}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {canReview && (
                  <section
                    className="ticket-review-panel"
                    aria-labelledby="review-panel-title"
                  >
                    <div>
                      <span className="eyebrow">Décision humaine</span>
                      <h4 id="review-panel-title">
                        Cette livraison attend votre regard
                      </h4>
                      <p>
                        Les tests restent des preuves séparées du verdict. Vérifiez le
                        diff avant de clôturer.
                      </p>
                    </div>
                    <label>
                      Retour ou raison de rejet
                      <textarea
                        value={reviewReason}
                        onChange={(event) => setReviewReason(event.target.value)}
                        placeholder="Optionnel pour accepter, requis pour demander des corrections"
                        rows={3}
                      />
                    </label>
                    <div className="ticket-review-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={reviewing}
                        onClick={() => void submitReview("rejected")}
                      >
                        Demander des corrections
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={reviewing}
                        onClick={() => void submitReview("accepted")}
                      >
                        {reviewing ? "Enregistrement…" : "Accepter la livraison"}
                      </button>
                    </div>
                  </section>
                )}
                {!canReview && detail.ticket.state === "in_review" && (
                  <div className="ticket-review-readonly">
                    <strong>Revue en attente.</strong>
                    <span>
                      Une identité humaine autorisée doit enregistrer le verdict.
                    </span>
                  </div>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
