import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smokeMcp } from "./mcp-package-smoke.mjs";

// Test the distributed package outside the workspace so development dependencies
// cannot hide missing runtime dependencies. Run after building the workspace.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const releaseRoot = path.join(repoRoot, "packages/cli/dist");
const expectedVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json")),
).version;
const temporary = mkdtempSync(path.join(tmpdir(), "inkback-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd = temporary) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "" },
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    timeout: 120_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

try {
  let packageSpec = process.argv[2];
  if (!packageSpec) {
    const packed = JSON.parse(
      run(
        npm,
        ["pack", "--json", "--pack-destination", temporary],
        releaseRoot,
      ),
    );
    packageSpec = path.join(temporary, packed[0].filename);
  } else if (packageSpec.endsWith(".tgz") && !packageSpec.includes("://")) {
    packageSpec = path.resolve(packageSpec);
  }
  const prefix = path.join(temporary, "installed");
  run(npm, [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    packageSpec,
  ]);
  const cli = path.join(
    prefix,
    ...(process.platform === "win32" ? ["inkback.cmd"] : ["bin", "inkback"]),
  );
  const version = run(cli, ["--version"]);
  assert.equal(version, expectedVersion, "CLI prints the release version");
  assert.match(run(cli, ["--help"]), /Usage:/, "CLI prints usage instructions");
  const workspace = path.join(temporary, "agent-workspace");
  const instructions = path.join(temporary, "AGENTS.md");
  writeFileSync(instructions, "Existing agent instructions\n");
  const skill = path.join(workspace, ".agents", "skills", "inkback");
  run(cli, ["skill", "install", skill]);
  assert.match(
    readFileSync(path.join(skill, "SKILL.md"), "utf8"),
    /name: inkback/,
  );
  assert.equal(
    readFileSync(instructions, "utf8"),
    "Existing agent instructions\n",
    "Skill installation preserves agent instructions",
  );
  run(cli, ["skill", "install", skill, "--force"]);
  const installedRoot = path.join(
    prefix,
    ...(process.platform === "win32"
      ? ["node_modules", "inkback"]
      : ["lib", "node_modules", "inkback"]),
  );
  assert.match(
    readFileSync(path.join(installedRoot, "LICENSE"), "utf8"),
    /Nathan Baschez/,
  );
  assert.ok(
    readFileSync(
      path.join(installedRoot, "packages/app/dist-mcp-app/mcp-app.html"),
    ).length > 1_000_000,
  );
  await smokeMcp(
    path.join(installedRoot, "packages/server/bin/inkback.mjs"),
    expectedVersion,
  );
  console.log(`Installed package CLI passed: inkback ${version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
