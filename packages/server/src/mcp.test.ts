import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, startMcpServer } from "./mcp";

describe("mcp", () => {
  let tempDir: string;
  let stateFile: string;
  let projectDir: string;
  let documentPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "name-placeholder-mcp-"));
    projectDir = path.join(tempDir, "project");
    stateFile = path.join(tempDir, "state", "server.json");
    documentPath = path.join(projectDir, "draft.md");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(documentPath, "# Draft\n");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ url: "http://localhost:7373", port: 7373 }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("bounds review watch requests below the transport timeout", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ events: [], timedOut: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await callTool(
      "name_placeholder_watch_review_events",
      { documentPath, projectPath: projectDir },
      { NAME_PLACEHOLDER_STATE_FILE: stateFile },
      fetchImpl,
    );
    await callTool(
      "name_placeholder_watch_review_events",
      { documentPath, projectPath: projectDir, timeoutSeconds: 5 },
      { NAME_PLACEHOLDER_STATE_FILE: stateFile },
      fetchImpl,
    );

    expect(requestBodies[0]).toMatchObject({
      projectPath: projectDir,
      path: "draft.md",
      batchWindowSeconds: 0.25,
      fromNow: true,
    });
    expect(requestBodies[0]?.timeoutSeconds).toBeGreaterThan(0);
    expect(requestBodies[0]?.timeoutSeconds).toBeLessThan(300);
    expect(requestBodies[1]).toMatchObject({
      timeoutSeconds: 5,
    });
  });

  it("keeps waiting after a poll expires and receives feedback from the gap", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const event = { documentPath, type: "review.completed", sequence: 5 };
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const events =
        body.fromNow === false && body.afterSequence === 4 ? [event] : [];
      return Response.json({
        events,
        timedOut: events.length === 0,
        nextSequence: 5,
      });
    };

    const result = await callTool(
      "name_placeholder_watch_review_events",
      { documentPath },
      { NAME_PLACEHOLDER_STATE_FILE: stateFile },
      fetchImpl,
    );

    expect(result).toMatchObject({ events: [event], timedOut: false });
    expect(requests).toHaveLength(2);
  });

  it("returns overall comments from review watch events unchanged", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          events: [
            {
              documentPath,
              type: "review.completed",
              overallComment: "Please prioritize the CLI contract.",
            },
          ],
          timedOut: false,
          nextSequence: 2,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    const result = await callTool(
      "name_placeholder_watch_review_events",
      { documentPath, projectPath: projectDir },
      { NAME_PLACEHOLDER_STATE_FILE: stateFile },
      fetchImpl,
    );

    expect(result).toMatchObject({
      events: [
        {
          overallComment: "Please prioritize the CLI contract.",
        },
      ],
    });
  });

  it("cancels an active review watch when the MCP connection closes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let signal: AbortSignal | null | undefined;
    let response = "";
    output.on("data", (chunk) => {
      response += chunk;
    });
    startMcpServer({
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
      env: { NAME_PLACEHOLDER_STATE_FILE: stateFile },
      fetchImpl: async (_input, init) => {
        signal = init?.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason));
        });
      },
    });
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "name_placeholder_watch_review_events",
        arguments: { documentPath },
      },
    });
    input.write(
      `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    input.end();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(response).toBe("");
    output.destroy();
  });

  it("does not write a reply when the message contains a CriticMarkup close delimiter", async () => {
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);

    await expect(
      callTool(
        "name_placeholder_reply_to_comment",
        {
          documentPath,
          parentId: "c1",
          message: "This closes early <<} and breaks parsing.",
        },
        { NAME_PLACEHOLDER_STATE_FILE: stateFile },
      ),
    ).rejects.toThrow(/CriticMarkup close delimiter/);

    expect(fs.readFileSync(documentPath, "utf8")).toBe(original);
  });
});
