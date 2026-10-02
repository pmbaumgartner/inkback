import { expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  createMarkdownProject,
  logE2eEvent,
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

    const watchResponse = await pendingWatch;
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
    request,
  }) => {
    const relativePath = "disconnected-handoff.md";
    const filePath = writeProjectFile(
      projectDir,
      relativePath,
      "# Review\n\nSaved feedback.\n",
    );
    pendingWatch = request.post("/api/review-events/watch", {
      data: { projectPath: projectDir, path: relativePath, timeoutSeconds: 5 },
    });

    await openMarkdownFile(page, filePath, "code");
    await expect(page.getByTestId("review-handoff-button")).toBeVisible();
    const disconnectedStatus = page.waitForResponse(
      async (response) =>
        response.url().includes("/api/review-events/status") &&
        (await response.json()).watcherCount === 0,
    );
    await pendingWatch;
    await disconnectedStatus;
    logE2eEvent("review-handoff.disconnected", {
      buttonVisible: await page
        .getByTestId("review-handoff-button")
        .isVisible(),
    });
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
    logE2eEvent("review-handoff.disconnected-completed", {
      status: await status.innerText(),
    });
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
    logE2eEvent("review-handoff.sent-button-reopened-status", {
      buttonLabel: await page.getByTestId("review-handoff-button").innerText(),
    });

    await pendingWatch;
  });
});
