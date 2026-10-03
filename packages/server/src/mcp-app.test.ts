import { createInkbackMcpServer } from "./mcp/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createMcpHarness } from "../test-support/mcp-harness";

let directory: string;
let documentPath: string;
let client: Client;
let harness: Awaited<ReturnType<typeof createMcpHarness>>;
let instance: typeof harness.instance;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-app-tools-"));
  documentPath = path.join(directory, "draft.md");
  fs.writeFileSync(documentPath, "# Draft\n\n{>>Question<<}{#c1}\n");
  const htmlPath = path.join(directory, "ui.html");
  fs.writeFileSync(htmlPath, "<!doctype html><h1>Inkback</h1>");
  harness = await createMcpHarness({
    directories: [directory],
    env: {},
    htmlPath,
    log: () => {},
  });
  ({ client, instance } = harness);
});
afterEach(async () => {
  await harness.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: { documentPath, ...args } });
}
it("advertises the review UI and app-only tools with output contracts", async () => {
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(13);
  expect(
    tools.find((tool) => tool.name === "inkback_open_review")?._meta,
  ).toMatchObject({ ui: { resourceUri: "ui://inkback/review.html" } });
  for (const tool of tools.filter((tool) =>
    [
      "inkback_read_file",
      "inkback_save_file",
      "inkback_poll_changes",
      "inkback_finish_review",
      "inkback_read_asset",
      "inkback_save_asset",
    ].includes(tool.name),
  )) {
    expect(tool._meta).toMatchObject({ ui: { visibility: ["app"] } });
    expect(tool.outputSchema).toBeDefined();
  }
  expect(
    (await client.readResource({ uri: "ui://inkback/review.html" }))
      .contents[0],
  ).toMatchObject({
    mimeType: "text/html;profile=mcp-app",
    text: "<!doctype html><h1>Inkback</h1>",
  });
});
it("opens without duplicating the document and versions saves and model replies", async () => {
  const opened = await call("inkback_open_review");
  expect(opened.structuredContent).toMatchObject({
    documentPath,
    writable: true,
    summary: { comments: 1 },
  });
  const read = await call("inkback_read_file");
  const version = (read.structuredContent as { version: string }).version;
  expect(
    (
      await call("inkback_reply_to_comment", {
        parentId: "c1",
        message: "Reply",
        expectedVersion: version,
      })
    ).isError,
  ).not.toBe(true);
  expect(
    (
      await call("inkback_reply_to_comment", {
        parentId: "c1",
        message: "Stale",
        expectedVersion: version,
      })
    ).isError,
  ).toBe(true);
  const conflict = await call("inkback_save_file", {
    content: "# Stale",
    save: { mode: "conditional", expectedVersion: version },
  });
  expect(conflict.structuredContent).toMatchObject({
    status: "conflict",
    current: { content: expect.stringContaining("Reply") },
  });
  const overwritten = await call("inkback_save_file", {
    content: "# Explicit overwrite",
    save: { mode: "overwrite" },
  });
  expect(overwritten.structuredContent).toMatchObject({
    status: "saved",
    page: { content: "# Explicit overwrite" },
  });
  expect(fs.readFileSync(documentPath, "utf8")).toBe("# Explicit overwrite");
  expect(
    (await call("inkback_get_open_documents")).structuredContent,
  ).toMatchObject({
    documents: [
      {
        documentPath: fs.realpathSync(documentPath),
        lastVersion: expect.any(String),
      },
    ],
  });
});
it("finishes idempotently and supports a read-only overall message", async () => {
  const first = await call("inkback_finish_review", {
    overallComment: "Prioritize this",
    requestId: "one",
  });
  const content = fs.readFileSync(documentPath, "utf8");
  expect(content).toContain("Prioritize this");
  expect(
    await call("inkback_finish_review", {
      overallComment: "Prioritize this",
      requestId: "one",
    }),
  ).toEqual(first);
  expect(fs.readFileSync(documentPath, "utf8")).toBe(content);
  instance.policy.setRoots([]);
  const outside = path.join(
    os.tmpdir(),
    `inkback-readonly-${crypto.randomUUID()}.md`,
  );
  fs.writeFileSync(outside, "# Read-only");
  try {
    expect(
      (await call("inkback_read_file", { documentPath: outside }))
        .structuredContent,
    ).toMatchObject({ writable: false, notWritableReason: expect.any(String) });
    expect(
      (
        await call("inkback_save_file", {
          documentPath: outside,
          content: "write",
          save: { mode: "conditional", expectedVersion: "old" },
        })
      ).isError,
    ).toBe(true);
    const finish = await call("inkback_finish_review", {
      documentPath: outside,
      requestId: "read-only",
      overallComment: "Message only",
    });
    expect(finish.structuredContent).toMatchObject({
      message: expect.stringContaining("Message only"),
    });
    expect(fs.readFileSync(outside, "utf8")).toBe("# Read-only");
  } finally {
    fs.rmSync(outside);
  }
});
it("rejects asset symlink escapes and oversized documents", async () => {
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "inkback-assets-outside-"),
  );
  fs.symlinkSync(outside, path.join(directory, ".inkback-assets"));
  try {
    expect(
      (
        await call("inkback_save_asset", {
          filename: "image.png",
          mimeType: "image/png",
          dataBase64: "eA==",
        })
      ).isError,
    ).toBe(true);
    fs.writeFileSync(documentPath, "x".repeat(2 * 1024 * 1024 + 1));
    expect((await call("inkback_open_review")).isError).toBe(true);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
it("updates writable directories when the client changes roots", async () => {
  const { pathToFileURL } = await import("node:url");
  const { vi } = await import("vitest");
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "inkback-client-roots-"),
  );
  let roots = [{ uri: pathToFileURL(outside).href }];
  const rooted = createInkbackMcpServer({
    cwd: directory,
    env: {},
    log: () => {},
  });
  const rootClient = new Client(
    { name: "roots-test", version: "1" },
    { capabilities: { roots: { listChanged: true } } },
  );
  rootClient.setRequestHandler("roots/list", () => ({ roots }));
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await rooted.server.connect(remote);
    await rootClient.connect(local);
    await vi.waitFor(() =>
      expect(rooted.policy.describe()).toEqual([
        { path: fs.realpathSync(outside), source: "root" },
      ]),
    );
    roots = [];
    await rootClient.sendRootsListChanged();
    await vi.waitFor(() =>
      expect(rooted.policy.describe()).toEqual([
        { path: fs.realpathSync(directory), source: "working-directory" },
      ]),
    );
  } finally {
    await rootClient.close();
    await rooted.server.close();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
