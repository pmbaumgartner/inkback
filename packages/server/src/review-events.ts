import path from "node:path";

export interface ReviewCompletedEventInput {
  reviewId?: string;
  documentPath: string;
  projectPath: string;
  relativePath: string;
  version: string;
  summary: {
    comments: number;
    replies: number;
    suggestions: number;
    unresolved: number;
  };
  overallComment?: string;
}

export interface ReviewCompletedEvent extends ReviewCompletedEventInput {
  type: "review.completed";
  sequence: number;
  createdAt: string;
}

export interface WaitForReviewEventsOptions {
  reviewId?: string;
  documentPath?: string;
  afterSequence?: number;
  timeoutMs?: number;
  batchWindowMs?: number;
  signal?: AbortSignal;
}

export interface WaitForReviewEventsResult {
  events: ReviewCompletedEvent[];
  timedOut: boolean;
  nextSequence: number;
}

interface Waiter {
  options: NormalizedWaitOptions;
  resolve: (result: WaitForReviewEventsResult) => void;
  reject: (reason: unknown) => void;
  removeAbortListener: () => void;
  timeout: NodeJS.Timeout | null;
  batchTimeout: NodeJS.Timeout | null;
}

const DEFAULT_BATCH_WINDOW_MS = 250;
const MAX_RETAINED_EVENTS = 100;

type NormalizedWaitOptions = Required<
  Omit<
    WaitForReviewEventsOptions,
    "documentPath" | "reviewId" | "timeoutMs" | "signal"
  >
> & {
  reviewId?: string;
  documentPath?: string;
  timeoutMs?: number;
};

export class ReviewEventQueue {
  private events: ReviewCompletedEvent[] = [];
  private waiters = new Set<Waiter>();
  private nextSequence = 1;

  emit(input: ReviewCompletedEventInput): {
    // A matching watcher was active when queued; this is not a receipt acknowledgement.
    delivered: boolean;
    event: ReviewCompletedEvent;
  } {
    const event: ReviewCompletedEvent = {
      ...input,
      type: "review.completed",
      sequence: this.nextSequence,
      createdAt: new Date().toISOString(),
    };
    this.nextSequence += 1;
    this.events.push(event);
    this.events = this.events.slice(-MAX_RETAINED_EVENTS);

    let delivered = false;
    for (const waiter of [...this.waiters]) {
      if (matchesWaiter(event, waiter.options)) {
        delivered = true;
        this.scheduleResolve(waiter);
      }
    }

    return { delivered, event };
  }

  wait(
    options: WaitForReviewEventsOptions = {},
  ): Promise<WaitForReviewEventsResult> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);

    const normalized = normalizeWaitOptions(options);
    const existing = this.matchingEvents(normalized);

    if (existing.length > 0) {
      return Promise.resolve(
        resultForEvents(existing, false, this.nextSequence),
      );
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        options: normalized,
        resolve,
        reject,
        removeAbortListener: () => {},
        batchTimeout: null,
        timeout:
          normalized.timeoutMs !== undefined
            ? setTimeout(() => {
                this.resolveWaiter(waiter, true);
              }, normalized.timeoutMs)
            : null,
      };

      this.waiters.add(waiter);
      if (signal) {
        const onAbort = () => {
          if (!this.removeWaiter(waiter)) return;
          waiter.reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.removeAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      }
    });
  }

  waiterCount(): number {
    return this.waiters.size;
  }

  latestSequence(): number {
    return this.nextSequence - 1;
  }

  waiterCountForDocument(documentPath: string, reviewId?: string): number {
    const normalizedPath = path.resolve(documentPath);
    return [...this.waiters].filter(
      (waiter) =>
        waiter.options.documentPath === normalizedPath &&
        waiter.options.reviewId === reviewId,
    ).length;
  }

  private matchingEvents(
    options: NormalizedWaitOptions,
  ): ReviewCompletedEvent[] {
    return this.events.filter((event) => matchesWaiter(event, options));
  }

  private scheduleResolve(waiter: Waiter): void {
    if (waiter.batchTimeout) return;

    if (waiter.timeout) {
      clearTimeout(waiter.timeout);
      waiter.timeout = null;
    }

    waiter.batchTimeout = setTimeout(() => {
      this.resolveWaiter(waiter, false);
    }, waiter.options.batchWindowMs);
  }

  private resolveWaiter(waiter: Waiter, timedOut: boolean): void {
    if (!this.removeWaiter(waiter)) return;

    const events = timedOut ? [] : this.matchingEvents(waiter.options);
    waiter.resolve(resultForEvents(events, timedOut, this.nextSequence));
  }

  private removeWaiter(waiter: Waiter): boolean {
    if (!this.waiters.delete(waiter)) return false;
    waiter.removeAbortListener();
    if (waiter.timeout) {
      clearTimeout(waiter.timeout);
    }
    if (waiter.batchTimeout) {
      clearTimeout(waiter.batchTimeout);
    }

    return true;
  }
}

function normalizeWaitOptions(
  options: WaitForReviewEventsOptions,
): NormalizedWaitOptions {
  return {
    reviewId: options.reviewId,
    documentPath: options.documentPath
      ? path.resolve(options.documentPath)
      : undefined,
    afterSequence: Math.max(0, options.afterSequence ?? 0),
    timeoutMs:
      options.timeoutMs !== undefined
        ? clamp(options.timeoutMs, 0, 300_000)
        : undefined,
    batchWindowMs: clamp(
      options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS,
      0,
      10_000,
    ),
  };
}

function matchesWaiter(
  event: ReviewCompletedEvent,
  options: NormalizedWaitOptions,
): boolean {
  if (event.reviewId !== options.reviewId) return false;
  if (event.sequence <= options.afterSequence) return false;
  if (!options.documentPath) return true;
  return path.resolve(event.documentPath) === options.documentPath;
}

function resultForEvents(
  events: ReviewCompletedEvent[],
  timedOut: boolean,
  nextSequence: number,
): WaitForReviewEventsResult {
  return {
    events,
    timedOut,
    nextSequence,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
