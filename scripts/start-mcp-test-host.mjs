import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const checkout =
  process.env.INKBACK_BASIC_HOST_DIR ??
  path.join(os.tmpdir(), "inkback-ext-apps-2.0.3");
const host = path.join(checkout, "examples/basic-host");
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`${command} failed`);
}
if (!fs.existsSync(checkout))
  run(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      "v2.0.3",
      "https://github.com/modelcontextprotocol/ext-apps.git",
      checkout,
    ],
    root,
  );
const commit = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: checkout,
  encoding: "utf8",
}).stdout.trim();
if (commit !== "82221c0c8ce7661efa6771c9d461511b1650495f")
  throw new Error("basic-host checkout does not match pinned v2.0.3 commit.");
if (!fs.existsSync(path.join(host, "dist/index.html"))) {
  // These build dependencies are provided by the upstream workspace root, but
  // this isolated example installation needs them explicitly.
  run(
    "npm",
    [
      "install",
      "--workspaces=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "@modelcontextprotocol/ext-apps@2.0.3",
      "@types/cors",
      "cross-env",
    ],
    host,
  );
  run("npm", ["run", "build"], host);
}
const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(host, "serve.ts")],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      SERVERS: JSON.stringify(["http://127.0.0.1:4320/mcp"]),
    },
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => child.kill(signal));
child.once("exit", (code) => process.exit(code ?? 0));
