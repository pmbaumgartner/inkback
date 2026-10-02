interface WatchReviewEventsOptions {
  serverUrl: string;
  projectPath: string;
  path: string;
  batchWindowSeconds: number;
  timeoutSeconds?: number;
  replay?: boolean;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
}

interface ReviewWatchResult {
  events?: unknown[];
  timedOut?: boolean;
  nextSequence?: number;
}

// Stay below both Node fetch's five-minute headers timeout and the server's
// five-minute wait limit. The overall review can still last indefinitely.
const POLL_SECONDS = 240;

export async function watchReviewEvents(
  options: WatchReviewEventsOptions,
): Promise<ReviewWatchResult> {
  if (
    options.timeoutSeconds !== undefined &&
    (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 0)
  ) {
    throw new Error("Review timeout must be a finite, non-negative number.");
  }
  const deadline =
    options.timeoutSeconds === undefined
      ? undefined
      : Date.now() + options.timeoutSeconds * 1000;
  let afterSequence: number | undefined;
  let lastResult: ReviewWatchResult | undefined;

  while (true) {
    options.signal?.throwIfAborted();
    const remainingSeconds =
      deadline === undefined
        ? Infinity
        : Math.max(0, (deadline - Date.now()) / 1000);
    if (lastResult && remainingSeconds === 0) return lastResult;
    const pollSeconds = Math.min(POLL_SECONDS, remainingSeconds);
    // A late event cancels the server's poll deadline and may batch for up to
    // ten seconds. Allow that window plus five seconds for the response.
    const requestTimeout = AbortSignal.timeout(
      Math.ceil((pollSeconds + 15) * 1000),
    );
    const response = await options.fetchImpl(
      new URL("/api/review-events/watch", options.serverUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: options.projectPath,
          path: options.path,
          batchWindowSeconds: options.batchWindowSeconds,
          timeoutSeconds: pollSeconds,
          fromNow: afterSequence === undefined && !options.replay,
          ...(afterSequence === undefined ? {} : { afterSequence }),
        }),
        signal: options.signal
          ? AbortSignal.any([options.signal, requestTimeout])
          : requestTimeout,
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to watch review events: ${response.status}`);
    }
    const result = (await response.json()) as ReviewWatchResult;
    options.signal?.throwIfAborted();
    if (!result.timedOut) return result;
    if (deadline !== undefined && Date.now() >= deadline) return result;

    // nextSequence is the next unassigned sequence, not the last seen event.
    // Never re-anchor fromNow: that would discard feedback sent between polls.
    const nextSequence = result.nextSequence;
    if (
      typeof nextSequence !== "number" ||
      !Number.isSafeInteger(nextSequence) ||
      nextSequence < 1 ||
      (afterSequence !== undefined && nextSequence <= afterSequence)
    ) {
      throw new Error(
        "NAME_PLACEHOLDER returned an invalid review cursor. Restart the review watch after checking that the server is up to date.",
      );
    }
    afterSequence = nextSequence - 1;
    lastResult = result;
  }
}
