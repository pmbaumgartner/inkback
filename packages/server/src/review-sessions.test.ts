import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index.js";

describe("review session receipts", () => {
  let projectDir: string;
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-receipts-"));
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Draft\n");
    app = createApp({
      projectDir,
      homeDir: projectDir,
      staticDirPath: projectDir,
    }).app;
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function createSession(): Promise<{
    reviewId: string;
    receiptToken: string;
  }> {
    const response = await request(app)
      .post("/api/review-sessions")
      .send({ projectPath: projectDir, path: "draft.md" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      reviewId: expect.any(String),
      receiptToken: expect.any(String),
      state: "waiting",
    });
    return response.body;
  }

  async function status(reviewId: string) {
    const response = await request(app)
      .get("/api/review-events/status")
      .query({ projectPath: projectDir, path: "draft.md", reviewId });
    expect(response.status).toBe(200);
    return response.body;
  }

  it("reports queued feedback until its consumer acknowledges the received sequence", async () => {
    const { reviewId, receiptToken } = await createSession();
    const target = { projectPath: projectDir, path: "draft.md", reviewId };
    const waiting = request(app)
      .post("/api/review-events/watch")
      .send({ ...target, timeoutSeconds: 2, batchWindowSeconds: 0 })
      .then((response) => response);
    try {
      await expect
        .poll(() => status(reviewId))
        .toMatchObject({ watching: true });
      const completed = await request(app)
        .post("/api/review-events")
        .send(target);
      expect(completed.status).toBe(201);
      const feedback = await waiting;
      expect(feedback.status).toBe(200);
      expect(feedback.body.events).toHaveLength(1);
      const sequence = feedback.body.events[0].sequence;
      expect(sequence).toEqual(expect.any(Number));
      const defaultWatch = await request(app)
        .post("/api/review-events/watch")
        .send({ ...target, timeoutSeconds: 0 });
      expect(defaultWatch.body).toMatchObject({
        events: [{ sequence, reviewId }],
        timedOut: false,
      });
      const late = await request(app)
        .post("/api/review-events/watch")
        .send({ ...target, timeoutSeconds: 0, afterSequence: sequence });
      expect(late.status).toBe(200);
      expect(late.body).toMatchObject({
        events: [{ sequence, reviewId }],
        timedOut: false,
      });

      // Returning the event to an attached watcher is not proof of receipt.
      expect(await status(reviewId)).toMatchObject({
        reviewId,
        state: "queued",
      });
      const acknowledged = await request(app)
        .post(`/api/review-sessions/${reviewId}/ack`)
        .set("x-inkback-receipt-token", receiptToken)
        .send({ sequence });
      expect(acknowledged.status).toBe(200);
      expect(await status(reviewId)).toMatchObject({
        reviewId,
        state: "received",
      });
      const afterAck = await request(app)
        .post("/api/review-events/watch")
        .send({ ...target, timeoutSeconds: 0 });
      expect(afterAck.status).toBe(200);
      expect(afterAck.body).toMatchObject({ events: [], timedOut: true });
    } finally {
      await waiting;
    }
  });

  it("does not duplicate persisted overall comments when completion is retried", async () => {
    const { reviewId } = await createSession();
    const target = {
      projectPath: projectDir,
      path: "draft.md",
      reviewId,
      overallComment: "Clarify the example.",
    };
    const first = await request(app).post("/api/review-events").send(target);
    const retry = await request(app).post("/api/review-events").send(target);
    expect(first.status).toBe(201);
    expect(retry.body.event.sequence).toBe(first.body.event.sequence);
    const index = await request(app)
      .get("/api/review-index")
      .query({ projectPath: projectDir, path: "draft.md" });
    expect(index.body.summary.comments).toBe(1);
  });

  it("rejects unauthenticated receipts, wrong sequences, and completion after cancellation", async () => {
    const { reviewId, receiptToken } = await createSession();
    const completed = await request(app)
      .post("/api/review-events")
      .send({ projectPath: projectDir, path: "draft.md", reviewId });
    expect(
      (
        await request(app)
          .post(`/api/review-sessions/${reviewId}/ack`)
          .send({ sequence: completed.body.event.sequence })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/review-sessions/${reviewId}/ack`)
          .set("x-inkback-receipt-token", receiptToken)
          .send({ sequence: completed.body.event.sequence + 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .delete(`/api/review-sessions/${reviewId}`)
          .set("x-inkback-receipt-token", receiptToken)
      ).status,
    ).toBe(200);
    expect(await status(reviewId)).toMatchObject({
      state: "cancelled",
      watcherCount: 0,
    });
    const before = fs.readFileSync(path.join(projectDir, "draft.md"), "utf8");
    const late = await request(app).post("/api/review-events").send({
      projectPath: projectDir,
      path: "draft.md",
      reviewId,
      overallComment: "Late feedback",
    });
    expect(late.status).toBe(410);
    expect(fs.readFileSync(path.join(projectDir, "draft.md"), "utf8")).toBe(
      before,
    );
  });

  it("keeps one session's feedback out of another session and legacy watchers on the same file", async () => {
    const sessionA = await createSession();
    const sessionB = await createSession();
    expect(sessionA.reviewId).not.toBe(sessionB.reviewId);
    const target = { projectPath: projectDir, path: "draft.md" };
    const completed = await request(app)
      .post("/api/review-events")
      .send({ ...target, reviewId: sessionA.reviewId });
    expect(completed.status).toBe(201);

    const watch = (reviewId?: string) =>
      request(app)
        .post("/api/review-events/watch")
        .send({
          ...target,
          ...(reviewId ? { reviewId } : {}),
          fromNow: false,
          timeoutSeconds: 0,
          batchWindowSeconds: 0,
        });
    const matching = await watch(sessionA.reviewId);
    expect(matching.status).toBe(200);
    expect(matching.body.events).toHaveLength(1);
    expect(matching.body.events[0]).toMatchObject({
      reviewId: sessionA.reviewId,
    });
    for (const reviewId of [sessionB.reviewId, undefined]) {
      const unrelated = await watch(reviewId);
      expect(unrelated.status).toBe(200);
      expect(unrelated.body).toMatchObject({ events: [], timedOut: true });
    }
  });
});
