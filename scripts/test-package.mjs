#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Test the distributed package outside the workspace so development dependencies
// cannot hide missing runtime dependencies. Build first when no package is given.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "roughdraft-package-"));
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
      run(npm, ["pack", "--json", "--pack-destination", temporary], repoRoot),
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
    ...(process.platform === "win32"
      ? ["roughdraft.cmd"]
      : ["bin", "roughdraft"]),
  );
  const version = run(cli, ["--version"]);
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/,
    "CLI prints its version",
  );
  assert.match(run(cli, ["--help"]), /Usage:/, "CLI prints usage instructions");
  console.log(`Installed package CLI passed: roughdraft ${version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
