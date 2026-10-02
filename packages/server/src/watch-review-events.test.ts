import { afterEach, describe, expect, it, vi } from "vitest";
import { watchReviewEvents } from "./watch-review-events";

const target = {
  serverUrl: "http://localhost:7373",
  projectPath: "/project",
  path: "draft.md",
  batchWindowSeconds: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("review watch polling", () => {
  it("allows feedback arriving near the poll deadline to finish its batch window", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    const event = { sequence: 1, type: "review.completed" };
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
        // A matching event cancels the server's poll deadline while it batches.
        setTimeout(
          () =>
            resolve(
              Response.json({
                events: [event],
                timedOut: false,
                nextSequence: 2,
              }),
            ),
          (body.timeoutSeconds + body.batchWindowSeconds) * 1000 - 1,
        );
      });
    };
    const result = expect(
      watchReviewEvents({
        ...target,
        batchWindowSeconds: 10,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ events: [event] });
    await Promise.all([vi.advanceTimersByTimeAsync(250_000), result]);
  });

  it("honors the total deadline across multiple bounded polls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const waits: number[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const { timeoutSeconds } = JSON.parse(String(init?.body));
      waits.push(timeoutSeconds);
      // Simulate elapsed server waits without spending minutes in the test.
      vi.setSystemTime(Date.now() + timeoutSeconds * 1000);
      return Response.json({ events: [], timedOut: true, nextSequence: 1 });
    };

    const result = await watchReviewEvents({
      ...target,
      timeoutSeconds: 601.25,
      fetchImpl,
    });

    expect(result.timedOut).toBe(true);
    expect(waits.length).toBeGreaterThan(1);
    expect(waits.every((seconds) => seconds > 0 && seconds < 300)).toBe(true);
    expect(waits.reduce((sum, seconds) => sum + seconds, 0)).toBe(601.25);
  });

  it("preserves replay semantics on the first request", async () => {
    const event = { sequence: 1, type: "review.completed" };
    const fetchImpl: typeof fetch = async (_input, init) => {
      const { fromNow, afterSequence = 0 } = JSON.parse(String(init?.body));
      return Response.json({
        events: !fromNow && afterSequence === 0 ? [event] : [],
        timedOut: false,
        nextSequence: 2,
      });
    };

    expect(
      await watchReviewEvents({ ...target, replay: true, fetchImpl }),
    ).toMatchObject({ events: [event] });
  });

  it.each([
    undefined,
    -1,
    1.5,
    "2",
  ])("rejects an unusable continuation cursor %s instead of losing feedback", async (nextSequence) => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ events: [], timedOut: true, nextSequence });
    await expect(watchReviewEvents({ ...target, fetchImpl })).rejects.toThrow(
      "invalid review cursor",
    );
  });

  it("stops if a restarted server moves its cursor backwards", async () => {
    const cursors = [8, 1];
    const fetchImpl: typeof fetch = async () =>
      Response.json({
        events: [],
        timedOut: true,
        nextSequence: cursors.shift(),
      });
    await expect(watchReviewEvents({ ...target, fetchImpl })).rejects.toThrow(
      "invalid review cursor",
    );
  });

  it("aborts an active poll and never starts another after cancellation", async () => {
    const cancellation = new AbortController();
    let requests = 0;
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests += 1;
      requestSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () =>
          reject(requestSignal?.reason),
        );
      });
    };
    const watching = watchReviewEvents({
      ...target,
      fetchImpl,
      signal: cancellation.signal,
    });
    cancellation.abort();

    await expect(watching).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
    expect(requests).toBe(1);
  });
});
