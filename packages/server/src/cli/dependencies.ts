import { spawn, spawnSync } from "node:child_process";

import { setTimeout as sleep } from "node:timers/promises";

import { fileURLToPath } from "node:url";

import { findAvailablePort } from "../ports.js";
import { defaultOpenUrl } from "./browser.js";
import type { CliDependencies, SpawnedServer } from "./types.js";

export const PROCESS_WAIT_ATTEMPTS = 20;

export const PROCESS_WAIT_DELAY_MS = 150;

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function defaultStopProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
    return;
  }

  for (let attempt = 0; attempt < PROCESS_WAIT_ATTEMPTS; attempt += 1) {
    if (!defaultIsProcessRunning(pid)) {
      return;
    }
    await sleep(PROCESS_WAIT_DELAY_MS);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

function defaultSpawnServerProcess(options: {
  port: number;
  projectDir: string;
}): SpawnedServer {
  const serverEntryPath = fileURLToPath(
    new URL("../child.js", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [
      serverEntryPath,
      "--port",
      String(options.port),
      "--project-dir",
      options.projectDir,
    ],
    {
      cwd: options.projectDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    },
  );

  child.unref();

  if (!child.pid) {
    throw new Error("Failed to start Inkback in the background.");
  }

  return { pid: child.pid };
}

export function createCliDependencies(
  overrides: Partial<CliDependencies> = {},
): CliDependencies {
  const fetchImpl = overrides.fetchImpl ?? fetch;

  return {
    env: overrides.env ?? process.env,
    cwd: overrides.cwd ?? process.cwd(),
    fetchImpl,
    findAvailablePortImpl: overrides.findAvailablePortImpl ?? findAvailablePort,
    sleepImpl: overrides.sleepImpl ?? ((ms) => sleep(ms)),
    spawnServerProcess:
      overrides.spawnServerProcess ?? defaultSpawnServerProcess,
    isProcessRunning: overrides.isProcessRunning ?? defaultIsProcessRunning,
    stopProcess: overrides.stopProcess ?? defaultStopProcess,
    openUrl: overrides.openUrl ?? defaultOpenUrl,
    log: overrides.log ?? ((message) => console.log(message)),
    error: overrides.error ?? ((message) => console.error(message)),
  };
}
