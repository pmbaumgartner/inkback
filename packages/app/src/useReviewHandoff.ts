import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  DiskChangeState,
  DocumentSaveState,
} from "./DocumentSaveController";
import type {
  CompleteReviewOptions,
  CompleteReviewResult,
  ReviewWatchStatus,
  StorageBackend,
} from "./storage";
export type ReviewHandoffState =
  | "idle"
  | "notifying"
  | "notified"
  | "queued"
  | "received"
  | "cancelled"
  | "undelivered"
  | "error";
interface Handoff {
  phase: ReviewHandoffState;
  watcherCount: number;
  seen: boolean;
  disconnected: boolean;
}
type Action =
  | { type: "phase"; phase: ReviewHandoffState }
  | { type: "watch"; status: ReviewWatchStatus };
function transition(current: Handoff, action: Action): Handoff {
  if (action.type === "phase")
    return {
      ...current,
      phase: action.phase,
      disconnected: false,
      watcherCount:
        action.phase === "notified" || action.phase === "undelivered"
          ? 0
          : current.watcherCount,
    };
  const { watcherCount, state } = action.status;
  let phase = current.phase;
  if (
    phase !== "notifying" &&
    phase !== "received" &&
    phase !== "cancelled" &&
    (state === "queued" || state === "received" || state === "cancelled")
  )
    phase = state;
  else if (
    (phase === "undelivered" ||
      (phase === "notified" && current.disconnected)) &&
    watcherCount > 0
  )
    phase = "idle";
  return {
    phase,
    watcherCount,
    seen: current.seen || watcherCount > 0 || !!state,
    disconnected:
      phase === "notified" && (current.disconnected || watcherCount === 0),
  };
}
export function isReviewHandoffDisabled({
  saveState,
  documentDiskChangeState,
  reviewHandoffState,
}: {
  saveState: DocumentSaveState;
  documentDiskChangeState: DiskChangeState;
  reviewHandoffState: ReviewHandoffState;
}) {
  return (
    saveState === "error" ||
    documentDiskChangeState !== "clean" ||
    reviewHandoffState !== "idle"
  );
}
const labels: Record<ReviewHandoffState, string> = {
  idle: "Finish review",
  notifying: "Finishing",
  notified: "Finished",
  queued: "Finished",
  received: "Finished",
  cancelled: "Finished",
  undelivered: "Finished",
  error: "Could not finish",
};
export function getReviewHandoffButtonLabel({
  reviewHandoffState,
}: {
  reviewHandoffState: ReviewHandoffState;
}) {
  return labels[reviewHandoffState];
}
const presentation: Record<
  ReviewHandoffState,
  { title: string; body: string }
> = {
  idle: { title: "Review complete", body: "Your review is saved." },
  notifying: {
    title: "Finishing review",
    body: "Saving your latest edits and finishing the handoff.",
  },
  notified: {
    title: "Review complete",
    body: "Your review is saved. An agent was connected when you finished, but receipt has not been confirmed.",
  },
  queued: {
    title: "Waiting for Pi",
    body: "Your review is saved and queued for the Pi session that opened it. Receipt will be confirmed when that session accepts the feedback.",
  },
  received: {
    title: "Received by Pi",
    body: "Your review is saved. The Pi session that opened it has accepted the feedback.",
  },
  cancelled: {
    title: "Review cancelled",
    body: "Your edits remain saved. Pi stopped waiting for this review. Start a new review from Pi, or copy the message below.",
  },
  undelivered: {
    title: "Review saved",
    body: "Your review is saved. No agent was connected when you finished. If your agent does not resume, send it the message below.",
  },
  error: {
    title: "Could not finish review",
    body: "Inkback could not finish the handoff. Check the save status and that the local server is still running, then try again.",
  },
};
export function useReviewHandoff(
  backend: StorageBackend | null,
  path: string | null,
  complete: (options?: CompleteReviewOptions) => Promise<CompleteReviewResult>,
) {
  const [state, dispatch] = useReducer(transition, {
    phase: "idle",
    watcherCount: 0,
    seen: false,
    disconnected: false,
  });
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const ownGeneration = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!backend?.getReviewWatchStatus || !path) return;
      try {
        const status = await backend.getReviewWatchStatus(path);
        if (generation.current === ownGeneration)
          dispatch({ type: "watch", status });
      } catch {
        if (generation.current === ownGeneration)
          dispatch({
            type: "watch",
            status: { watching: false, watcherCount: 0 },
          });
      }
      if (generation.current === ownGeneration) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => {
      generation.current++;
      clearTimeout(timer);
    };
  }, [backend, path]);
  const finish = useCallback(
    async (options?: CompleteReviewOptions) => {
      if (!path || busy.current) return null;
      busy.current = true;
      const ownGeneration = generation.current;
      dispatch({ type: "phase", phase: "notifying" });
      try {
        const result = await complete(options);
        if (ownGeneration !== generation.current) return null;
        dispatch({
          type: "phase",
          phase:
            result.state === "queued" || result.state === "received"
              ? result.state
              : result.delivered
                ? "notified"
                : "undelivered",
        });
        return "completed" as const;
      } catch (error) {
        if (ownGeneration !== generation.current) return null;
        console.error("Failed to complete review:", error);
        dispatch({ type: "phase", phase: "error" });
        return "failed" as const;
      } finally {
        busy.current = false;
      }
    },
    [complete, path],
  );
  const conversation = backend?.reviewDelivery === "conversation";
  const view =
    conversation && state.phase === "received"
      ? { title: "Sent", body: "Sent. You can close this view." }
      : presentation[state.phase];
  return {
    phase: state.phase,
    visible: !!path && (state.seen || state.phase !== "idle"),
    conversation,
    view,
    finish,
  };
}
