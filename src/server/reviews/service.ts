import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { DeliverableService, type DeliverableRecord } from "../deliverables/service.js";
import { EventService } from "../events/service.js";
import { AuthorizationService } from "../security/authorization.js";
import { TicketService, type TicketRecord } from "../tickets/service.js";

export const REVIEW_DECISIONS = ["accepted", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ReviewActor = {
  type: "agent" | "human";
  id: string;
};

export type ReviewSubmissionRecord = {
  id: string;
  idempotencyKey: string;
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  projectId: string;
  submitter: ReviewActor;
  submittedAt: string;
};

export type ReviewRecord = {
  id: string;
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  projectId: string;
  reviewer: ReviewActor;
  decision: ReviewDecision;
  reason: string;
  createdAt: string;
};

export type SubmitForReviewInput = {
  id?: string;
  ticketId: string;
  deliverableId: string;
  executionId?: string;
  actor: ReviewActor;
  idempotencyKey: string;
  correlationId?: string;
  now?: string;
};

export type RecordReviewInput = {
  id?: string;
  ticketId: string;
  deliverableId: string;
  executionId?: string;
  reviewerAssignmentId?: string;
  actor: ReviewActor;
  decision: ReviewDecision;
  reason?: string;
  idempotencyKey: string;
  correlationId?: string;
  now?: string;
};

export type ReviewServiceOptions = {
  now?: () => string;
};

export class ReviewServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ReviewServiceError";
  }
}

type SubmissionRow = {
  id: string;
  idempotencyKey: string;
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  projectId: string;
  submitterType: ReviewActor["type"];
  submitterId: string;
  submittedAt: string;
};

type ReviewRow = {
  id: string;
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  projectId: string;
  reviewerType: ReviewActor["type"];
  reviewerId: string;
  decision: ReviewDecision;
  reason: string;
  createdAt: string;
};

const SUBMISSION_SELECT = `
  SELECT
    id,
    idempotency_key AS idempotencyKey,
    ticket_id AS ticketId,
    deliverable_id AS deliverableId,
    execution_id AS executionId,
    project_id AS projectId,
    submitter_type AS submitterType,
    submitter_id AS submitterId,
    submitted_at AS submittedAt
  FROM ticket_review_submissions
`;

const REVIEW_SELECT = `
  SELECT
    id,
    ticket_id AS ticketId,
    deliverable_id AS deliverableId,
    execution_id AS executionId,
    project_id AS projectId,
    reviewer_type AS reviewerType,
    reviewer_id AS reviewerId,
    decision,
    reason,
    created_at AS createdAt
  FROM reviews
`;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ReviewServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function optionalText(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

function validateTimestamp(value: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new ReviewServiceError("VALIDATION_ERROR", "Invalid review timestamp");
  }
  return value;
}

function normalizeActor(actor: ReviewActor): ReviewActor {
  const id = requireText(actor.id, "actor.id");
  if (actor.type !== "agent" && actor.type !== "human") {
    throw new ReviewServiceError(
      "FORBIDDEN",
      "Review actor must be an agent or a human",
    );
  }
  return { type: actor.type, id };
}

function normalizeDecision(value: ReviewDecision): ReviewDecision {
  if (!REVIEW_DECISIONS.includes(value)) {
    throw new ReviewServiceError("VALIDATION_ERROR", "Unknown review decision");
  }
  return value;
}

function toSubmission(row: SubmissionRow): ReviewSubmissionRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    ticketId: row.ticketId,
    deliverableId: row.deliverableId,
    executionId: row.executionId,
    projectId: row.projectId,
    submitter: { type: row.submitterType, id: row.submitterId },
    submittedAt: row.submittedAt,
  };
}

