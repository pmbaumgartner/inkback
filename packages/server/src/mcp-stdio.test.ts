import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function initializeOverStdio(): Promise<unknown> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-mcp-stdio-"));
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const tsconfig = path.join(tempDir, "tsconfig.json");
  // Resolve workspace source in the subprocess so a clean checkout needs no build.
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        baseUrl: repoRoot,
        paths: { "@inkback/rfm": ["packages/rfm/src/index.ts"] },
      },
    }),
  );
  const cliUrl = new URL("./cli.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import { runCli } from ${JSON.stringify(cliUrl)}; await runCli(["mcp"]);`,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
      stdio: "pipe",
    },
  );
  const closed = new Promise<void>((resolve) => child.once("close", resolve));
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    const response = new Promise<unknown>((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Inkback did not answer initialize over stdio; received ${buffer.length} stdout bytes. stderr: ${stderr || "(empty)"}`,
          ),
        );
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(
          new Error(
            `MCP exited (${code ?? signal}) before initialization: ${stderr}`,
          ),
        );
      });
      child.stdout.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const end = buffer.indexOf("\n");
        if (end === -1) return;
        const body = buffer.subarray(0, end).toString("utf8");
        clearTimeout(timer);
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "stdio-contract-test", version: "1.0.0" },
      },
    });
    child.stdin.write(`${request}\n`);
    return await response;
  } finally {
    child.kill();
    await closed;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("MCP stdio client compatibility", () => {
  it("initializes the Inkback MCP process over stdio", async () => {
    await expect(initializeOverStdio()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "Inkback" },
      },
    });
  }, 15_000);
});

it("uses the process working directory for guarded model writes over the SDK transport", async () => {
  const { Client } = await import("@modelcontextprotocol/client");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/client/stdio"
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inkback-stdio-policy-"),
  );
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "inkback-stdio-outside-"),
  );
  const documentPath = path.join(directory, "draft.md");
  const outsidePath = path.join(outside, "other.md");
  const content = "{>>Question<<}{#c1}\n";
  fs.writeFileSync(documentPath, content);
  fs.writeFileSync(outsidePath, content);
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const config = path.join(directory, "tsconfig.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        baseUrl: repoRoot,
        paths: { "@inkback/rfm": ["packages/rfm/src/index.ts"] },
      },
    }),
  );
  const client = new Client({ name: "stdio-policy-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      path.join(repoRoot, "node_modules/tsx/dist/loader.mjs"),
      "--input-type=module",
      "--eval",
      `import { runCli } from ${JSON.stringify(new URL("./cli.ts", import.meta.url).href)}; await runCli(["mcp", "--no-roots"]);`,
    ],
    cwd: directory,
    env: {
      ...process.env,
      INKBACK_ALLOWED_DIRS: "",
      TSX_TSCONFIG_PATH: config,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect(client.getServerCapabilities()).toMatchObject({
      tools: {},
      resources: {},
    });
    expect(
      (await client.listTools()).tools.find(
        (tool) => tool.name === "inkback_open_review",
      )?._meta,
    ).toMatchObject({ ui: { resourceUri: "ui://inkback/review.html" } });
    const result = await client.callTool({
      name: "inkback_get_review_index",
      arguments: { documentPath },
    });
    const version = (result.structuredContent as { fileVersion: string })
      .fileVersion;
    expect(
      (
        await client.callTool({
          name: "inkback_reply_to_comment",
          arguments: {
            documentPath,
            parentId: "c1",
            message: "Allowed",
            expectedVersion: version,
          },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: "inkback_reply_to_comment",
          arguments: {
            documentPath,
            parentId: "c1",
            message: "Stale",
            expectedVersion: version,
          },
        })
      ).isError,
    ).toBe(true);
    const refused = await client.callTool({
      name: "inkback_reply_to_comment",
      arguments: {
        documentPath: outsidePath,
        parentId: "c1",
        message: "Refused",
      },
    });
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatchObject([
      { type: "text", text: expect.stringContaining("working directory") },
    ]);
  } finally {
    await client.close();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
