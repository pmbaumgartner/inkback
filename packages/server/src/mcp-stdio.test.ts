import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Encoding = "newline-delimited JSON" | "Content-Length";

async function initializeOverStdio(encoding: Encoding): Promise<unknown> {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "name-placeholder-mcp-stdio-"),
  );
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const tsconfig = path.join(tempDir, "tsconfig.json");
  // Resolve workspace source in the subprocess so a clean checkout needs no build.
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        baseUrl: repoRoot,
        paths: { "@name-placeholder/rfm": ["packages/rfm/src/index.ts"] },
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
            `NAME_PLACEHOLDER did not answer initialize over ${encoding}; received ${buffer.length} stdout bytes. stderr: ${stderr || "(empty)"}`,
          ),
        );
      }, 3_000);
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
        let body: string;
        if (encoding === "newline-delimited JSON") {
          const end = buffer.indexOf("\n");
          if (end === -1) return;
          body = buffer.subarray(0, end).toString("utf8");
        } else {
          const end = buffer.indexOf("\r\n\r\n");
          if (end === -1) return;
          const header = buffer.subarray(0, end).toString("utf8");
          const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
          if (!Number.isFinite(length) || buffer.length < end + 4 + length)
            return;
          body = buffer.subarray(end + 4, end + 4 + length).toString("utf8");
        }
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
    child.stdin.write(
      encoding === "newline-delimited JSON"
        ? `${request}\n`
        : `Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`,
    );
    return await response;
  } finally {
    child.kill();
    await closed;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("MCP stdio client compatibility", () => {
  it.each<Encoding>([
    "newline-delimited JSON",
    "Content-Length",
  ])("initializes the NAME_PLACEHOLDER MCP process over %s", async (encoding) => {
    await expect(initializeOverStdio(encoding)).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "name-placeholder" },
      },
    });
  });
});
