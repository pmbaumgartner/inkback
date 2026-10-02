import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMcpHttp } from "./mcp-http.js";
const directory =
  process.env.INKBACK_MCP_TEST_DIR ?? path.join(os.tmpdir(), "inkback-mcp-e2e");
fs.mkdirSync(directory, { recursive: true });
const instance = await startMcpHttp({
  port: Number(process.env.INKBACK_MCP_TEST_PORT ?? 4320),
  directories: [directory],
  noRoots: true,
});
console.log(`Inkback MCP test server: ${instance.url}; files: ${directory}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void instance.close().then(() => process.exit(0));
  });
