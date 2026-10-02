import { randomUUID } from "node:crypto";
import type { ReviewCompletedEvent } from "./review-events.js";

export type ReviewSessionState =
  | "waiting"
  | "queued"
  | "received"
  | "cancelled";

export interface ReviewSession {
  reviewId: string;
  receiptToken: string;
  documentPath: string;
  state: ReviewSessionState;
  controller: AbortController;
  completion?: { delivered: boolean; event: ReviewCompletedEvent };
}

// Routing state only: Markdown remains the durable record of feedback. Terminal
// sessions are evicted first; never silently expire a human's active review.
export class ReviewSessions {
  private sessions = new Map<string, ReviewSession>();

  create(documentPath: string): ReviewSession | undefined {
    if (this.sessions.size >= 1000) {
      for (const [id, session] of this.sessions) {
        if (session.state === "received" || session.state === "cancelled") {
          this.sessions.delete(id);
          break;
        }
      }
    }
    if (this.sessions.size >= 1000) return undefined;
    const session: ReviewSession = {
      reviewId: randomUUID(),
      receiptToken: randomUUID(),
      documentPath,
      state: "waiting",
      controller: new AbortController(),
    };
    this.sessions.set(session.reviewId, session);
    return session;
  }

  get(reviewId: string): ReviewSession | undefined {
    return this.sessions.get(reviewId);
  }

  cancel(session: ReviewSession): void {
    if (session.state === "received") return;
    session.state = "cancelled";
    session.controller.abort();
  }
}
