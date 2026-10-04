import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { expect, type Page, test } from "@playwright/test";

const directory = path.join(os.tmpdir(), "inkback-mcp-e2e");
async function openReview(page: Page, documentPath: string) {
  await page.goto("http://localhost:8080");
  await expect(
    page.getByRole("combobox", { name: "Server", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Input", exact: true })
    .fill(JSON.stringify({ documentPath }));
  await page.getByRole("button", { name: "Call Tool", exact: true }).click();
  const app = page.frameLocator("iframe").frameLocator("iframe");
  await expect(app.getByTestId("mcp-inline-card")).toBeVisible();
  await app.getByRole("button", { name: "Open review", exact: true }).click();
  await expect(app.locator(".tiptap")).toBeVisible();
  return app;
}
test("@smoke MCP App saves, receives model feedback, and sends one review message", async ({
  page,
}) => {
  fs.mkdirSync(directory, { recursive: true });
  const documentPath = path.join(directory, `review-${crypto.randomUUID()}.md`);
  fs.writeFileSync(
    documentPath,
    "# MCP Review\n\n{==A sentence to review.==}{>>Please clarify this.<<}{#c1}\n",
  );
  const client = new Client({ name: "mcp-browser-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:4320/mcp")),
  );
  try {
    const app = await openReview(page, documentPath);
    await expect(
      app.getByText("Please clarify this.", { exact: true }),
    ).toBeVisible();
    await app.getByTestId("review-handoff-button").click();
    await app
      .getByRole("textbox", { name: "Overall comment", exact: true })
      .fill("Prioritize the evidence.");
    await app
      .getByRole("button", { name: "Preview message", exact: true })
      .click();
    const preview = app.getByRole("textbox", {
      name: "Message preview",
      exact: true,
    });
    await expect(preview).toHaveValue(/Inkback review finished:/);
    expect(fs.readFileSync(documentPath, "utf8")).toContain(
      "Prioritize the evidence.",
    );
    const read = await client.callTool({
      name: "inkback_get_review_index",
      arguments: { documentPath },
    });
    const version = (read.structuredContent as { fileVersion: string })
      .fileVersion;
    const reply = await client.callTool({
      name: "inkback_reply_to_comment",
      arguments: {
        documentPath,
        parentId: "c1",
        message: "Added the evidence.",
        expectedVersion: version,
      },
    });
    expect(reply.isError).not.toBe(true);
    await expect(
      app.getByText("Added the evidence.", { exact: true }),
    ).toBeVisible();
    await app
      .getByRole("button", { name: "Send to conversation", exact: true })
      .click();
    await expect(
      app.getByText("Sent. You can close this view.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1 message", { exact: true })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await app
      .getByRole("button", { name: "Back to summary", exact: true })
      .click();
    await expect(page.getByText("1 message", { exact: true })).toBeVisible();
    await page.screenshot({
      path: "test-results/mcp-review.png",
      fullPage: true,
    });
  } finally {
    await client.close();
    fs.rmSync(documentPath, { force: true });
  }
});
test("@smoke unsafe Markdown stays inert in the browser editor and MCP sandbox", async ({
  page,
}) => {
  fs.mkdirSync(directory, { recursive: true });
  const documentPath = path.join(directory, `unsafe-${crypto.randomUUID()}.md`);
  fs.copyFileSync(
    new URL("../test/fixtures/markdown/unsafe-html.md", import.meta.url),
    documentPath,
  );
  try {
    await page.goto(`/?path=${encodeURIComponent(documentPath)}`);
    await expect(page.locator(".tiptap")).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
      ),
    ).toBeUndefined();
    await page.locator(".tiptap").getByText("click", { exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
      ),
    ).toBeUndefined();
    await page
      .getByRole("button", { name: "Switch to code view", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Switch to rich text view", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
      ),
    ).toBeUndefined();
    const app = await openReview(page, documentPath);
    await app
      .getByRole("button", { name: "Switch to code view", exact: true })
      .click();
    await app
      .getByRole("button", { name: "Switch to rich text view", exact: true })
      .click();
    const frame = page
      .frames()
      .find((frame) => frame.parentFrame()?.parentFrame() === page.mainFrame());
    expect(frame).toBeDefined();
    expect(
      await frame?.evaluate(
        () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
      ),
    ).toBeUndefined();
    await app.locator(".tiptap").getByText("click", { exact: true }).click();
    expect(
      await frame?.evaluate(
        () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
      ),
    ).toBeUndefined();
  } finally {
    fs.rmSync(documentPath, { force: true });
  }
});

test("MCP App keeps files outside writable directories read-only while allowing a handoff", async ({
  page,
}) => {
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "inkback-mcp-readonly-"),
  );
  const documentPath = path.join(outside, "draft.md");
  const content = "# Read-only\n\n{>>Existing comment<<}{#c1}\n";
  fs.writeFileSync(documentPath, content);
  try {
    const app = await openReview(page, documentPath);
    await expect(
      app.getByRole("status").filter({ hasText: "Read-only:" }),
    ).toBeVisible();
    await expect(app.locator(".tiptap")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(
      app.getByRole("combobox", { name: "Document mode", exact: true }),
    ).toBeDisabled();
    await app.getByTestId("review-handoff-button").click();
    await app
      .getByRole("textbox", { name: "Overall comment", exact: true })
      .fill("Only a message.");
    await app
      .getByRole("button", { name: "Preview message", exact: true })
      .click();
    await expect(
      app.getByRole("textbox", { name: "Message preview", exact: true }),
    ).toHaveValue(/Only a message/);
    expect(fs.readFileSync(documentPath, "utf8")).toBe(content);
    await app
      .getByRole("button", { name: "Send to conversation", exact: true })
      .click();
    await expect(
      app.getByText("Sent. You can close this view.", { exact: true }),
    ).toBeVisible();
    expect(fs.readFileSync(documentPath, "utf8")).toBe(content);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("MCP App renders cached local images without loading remote Markdown images after save", async ({
  page,
}) => {
  fs.mkdirSync(directory, { recursive: true });
  const name = `images-${crypto.randomUUID()}`;
  const documentPath = path.join(directory, `${name}.md`);
  const imagePath = path.join(directory, `${name}.png`);
  const local = `![Local](./${name}.png)`;
  const remote = "![Remote](https://example.com/inkback-private-image.png)";
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  fs.writeFileSync(
    documentPath,
    `# Images\n\n${local}\n\n${remote}\n\nSibling.\n`,
  );
  try {
    const app = await openReview(page, documentPath);
    const editor = app.locator(".tiptap");
    await expect(editor.locator('img[alt="Local"]')).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    await expect(editor.locator('img[src^="https:"]')).toHaveCount(0);
    await editor.getByText("Sibling.", { exact: true }).click();
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially(" Saved sibling.");
    await editor.press("ControlOrMeta+s");
    await expect
      .poll(() => fs.readFileSync(documentPath, "utf8"))
      .toContain("Saved sibling.");
    await page.reload();
    const reloaded = await openReview(page, documentPath);
    await expect(reloaded.locator('.tiptap img[alt="Local"]')).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    await expect(reloaded.locator('.tiptap img[src^="https:"]')).toHaveCount(0);
    const saved = fs.readFileSync(documentPath, "utf8");
    expect(saved).toContain(local);
    expect(saved).toContain(remote);
    expect(saved).not.toContain("data:image/");
  } finally {
    fs.rmSync(documentPath, { force: true });
    fs.rmSync(imagePath, { force: true });
  }
});

test("MCP App saves pasted HTML with malformed review metadata without executing scripts", async ({
  page,
}) => {
  fs.mkdirSync(directory, { recursive: true });
  const documentPath = path.join(directory, `paste-${crypto.randomUUID()}.md`);
  fs.writeFileSync(documentPath, "Paste here.\n");
  try {
    const app = await openReview(page, documentPath);
    await app.locator(".tiptap").click();
    await app.locator(".tiptap").press("ControlOrMeta+End");
    const frame = page
      .frames()
      .find((frame) => frame.parentFrame()?.parentFrame() === page.mainFrame());
    expect(frame).toBeDefined();
    await frame?.evaluate(() => {
      const editor = document.querySelector(".ProseMirror");
      if (!editor) throw new Error("Expected editor");
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<span data-critic-change-kind="addition" data-critic-change-id="s1" data-critic-change-at="2024" data-critic-change-metadata="{">pasted</span><script>window.__inkbackXss=1</script>',
      );
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    });
    await expect(app.locator(".tiptap")).toContainText("pasted");
    await expect
      .poll(() => fs.readFileSync(documentPath, "utf8"))
      .toContain("pasted");
    await expect(app.locator(".tiptap script, .tiptap [onerror]")).toHaveCount(
      0,
    );
    expect(
      await frame?.evaluate(
        () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
      ),
    ).toBeUndefined();
    const reloaded = await openReview(page, documentPath);
    await expect(reloaded.locator(".tiptap")).toContainText("pasted");
  } finally {
    fs.rmSync(documentPath, { force: true });
  }
});

test("MCP App shows a conflict when a model reply races with an unsaved source edit", async ({
  page,
}) => {
  const documentPath = path.join(
    directory,
    `conflict-${crypto.randomUUID()}.md`,
  );
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(documentPath, "# Draft\n\n{>>Question<<}{#c1}\n");
  const client = new Client({ name: "conflict-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:4320/mcp")),
  );
  try {
    const app = await openReview(page, documentPath);
    const read = await client.callTool({
      name: "inkback_get_review_index",
      arguments: { documentPath },
    });
    await app
      .getByRole("button", { name: "Switch to code view", exact: true })
      .click();
    const source = app.locator(".cm-content");
    await source.click();
    await source.press("ControlOrMeta+End");
    await source.pressSequentially("\nUnsaved edit");
    const reply = await client.callTool({
      name: "inkback_reply_to_comment",
      arguments: {
        documentPath,
        parentId: "c1",
        message: "External reply",
        expectedVersion: (read.structuredContent as { fileVersion: string })
          .fileVersion,
      },
    });
    expect(reply.isError).not.toBe(true);
    await expect(
      app.getByText("Reload from disk", { exact: true }),
    ).toBeVisible();
    expect(fs.readFileSync(documentPath, "utf8")).toContain("External reply");
    await app.getByText("Reload from disk", { exact: true }).click();
    await expect(source).toContainText("External reply");
  } finally {
    await client.close();
    fs.rmSync(documentPath, { force: true });
  }
});