function toReview(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    deliverableId: row.deliverableId,
    executionId: row.executionId,
    projectId: row.projectId,
    reviewer: { type: row.reviewerType, id: row.reviewerId },
    decision: row.decision,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function submissionFingerprint(input: {
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  actor: ReviewActor;
}) {
  return JSON.stringify(input);
}

function reviewFingerprint(input: {
  ticketId: string;
  deliverableId: string;
  executionId: string | null;
  actor: ReviewActor;
  decision: ReviewDecision;
  reason: string;
}) {
  return JSON.stringify(input);
}

export class ReviewService {
  private readonly authorization: AuthorizationService;
  private readonly deliverables: DeliverableService;
  private readonly events: EventService;
  private readonly tickets: TicketService;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: ReviewServiceOptions = {},
  ) {
    this.authorization = new AuthorizationService(database);
    this.deliverables = new DeliverableService(database);
    this.events = new EventService(database);
    this.tickets = new TicketService(database, { now: options.now });
    this.now = options.now ?? (() => new Date().toISOString());
  }

  submitForReview(input: SubmitForReviewInput) {
    return transaction(this.database, () =>
      this.submitForReviewWithinTransaction(input),
    );
  }

  submitForReviewWithinTransaction(input: SubmitForReviewInput) {
    const normalized = this.normalizeSubmission(input);
    const existing = this.database
      .prepare(
        `
          SELECT
            id,
            idempotency_key AS idempotencyKey,
            ticket_id AS ticketId,
            deliverable_id AS deliverableId,
            execution_id AS executionId,
            project_id AS projectId,
            submitter_type AS submitterType,
            submitter_id AS submitterId,
            submitted_at AS submittedAt,
            request_fingerprint AS requestFingerprint
          FROM ticket_review_submissions
          WHERE idempotency_key = ?
        `,
      )
      .get(normalized.idempotencyKey) as
      (SubmissionRow & { requestFingerprint: string }) | undefined;
    const fingerprint = submissionFingerprint({
      ticketId: normalized.ticketId,
      deliverableId: normalized.deliverableId,
      executionId: normalized.executionId,
      actor: normalized.actor,
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ReviewServiceError(
          "CONFLICT",
          "Review submission idempotency key was already used for another request",
        );
      }
      return {
        submission: toSubmission(existing),
        ticket: this.requireTicket(normalized.ticketId),
      };
    }

    const ticket = this.requireTicket(normalized.ticketId);
    if (ticket.state !== "in_progress") {
      throw new ReviewServiceError(
        "CONFLICT",
        "Only an in-progress ticket can be submitted for review",
      );
    }
    if (ticket.ownerId !== normalized.actor.id) {
      throw new ReviewServiceError(
        "FORBIDDEN",
        "Only the responsible agent can submit the ticket for review",
      );
    }
    const deliverable = this.requireReviewableDeliverable(
      ticket,
      normalized.deliverableId,
    );
    const transitioned = this.tickets.transitionTicketWithinTransaction({
      ticketId: ticket.id,
      nextState: "in_review",
      actor: normalized.actor,
      idempotencyKey: `review-submit:${normalized.idempotencyKey}`,
      now: normalized.timestamp,
    });
    const submission: ReviewSubmissionRecord = {
      id: requireText(input.id ?? `submission_${randomUUID()}`, "id"),
      idempotencyKey: normalized.idempotencyKey,
      ticketId: ticket.id,
      deliverableId: deliverable.id,
      executionId: normalized.executionId,
      projectId: ticket.projectId,
      submitter: normalized.actor,
      submittedAt: normalized.timestamp,
    };
    this.database
      .prepare(
        `
          INSERT INTO ticket_review_submissions
            (id, idempotency_key, ticket_id, deliverable_id, execution_id,
             project_id, submitter_type, submitter_id, request_fingerprint, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        submission.id,
        submission.idempotencyKey,
        submission.ticketId,
        submission.deliverableId,
        submission.executionId,
        submission.projectId,
        submission.submitter.type,
        submission.submitter.id,
        fingerprint,
        submission.submittedAt,
      );
    return { submission, ticket: transitioned };
  }

  recordReview(input: RecordReviewInput) {
    return transaction(this.database, () => this.recordReviewWithinTransaction(input));
  }

  recordReviewWithinTransaction(input: RecordReviewInput) {
    const normalized = this.normalizeReview(input);
    const existing = this.database
      .prepare(
        `
          SELECT review_id AS reviewId, request_fingerprint AS requestFingerprint
          FROM review_requests
          WHERE idempotency_key = ?
        `,
      )
      .get(normalized.idempotencyKey) as
      { reviewId: string; requestFingerprint: string } | undefined;
    const fingerprint = reviewFingerprint({
      ticketId: normalized.ticketId,
      deliverableId: normalized.deliverableId,
      executionId: normalized.executionId,
      actor: normalized.actor,
      decision: normalized.decision,
      reason: normalized.reason,
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ReviewServiceError(
          "CONFLICT",
          "Review idempotency key was already used for another verdict",
        );
      }
      return {
        review: this.requireReview(existing.reviewId),
        ticket: this.requireTicket(normalized.ticketId),
      };
    }

    const ticket = this.requireTicket(normalized.ticketId);
    if (ticket.state !== "in_review") {
      throw new ReviewServiceError(
        "CONFLICT",
        "Only a ticket in review can receive a verdict",
      );
    }
    const deliverable = this.requireReviewableDeliverable(
      ticket,
      normalized.deliverableId,
    );
    this.assertReviewerAllowed(ticket, deliverable, normalized);
    const nextState = normalized.decision === "accepted" ? "done" : "in_progress";
    const transitioned = this.tickets.transitionTicketWithinTransaction({
      ticketId: ticket.id,
      nextState,
      actor: normalized.actor,
      reason: normalized.reason,
      idempotencyKey: `review-verdict:${normalized.idempotencyKey}`,
      now: normalized.timestamp,
    });
    const review: ReviewRecord = {
      id: requireText(input.id ?? `review_${randomUUID()}`, "id"),
      ticketId: ticket.id,
      deliverableId: deliverable.id,
      executionId: normalized.executionId,
      projectId: ticket.projectId,
      reviewer: normalized.actor,
      decision: normalized.decision,
      reason: normalized.reason,
      createdAt: normalized.timestamp,
    };
    this.database
      .prepare(
        `
          INSERT INTO reviews
            (id, ticket_id, deliverable_id, execution_id, project_id,
             reviewer_type, reviewer_id, decision, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        review.id,
        review.ticketId,
        review.deliverableId,
        review.executionId,
        review.projectId,
        review.reviewer.type,
        review.reviewer.id,
        review.decision,
        review.reason,
        review.createdAt,
      );
    this.database
      .prepare(
        `
          INSERT INTO review_requests
            (idempotency_key, review_id, request_fingerprint)
          VALUES (?, ?, ?)
        `,
      )
      .run(normalized.idempotencyKey, review.id, fingerprint);
    this.events.recordEvent({
      type: "review.recorded",
      version: 1,
      projectId: ticket.projectId,
      actor: normalized.actor,
      correlationId: input.correlationId?.trim() || normalized.idempotencyKey,
      payload: {
        reviewId: review.id,
        ticketId: review.ticketId,
        deliverableId: review.deliverableId,
        decision: review.decision,
        nextState,
      },
    });
    return { review, ticket: transitioned };
  }

  getSubmission(submissionId: string) {
    const id = requireText(submissionId, "submissionId");
    const row = this.database.prepare(`${SUBMISSION_SELECT} WHERE id = ?`).get(id) as
      SubmissionRow | undefined;
    return row ? toSubmission(row) : undefined;
  }

  getReview(reviewId: string) {
    const id = requireText(reviewId, "reviewId");
    const row = this.database.prepare(`${REVIEW_SELECT} WHERE id = ?`).get(id) as
      ReviewRow | undefined;
    return row ? toReview(row) : undefined;
  }

  requireReview(reviewId: string) {
    const review = this.getReview(reviewId);
    if (!review) throw new ReviewServiceError("NOT_FOUND", "Review not found");
    return review;
  }

  listReviewsByTicket(ticketId: string) {
    const id = requireText(ticketId, "ticketId");
    return (
      this.database
        .prepare(`${REVIEW_SELECT} WHERE ticket_id = ? ORDER BY created_at, id`)
        .all(id) as ReviewRow[]
    ).map(toReview);
  }

  private normalizeSubmission(input: SubmitForReviewInput) {
    const actor = normalizeActor(input.actor);
    if (actor.type !== "agent") {
      throw new ReviewServiceError(
        "FORBIDDEN",
        "Only the responsible agent can submit a ticket for review",
      );
    }
    return {
      ticketId: requireText(input.ticketId, "ticketId"),
      deliverableId: requireText(input.deliverableId, "deliverableId"),
      executionId: input.executionId
        ? requireText(input.executionId, "executionId")
        : null,
      actor,
      idempotencyKey: requireText(input.idempotencyKey, "idempotencyKey"),
      timestamp: validateTimestamp(input.now ?? this.now()),
    };
  }

  private normalizeReview(input: RecordReviewInput) {
    const actor = normalizeActor(input.actor);
    const decision = normalizeDecision(input.decision);
    const reason = input.reason?.trim() || "";
    if (decision === "rejected" && !reason) {
      throw new ReviewServiceError(
        "VALIDATION_ERROR",
        "A rejected review requires a reason",
      );
    }
    return {
      ticketId: requireText(input.ticketId, "ticketId"),
      deliverableId: requireText(input.deliverableId, "deliverableId"),
      executionId: input.executionId
        ? requireText(input.executionId, "executionId")
        : null,
      reviewerAssignmentId: optionalText(
        input.reviewerAssignmentId,
        "reviewerAssignmentId",
      ),
      actor,
      decision,
      reason,
      idempotencyKey: requireText(input.idempotencyKey, "idempotencyKey"),
      timestamp: validateTimestamp(input.now ?? this.now()),
    };
  }

  private requireTicket(ticketId: string) {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) throw new ReviewServiceError("NOT_FOUND", "Ticket not found");
    return ticket;
  }

  private requireReviewableDeliverable(
    ticket: TicketRecord,
    deliverableId: string,
  ): DeliverableRecord {
    const deliverable = this.deliverables.getDeliverable(deliverableId);
    if (!deliverable) {
      throw new ReviewServiceError("NOT_FOUND", "Deliverable not found");
    }
    if (
      deliverable.ticketId !== ticket.id ||
      deliverable.projectId !== ticket.projectId
    ) {
      throw new ReviewServiceError(
        "FORBIDDEN",
        "Deliverable does not belong to the ticket project",
      );
    }
    if (deliverable.state !== "submitted") {
      throw new ReviewServiceError("CONFLICT", "Deliverable is not reviewable");
    }
    if (deliverable.testEvidence.length === 0) {
      throw new ReviewServiceError(
        "CONFLICT",
        "A deliverable without test evidence cannot be reviewed",
      );
    }
    return deliverable;
  }

  private assertReviewerAllowed(
    ticket: TicketRecord,
    deliverable: DeliverableRecord,
    input: ReturnType<ReviewService["normalizeReview"]>,
  ) {
    if (
      deliverable.submittedBy.type === input.actor.type &&
      deliverable.submittedBy.id === input.actor.id
    ) {
      throw new ReviewServiceError(
        "FORBIDDEN",
        "The deliverable submitter cannot review their own work",
      );
    }
    if (input.actor.type === "agent") {
      if (ticket.ownerId === input.actor.id) {
        throw new ReviewServiceError(
          "FORBIDDEN",
          "The responsible agent cannot review their own ticket",
        );
      }
      if (!input.reviewerAssignmentId) {
        throw new ReviewServiceError(
          "FORBIDDEN",
          "An agent reviewer must provide an active assignment",
        );
      }
      const authorization = this.authorization.authorize({
        projectId: ticket.projectId,
        permission: "review.submit",
        identity: {
          type: "agent",
          id: input.actor.id,
          assignmentId: input.reviewerAssignmentId,
        },
      });
      if (!authorization.allowed) {
        throw new ReviewServiceError("FORBIDDEN", "Reviewer is not authorized");
      }
    }
  }
}
