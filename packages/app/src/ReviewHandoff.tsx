import { AlertTriangle, CheckCheck, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import { Textarea } from "./components/ui/textarea";
import type {
  DiskChangeState,
  DocumentSaveState,
} from "./DocumentSaveController";
import { cn } from "./lib/utils";
import { copyHostText } from "./mcp-app/host-bridge";
import type {
  CompleteReviewOptions,
  CompleteReviewResult,
  StorageBackend,
} from "./storage";
import {
  getReviewHandoffButtonLabel,
  isReviewHandoffDisabled,
  useReviewHandoff,
} from "./useReviewHandoff";

interface Props {
  backend: StorageBackend | null;
  activeDocumentPath: string | null;
  documentFilenameLabel: string;
  saveState: DocumentSaveState;
  documentDiskChangeState: DiskChangeState;
  onCompleteReview: (
    options?: CompleteReviewOptions,
  ) => Promise<CompleteReviewResult>;
  onPrepareReview?: (options?: CompleteReviewOptions) => Promise<string>;
}
export function ReviewHandoff({
  backend,
  activeDocumentPath,
  documentFilenameLabel,
  saveState,
  documentDiskChangeState,
  onCompleteReview,
  onPrepareReview,
}: Props) {
  const handoff = useReviewHandoff(
    backend,
    activeDocumentPath,
    onCompleteReview,
  );
  const reviewHandoffState = handoff.phase;
  const mcpApp = handoff.conversation;
  const [reviewHandoffPopoverOpen, setReviewHandoffPopoverOpen] =
    useState(false);
  const [overallComment, setOverallComment] = useState("");
  const [preparedMessage, setPreparedMessage] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handleCompleteReview = async (options?: CompleteReviewOptions) => {
    const result = await handoff.finish(options);
    if (result === "completed") setOverallComment("");
    if (result) setReviewHandoffPopoverOpen(true);
  };
  const reviewHandoffButtonLabel = getReviewHandoffButtonLabel({
    reviewHandoffState,
  });
  const ReviewHandoffButtonIcon =
    reviewHandoffState === "notifying"
      ? Loader2
      : reviewHandoffState === "error" || reviewHandoffState === "undelivered"
        ? AlertTriangle
        : null;
  const reviewHandoffStatusTitle = handoff.view.title;
  const reviewHandoffStatusBody = handoff.view.body;
  const reviewHandoffCopyMessage =
    backend?.handoffMessage ??
    `I am done reviewing this file: ${activeDocumentPath ?? documentFilenameLabel}`;
  const reviewHandoffDisabled = isReviewHandoffDisabled({
    saveState,
    documentDiskChangeState,
    reviewHandoffState,
  });
  const reviewHandoffButtonDisabled =
    reviewHandoffDisabled &&
    (reviewHandoffState === "idle" || reviewHandoffState === "notifying");
  const trimmedOverallComment = overallComment.trim();
  if (!handoff.visible) return null;
  return (
    <Popover
      open={reviewHandoffPopoverOpen}
      onOpenChange={setReviewHandoffPopoverOpen}
    >
      <div
        data-testid="review-handoff-split-button"
        className={cn(
          "relative flex items-center overflow-hidden rounded-[7px] shadow-[0_10px_28px_rgba(0,0,0,0.18)] transition-opacity after:pointer-events-none after:absolute after:top-px after:right-8 after:bottom-px after:z-10 after:w-px after:bg-[#4a4038] after:content-[''] dark:after:bg-slate-600",
          reviewHandoffDisabled && "opacity-50",
        )}
      >
        <Button
          type="button"
          data-testid="review-handoff-button"
          size="lg"
          className="h-9 rounded-r-none rounded-l-[7px] border-0 bg-[#2B2420] px-3 text-sm font-bold text-white hover:bg-[#3a322b] focus-visible:ring-slate-300 disabled:opacity-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 dark:focus-visible:ring-slate-600"
          disabled={reviewHandoffButtonDisabled}
          aria-disabled={reviewHandoffButtonDisabled || undefined}
          onClick={() => {
            if (mcpApp || reviewHandoffState !== "idle") {
              setReviewHandoffPopoverOpen(true);
              return;
            }

            void handleCompleteReview(
              trimmedOverallComment
                ? { overallComment: trimmedOverallComment }
                : undefined,
            );
          }}
        >
          {ReviewHandoffButtonIcon ? (
            <ReviewHandoffButtonIcon
              className={cn(
                "size-4",
                reviewHandoffState === "notifying" && "animate-spin",
              )}
            />
          ) : null}
          {reviewHandoffButtonLabel}
        </Button>
        <PopoverTrigger
          render={
            <Button
              type="button"
              data-testid="review-handoff-comment-trigger"
              size="icon-lg"
              className="h-9 w-8 rounded-l-none rounded-r-[7px] border-0 bg-[#2B2420] text-white hover:bg-[#3a322b] focus-visible:ring-slate-300 disabled:opacity-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 dark:focus-visible:ring-slate-600"
              disabled={reviewHandoffDisabled}
              aria-label="Add overall handoff comment"
            >
              <ChevronDown className="size-4" />
            </Button>
          }
        />
      </div>
      <PopoverContent
        className={reviewHandoffState === "idle" ? undefined : "pt-0"}
        aria-label={
          reviewHandoffState === "idle"
            ? "Review handoff comment"
            : "Review handoff status"
        }
        data-testid={
          reviewHandoffState === "idle"
            ? "review-handoff-comment-popover"
            : "review-handoff-status"
        }
      >
        {reviewHandoffState === "idle" ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (onPrepareReview && !preparedMessage) {
                setPrepareError(null);
                void onPrepareReview({
                  overallComment: trimmedOverallComment,
                })
                  .then((message) => {
                    if (mounted.current) setPreparedMessage(message);
                  })
                  .catch((error) => {
                    if (mounted.current) setPrepareError(String(error));
                  });
              } else {
                void handleCompleteReview({
                  overallComment: trimmedOverallComment,
                });
              }
            }}
          >
            <div>
              <Textarea
                id="review-handoff-overall-comment"
                data-testid="review-handoff-overall-comment"
                aria-label="Overall comment"
                placeholder="Overall comment"
                value={overallComment}
                disabled={!!preparedMessage}
                onChange={(event) => {
                  setOverallComment(event.currentTarget.value);
                  setPreparedMessage(null);
                }}
                maxLength={4000}
                rows={4}
                className="min-h-24 resize-none"
              />
            </div>
            {preparedMessage && (
              <Textarea
                aria-label="Message preview"
                readOnly
                value={preparedMessage}
                rows={10}
              />
            )}
            {prepareError && <p role="alert">{prepareError}</p>}
            <Button
              type="submit"
              data-testid="review-handoff-submit-comment"
              size="lg"
              className="w-full rounded-[7px] bg-black text-sm font-bold text-white hover:bg-black/85 focus-visible:ring-black/25 dark:bg-white dark:text-black dark:hover:bg-white/90"
              disabled={!mcpApp && !trimmedOverallComment}
            >
              <CheckCheck className="size-4" />
              {mcpApp
                ? preparedMessage
                  ? "Send to conversation"
                  : "Preview message"
                : "Submit with comment"}
            </Button>
          </form>
        ) : (
          <div>
            <div className="flex items-start gap-3">
              {reviewHandoffState === "notifying" ||
              reviewHandoffState === "error" ||
              reviewHandoffState === "undelivered" ? (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black">
                  {reviewHandoffState === "notifying" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="size-4" />
                  )}
                </span>
              ) : null}
              <div>
                <div className="text-xl font-semibold leading-6 text-stone-950 dark:text-slate-50">
                  {reviewHandoffStatusTitle}
                </div>
                <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-slate-300">
                  {reviewHandoffStatusBody}
                </p>
                {reviewHandoffState === "error" ? (
                  <Button
                    type="button"
                    data-testid="review-handoff-retry"
                    className="mt-4 w-full"
                    onClick={() =>
                      void handleCompleteReview(
                        trimmedOverallComment
                          ? { overallComment: trimmedOverallComment }
                          : undefined,
                      )
                    }
                  >
                    Try again
                  </Button>
                ) : reviewHandoffState === "notifying" ? null : (
                  <div className="mt-3">
                    <Button
                      type="button"
                      data-testid="review-handoff-copy-message"
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        void (
                          mcpApp
                            ? copyHostText
                            : navigator.clipboard.writeText.bind(
                                navigator.clipboard,
                              )
                        )(reviewHandoffCopyMessage)
                      }
                    >
                      Copy message for agent
                    </Button>
                    {!mcpApp && (
                      <Button
                        type="button"
                        data-testid="review-handoff-close-window"
                        size="lg"
                        variant="outline"
                        className="mt-4 w-full rounded-[7px] text-sm font-semibold"
                        onClick={() => window.close()}
                      >
                        Close window
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
