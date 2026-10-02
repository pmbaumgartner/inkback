import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
export async function smokeMcp(entry) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "inkback-mcp-package-"));
  const child = spawn(process.execPath, [entry, "mcp", directory], {
    stdio: "pipe",
  });
  let buffer = "";
  let stderr = "";
  let id = 0;
  const requests = new Map();
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.stdout.on("data", (data) => {
    buffer += data;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        assert.equal(message.jsonrpc, "2.0");
        requests.get(message.id)?.resolve(message);
        requests.delete(message.id);
      } catch (error) {
        for (const request of requests.values()) request.reject(error);
      }
    }
  });
  function request(method, params) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`MCP timed out: ${method}; ${stderr}`)),
        10_000,
      );
      requests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });
  }
  try {
    const init = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "package-smoke", version: "1" },
    });
    assert.ok(init.result.capabilities.resources);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const resources = await request("resources/list", {});
    assert.ok(
      resources.result.resources.some(
        (resource) => resource.uri === "ui://inkback/review.html",
      ),
    );
    const ui = await request("resources/read", {
      uri: "ui://inkback/review.html",
    });
    assert.ok(ui.result.contents[0].text.length > 1_000_000);
    console.log("Installed MCP server and bundled UI passed.");
  } finally {
    const closed = new Promise((resolve) => child.once("close", resolve));
    child.kill();
    await closed;
    for (const request of requests.values())
      request.reject(new Error("MCP closed"));
    rmSync(directory, { recursive: true, force: true });
  }
}
