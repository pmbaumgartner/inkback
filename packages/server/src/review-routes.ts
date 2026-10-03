import fs from "node:fs";
import {
  appendInkbackDocumentComment,
  extractInkbackReviewIndex,
} from "@inkback/rfm";
import type { Express, Request, Response } from "express";
import {
  fileVersionFromFile,
  MAX_OVERALL_COMMENT_LENGTH,
  normalizeOverallComment,
  updateDocument,
} from "./document-files.js";
import { markdownPathFromRequest } from "./http-document-target.js";
import { ReviewEventQueue } from "./review-events.js";
import { type ReviewSession, ReviewSessions } from "./review-sessions.js";
export function registerReviewRoutes(app: Express) {
  const reviewEvents = new ReviewEventQueue();
  const reviewSessions = new ReviewSessions();
  function requestedReviewSession(
    req: Request,
    res: Response,
    documentPath: string,
  ): ReviewSession | undefined | false {
    const id = req.body?.reviewId ?? req.query.reviewId;
    if (id === undefined) return undefined;
    const session = typeof id === "string" ? reviewSessions.get(id) : undefined;
    if (!session || session.documentPath !== documentPath) {
      res
        .status(404)
        .json({ error: "Review session not found for this document" });
      return false;
    }
    return session;
  }

  app.post("/api/review-sessions", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;
    const session = reviewSessions.create(target.absolutePath);
    if (!session) {
      res.status(503).json({
        error: "Too many active reviews; cancel an unused review first",
      });
      return;
    }
    res.status(201).json({
      reviewId: session.reviewId,
      receiptToken: session.receiptToken,
      state: session.state,
    });
  });

  function receiptSession(
    req: Request,
    res: Response,
  ): ReviewSession | undefined {
    const session = reviewSessions.get(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: "Review session not found" });
      return;
    }
    if (req.get("x-inkback-receipt-token") !== session.receiptToken) {
      res.status(403).json({ error: "Review receipt token required" });
      return;
    }
    return session;
  }

  app.post("/api/review-sessions/:id/ack", (req, res) => {
    const session = receiptSession(req, res);
    if (!session) return;
    if (!reviewSessions.acknowledge(session, req.body?.sequence)) {
      res
        .status(409)
        .json({ error: "No matching pending review to acknowledge" });
      return;
    }
    res.json({ reviewId: session.reviewId, state: session.state });
  });

  app.delete("/api/review-sessions/:id", (req, res) => {
    const session = receiptSession(req, res);
    if (!session) return;
    reviewSessions.cancel(session);
    res.json({ reviewId: session.reviewId, state: session.state });
  });

  app.post("/api/review-events", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;
    const session = requestedReviewSession(req, res, target.absolutePath);
    if (session === false) return;
    if (session?.state === "cancelled") {
      res.status(410).json({
        error: "This review was cancelled. Reopen from the waiting agent.",
      });
      return;
    }
    // A browser retry must not append the overall comment or enqueue it twice.
    if (session?.completion) {
      res.status(201).json({
        ...session.completion,
        reviewId: session.reviewId,
        state: session.state,
      });
      return;
    }

    const overallComment = normalizeOverallComment(req.body?.overallComment);
    if (
      overallComment !== undefined &&
      overallComment.length > MAX_OVERALL_COMMENT_LENGTH
    ) {
      res.status(400).json({
        error: `overallComment must be ${MAX_OVERALL_COMMENT_LENGTH} characters or fewer`,
      });
      return;
    }

    const markdown = fs.readFileSync(target.absolutePath, "utf-8");
    const persistedMarkdown = overallComment
      ? appendInkbackDocumentComment(markdown, {
          message: overallComment,
          author: "user",
        })
      : markdown;
    if (persistedMarkdown !== markdown) {
      updateDocument(
        target.absolutePath,
        () => persistedMarkdown,
        undefined,
        Infinity,
      );
    }

    const index = extractInkbackReviewIndex(persistedMarkdown);
    const result = reviewEvents.emit({
      ...(session ? { reviewId: session.reviewId } : {}),
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      version: fileVersionFromFile(target.absolutePath),
      summary: index.summary,
      overallComment,
    });

    if (session) {
      reviewSessions.complete(session, result);
    }
    res.status(201).json({
      ...result,
      ...(session ? { reviewId: session.reviewId, state: session.state } : {}),
    });
  });

  app.post("/api/review-events/watch", async (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;
    const session = requestedReviewSession(req, res, target.absolutePath);
    if (session === false) return;
    if (session?.state === "cancelled") {
      res.status(410).json({ error: "Review cancelled" });
      return;
    }

    const fromNow = req.body?.fromNow !== false;
    const timeoutSeconds =
      typeof req.body?.timeoutSeconds === "number"
        ? req.body.timeoutSeconds
        : undefined;
    const batchWindowSeconds =
      typeof req.body?.batchWindowSeconds === "number"
        ? req.body.batchWindowSeconds
        : 0.25;
    const afterSequence =
      typeof req.body?.afterSequence === "number" ? req.body.afterSequence : 0;
    const cursor = fromNow ? reviewEvents.latestSequence() : afterSequence;
    if (session?.completion && session.completion.event.sequence > cursor) {
      res.json({
        events: [session.completion.event],
        timedOut: false,
        nextSequence: reviewEvents.latestSequence() + 1,
      });
      return;
    }

    const controller = new AbortController();
    const onClose = () => controller.abort();
    // The incoming request body has already ended; the response connection
    // remains open for the long poll and closes when the caller disconnects.
    res.once("close", onClose);
    if (res.destroyed) controller.abort();
    try {
      const result = await reviewEvents.wait({
        reviewId: session?.reviewId,
        documentPath: target.absolutePath,
        afterSequence: cursor,
        timeoutMs:
          timeoutSeconds !== undefined ? timeoutSeconds * 1000 : undefined,
        batchWindowMs: batchWindowSeconds * 1000,
        signal: session
          ? AbortSignal.any([controller.signal, session.controller.signal])
          : controller.signal,
      });

      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (session?.controller.signal.aborted && !controller.signal.aborted)
        res.status(410).json({ error: "Review cancelled" });
      else if (!controller.signal.aborted) throw error;
    } finally {
      res.off("close", onClose);
    }
  });

  app.get("/api/review-events/status", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;
    const session = requestedReviewSession(req, res, target.absolutePath);
    if (session === false) return;

    const watcherCount = reviewEvents.waiterCountForDocument(
      target.absolutePath,
      session?.reviewId,
    );
    res.json({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      watching: watcherCount > 0,
      watcherCount,
      ...(session ? { reviewId: session.reviewId, state: session.state } : {}),
    });
  });
}
