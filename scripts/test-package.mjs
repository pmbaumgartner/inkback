import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createTcpServer } from "node:net";
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
const temporary = realpathSync(
  mkdtempSync(path.join(tmpdir(), "inkback-package-")),
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd = temporary, env = {}, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "", ...env },
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    timeout: 120_000,
  });
  assert.equal(
    result.status,
    expectedStatus,
    `${command} ${args.join(" ")} failed:\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

async function freePort() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function verifyLifecycle(cli, otherCli, installedRoot, otherRoot) {
  const port = await freePort();
  const stateFile = path.join(temporary, "server-state.json");
  const devState = path.join(temporary, "dev-frontend.json");
  const env = {
    INKBACK_PORT: String(port),
    INKBACK_STATE_FILE: stateFile,
    INKBACK_DEV_FRONTEND_STATE_FILE: devState,
    INKBACK_NO_OPEN: "1",
  };
  const command = (binary, action, overrides = {}) =>
    JSON.parse(
      run(binary, [action, "--json"], temporary, { ...env, ...overrides }),
    );
  const doc = path.join(temporary, "review.md");
  writeFileSync(doc, "# Review\n");
  let started;
  let confirmedPid;
  let failure;
  try {
    started = command(cli, "start");
    assert.equal(started.running, true);
    assert.equal(started.managed, true);
    assert.equal(started.reused, false);
    assert.equal(started.port, port);
    const status = command(cli, "status");
    assert.equal(
      status.pid,
      started.pid,
      "detached child survives launcher exit",
    );
    const response = await fetch(`${started.url}/api/status`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    const identity = await response.json();
    assert.equal(path.resolve(identity.serverRoot), installedRoot);
    assert.equal(identity.pid, started.pid);
    confirmedPid = started.pid;
    const page = await fetch(started.url, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    const assets = [
      ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(js|css))"/g),
    ];
    assert.ok(assets.length, "browser HTML references built assets");
    for (const [, asset, extension] of assets) {
      const resource = await fetch(new URL(asset, started.url), {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(resource.status, 200, `browser asset ${asset} served`);
      assert.match(
        resource.headers.get("content-type") ?? "",
        extension === "js" ? /javascript/ : /css/,
      );
      assert.ok((await resource.text()).length > 100);
    }
    for (const extension of ["js", "css"]) {
      if (html.includes(`.${extension}`))
        assert.ok(assets.some((asset) => asset[2] === extension));
    }
    const reused = command(cli, "start");
    assert.equal(reused.reused, true);
    assert.equal(reused.pid, started.pid);

    // A foreign installation must neither adopt nor stop the tracked process.
    const foreignEnv = {
      INKBACK_STATE_FILE: path.join(temporary, "foreign-state.json"),
    };
    const foreign = command(otherCli, "status", foreignEnv);
    assert.equal(foreign.running, false);
    const foreignStop = JSON.parse(
      run(
        otherCli,
        ["stop", "--json"],
        temporary,
        { ...env, ...foreignEnv },
        1,
      ),
    );
    assert.equal(foreignStop.stopped, false);
    assert.equal(command(cli, "status").pid, started.pid);
    assert.notEqual(installedRoot, otherRoot);

    const frontendUrl = `${started.url}/`;
    const frontendPort = port;
    const frontendState = (repoRoot) => {
      writeFileSync(
        devState,
        JSON.stringify({
          repoRoot,
          url: frontendUrl,
          appPort: frontendPort,
          apiPort: null,
          mode: "preview-web",
          startedAt: new Date().toISOString(),
        }),
      );
    };
    const open = (binary, overrides = env) =>
      JSON.parse(
        run(
          binary,
          ["open", doc, "--no-watch", "--no-open", "--json"],
          temporary,
          overrides,
        ),
      );
    frontendState(installedRoot);
    assert.equal(
      open(cli).serverUrl,
      frontendUrl,
      "matching frontend is selected",
    );
    frontendState(otherRoot);
    assert.equal(
      open(cli).serverUrl,
      started.url,
      "foreign frontend is rejected",
    );
    assert.equal(
      open(otherCli).serverUrl,
      frontendUrl,
      "foreign frontend belongs to its own install",
    );
    const checkoutCli = path.join(repoRoot, "packages/server/bin/inkback.mjs");
    const checkoutRoot = realpathSync(repoRoot);
    frontendState(checkoutRoot);
    assert.equal(
      open(checkoutCli).serverUrl,
      frontendUrl,
      "checkout uses matching frontend",
    );
    frontendState(installedRoot);
    if (process.env.INKBACK_TEST_INJECT_FAILURE === "after-start") {
      throw new Error("Injected lifecycle assertion failure");
    }
    assert.equal(command(cli, "stop").stopped, true);
    assert.equal(command(cli, "status").running, false);
  } catch (error) {
    failure = error;
  }
  // The state file is unique to this run. Never signal an unconfirmed PID read from disk.
  // When start throws after writing state, an HTTP identity match can still establish ownership.
  if (!started && existsSync(stateFile)) {
    try {
      started = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {}
  }
  if (started && !confirmedPid) {
    try {
      const response = await fetch(`${started.url}/api/status`, {
        signal: AbortSignal.timeout(1500),
      });
      const identity = await response.json();
      if (
        identity.pid === started.pid &&
        path.resolve(identity.serverRoot) === installedRoot
      )
        confirmedPid = started.pid;
    } catch {}
  }
  if (confirmedPid) {
    try {
      // Prefer the managed stop while HTTP is healthy. If it fails, only the
      // PID confirmed from our isolated launch and HTTP identity may be signalled.
      try {
        command(cli, "stop");
      } catch {}
      let alive = true;
      try {
        process.kill(confirmedPid, 0);
      } catch {
        alive = false;
      }
      if (alive) process.kill(confirmedPid, "SIGTERM");
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          process.kill(confirmedPid, 0);
        } catch {
          alive = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (alive) {
        process.kill(confirmedPid, "SIGKILL");
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            process.kill(confirmedPid, 0);
          } catch {
            alive = false;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert.equal(alive, false, `Owned child PID ${confirmedPid} exited`);
      // The HTTP endpoint must also be gone before deleting the installation.
      try {
        const response = await fetch(`${started.url}/api/status`, {
          signal: AbortSignal.timeout(750),
        });
        if (response.ok)
          throw new Error(`Owned server still responds at ${started.url}`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Owned server still")
        )
          throw error;
      }
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], "Lifecycle and cleanup failed")
        : error;
    }
  } else if (started && failure) {
    failure = new AggregateError(
      [failure],
      `Could not confirm ownership for cleanup of PID ${started.pid}`,
    );
  }
  if (failure) throw failure;
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
  const otherPrefix = path.join(temporary, "other-installed");
  run(npm, [
    "install",
    "--global",
    "--prefix",
    otherPrefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    packageSpec,
  ]);
  const otherCli = path.join(
    otherPrefix,
    ...(process.platform === "win32" ? ["inkback.cmd"] : ["bin", "inkback"]),
  );
  const otherRoot = path.join(
    otherPrefix,
    ...(process.platform === "win32"
      ? ["node_modules", "inkback"]
      : ["lib", "node_modules", "inkback"]),
  );
  await verifyLifecycle(cli, otherCli, installedRoot, otherRoot);
  console.log(`Installed package CLI passed: inkback ${version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
