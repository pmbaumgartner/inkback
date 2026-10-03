import { type APIResponse, expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  createMarkdownProject,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("review handoff", () => {
  let projectDir: string;
  let pendingWatch: Promise<unknown> | null = null;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("review-handoff");
    pendingWatch = null;
  });

  test.afterEach(async () => {
    await pendingWatch?.catch(() => undefined);
    removeMarkdownProject(projectDir);
  });

  for (const terminal of ["received", "cancelled"] as const) {
    test(`shows queued feedback until its Pi session is ${terminal} @smoke`, async ({
      page,
      request,
    }) => {
      const relativePath = "scoped-review.md";
      const filePath = writeProjectFile(
        projectDir,
        relativePath,
        "# Scoped review\n\nSaved text.\n",
      );
      const created = await request.post("/api/review-sessions", {
        data: { projectPath: projectDir, path: relativePath },
      });
      expect(created.status()).toBe(201);
      const { reviewId, receiptToken } = await created.json();
      await page.goto(
        `/?${new URLSearchParams({ path: filePath, editor: "code", reviewId })}`,
      );
      await expect(page.getByTestId("review-handoff-button")).toBeVisible();
      await appendInCodeEditor(page, "\nHuman edit before handoff.");
      await page.getByTestId("review-handoff-button").click();
      const status = page.getByTestId("review-handoff-status");
      await expect(status).toContainText("Waiting for Pi");
      await expect(status).not.toContainText("Received by Pi");
      expect(readProjectFile(projectDir, relativePath)).toContain(
        "Human edit before handoff.",
      );
      if (terminal === "received") {
        const completed = await request.post("/api/review-events/watch", {
          data: {
            projectPath: projectDir,
            path: relativePath,
            reviewId,
            fromNow: false,
            timeoutSeconds: 0,
            batchWindowSeconds: 0,
          },
        });
        const { events } = await completed.json();
        expect(events).toHaveLength(1);
        const acknowledged = await request.post(
          `/api/review-sessions/${reviewId}/ack`,
          {
            headers: { "x-inkback-receipt-token": receiptToken },
            data: { sequence: events[0].sequence },
          },
        );
        expect(acknowledged.status()).toBe(200);
        await expect(status).toContainText("Received by Pi");
      } else {
        const cancelled = await request.delete(
          `/api/review-sessions/${reviewId}`,
          { headers: { "x-inkback-receipt-token": receiptToken } },
        );
        expect(cancelled.status()).toBe(200);
        await expect(status).toContainText("Review cancelled");
        await expect(
          status.getByTestId("review-handoff-copy-message"),
        ).toBeVisible();
      }
    });
  }

  test("persists an overall handoff comment from the primary done button to YAML endmatter @smoke", async ({
    page,
    request,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "handoff-comment.md",
      ["# Handoff Comment", "", "Review this document.", ""].join("\n"),
    );
    const relativePath = "handoff-comment.md";
    const overallComment = "Please prioritize the CLI contract.";

    pendingWatch = request.post("/api/review-events/watch", {
      data: {
        projectPath: projectDir,
        path: relativePath,
        timeoutSeconds: 10,
      },
    });

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("review-handoff-button")).toBeVisible();

    await page.getByTestId("review-handoff-comment-trigger").click();
    await page
      .getByTestId("review-handoff-overall-comment")
      .fill(overallComment);
    await page.getByTestId("review-handoff-button").click();

    await expect(page.getByTestId("review-handoff-status")).toContainText(
      "receipt has not been confirmed",
    );

    await expect
      .poll(() => readProjectFile(projectDir, relativePath))
      .toMatch(
        /---\ncomments:\n {2}c1:\n {4}body: Please prioritize the CLI contract\.\n {4}by: user\n {4}at: [^\n]+\n?$/,
      );

    const watchResponse = (await pendingWatch) as APIResponse;
    const payload = await watchResponse.json();
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      type: "review.completed",
      overallComment,
      summary: {
        comments: 1,
      },
    });
  });

  test("keeps review completion available after the watcher disconnects @smoke", async ({
    page,
  }, testInfo) => {
    const relativePath = "disconnected-handoff.md";
    const filePath = writeProjectFile(
      projectDir,
      relativePath,
      "# Review\n\nSaved feedback.\n",
    );
    const watcher = new AbortController();
    pendingWatch = fetch(
      new URL("/api/review-events/watch", testInfo.project.use.baseURL),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: projectDir,
          path: relativePath,
          timeoutSeconds: 25,
        }),
        signal: watcher.signal,
      },
    );
    // Handle cancellation immediately, then disconnect once the UI sees the watcher.
    void pendingWatch.catch(() => undefined);
    try {
      await openMarkdownFile(page, filePath, "code");
      await expect(page.getByTestId("review-handoff-button")).toBeVisible();
      const disconnectedStatus = page.waitForResponse(
        async (response) =>
          response.url().includes("/api/review-events/status") &&
          (await response.json()).watcherCount === 0,
      );
      watcher.abort();
      await pendingWatch.catch(() => undefined);
      pendingWatch = null;
      await disconnectedStatus;

      await expect(page.getByTestId("review-handoff-button")).toBeVisible();
      await appendInCodeEditor(page, "\nPending feedback.");
      await expect(page.getByTestId("review-handoff-button")).toHaveText(
        "Finish review",
      );
      await page.getByTestId("review-handoff-button").click();

      const status = page.getByTestId("review-handoff-status");
      await expect(status).toContainText("Your review is saved");
      expect(readProjectFile(projectDir, relativePath)).toContain(
        "Pending feedback.",
      );
      await expect(status).toContainText("No agent was connected");
      await expect(
        status.getByTestId("review-handoff-copy-message"),
      ).toBeVisible();
    } finally {
      watcher.abort();
      pendingWatch = null;
    }
  });

  test("reopens the sent handoff status from the muted primary button", async ({
    page,
    request,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "sent-handoff.md",
      ["# Sent Handoff", "", "Review already completed.", ""].join("\n"),
    );
    const relativePath = "sent-handoff.md";

    pendingWatch = request.post("/api/review-events/watch", {
      data: {
        projectPath: projectDir,
        path: relativePath,
        timeoutSeconds: 10,
      },
    });

    await openMarkdownFile(page, filePath);
    await page.getByTestId("review-handoff-button").click();

    await expect(page.getByTestId("review-handoff-button")).toHaveText(
      "Finished",
    );
    await expect(page.getByTestId("review-handoff-status")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("review-handoff-status")).toBeHidden();

    await page.getByTestId("review-handoff-button").click();

    await expect(page.getByTestId("review-handoff-status")).toBeVisible();

    await pendingWatch;
  });
});
