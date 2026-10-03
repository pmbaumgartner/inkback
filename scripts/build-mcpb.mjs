import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smokeMcp } from "./mcp-package-smoke.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json")),
).version;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-mcpb-"));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    shell: process.platform === "win32",
  });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  if (!process.argv.includes("--skip-build")) run("pnpm", ["build"]);
  const [packed] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", temporary]),
  );
  const stage = path.join(temporary, "stage");
  fs.mkdirSync(stage);
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify({ name: "inkback-mcpb-stage", private: true, version }),
  );
  run(
    "npm",
    [
      "install",
      path.join(temporary, packed.filename),
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    stage,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "mcpb/manifest.json")),
  );
  manifest.version = version;
  fs.writeFileSync(
    path.join(stage, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  for (const filename of ["LICENSE", "README.md"])
    fs.copyFileSync(path.join(root, filename), path.join(stage, filename));
  fs.copyFileSync(
    path.join(root, "mcpb/icon.png"),
    path.join(stage, "icon.png"),
  );
  await smokeMcp(path.join(stage, manifest.server.entry_point));
  const outputDirectory = path.join(root, "dist");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, `inkback-${version}.mcpb`);
  console.log(run("pnpm", ["exec", "mcpb", "pack", stage, output]));
  console.log(`MCPB bundle: ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
