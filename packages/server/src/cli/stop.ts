import path from "node:path";
import { emitJson } from "./output.js";
import { currentServerRoot, getServerStateFilePath } from "./paths.js";
import {
  buildPublicBaseUrl,
  getPreferredPort,
  getStatusPayload,
  readServerStateFromDisk,
  removeServerStateFile,
  waitForServerToStop,
  writeServerStateToDisk,
} from "./server-lifecycle.js";
import type {
  CliDependencies,
  InkbackServerState,
  StatusPayload,
  StopOutcome,
} from "./types.js";

async function stopTrackedServer(deps: CliDependencies): Promise<{
  persistedState: InkbackServerState | null;
  stopped: boolean;
  portIsQuiet: boolean;
  failedPid: number | null;
}> {
  const stateFilePath = getServerStateFilePath(deps.env);
  const persistedState = readServerStateFromDisk(stateFilePath);

  if (!persistedState) {
    return {
      failedPid: null,
      persistedState: null,
      portIsQuiet: true,
      stopped: false,
    };
  }

  if (deps.isProcessRunning(persistedState.pid)) {
    await deps.stopProcess(persistedState.pid);
  }

  const trackedPidStillRunning = deps.isProcessRunning(persistedState.pid);
  const portIsQuiet = await waitForServerToStop(persistedState.port, deps);

  if (trackedPidStillRunning) {
    writeServerStateToDisk(stateFilePath, {
      ...persistedState,
      url: buildPublicBaseUrl(persistedState.port),
    });
    return {
      failedPid: persistedState.pid,
      persistedState,
      portIsQuiet,
      stopped: false,
    };
  }

  removeServerStateFile(stateFilePath);
  return {
    failedPid: null,
    persistedState,
    portIsQuiet,
    stopped: true,
  };
}

function getConfidentStopCandidate(
  payload: StatusPayload | null,
): number | null {
  if (
    typeof payload?.pid !== "number" ||
    !Number.isFinite(payload.pid) ||
    payload.pid <= 0 ||
    !payload.serverRoot ||
    path.resolve(payload.serverRoot) !== currentServerRoot
  ) {
    return null;
  }

  return payload.pid;
}

async function stopServer(
  deps: CliDependencies,
  all: boolean,
): Promise<StopOutcome> {
  const tracked = await stopTrackedServer(deps);
  if (tracked.failedPid !== null)
    return { kind: "failed", pid: tracked.failedPid };
  const state = tracked.persistedState;
  if (state && tracked.portIsQuiet)
    return { kind: "stopped", port: state.port, pid: state.pid, managed: true };
  const port = state?.port ?? getPreferredPort(deps.env);
  const payload = await getStatusPayload(port, deps);
  if (!state && !payload) return { kind: "not-running" };
  const candidate = all ? getConfidentStopCandidate(payload) : null;
  if (candidate !== null) {
    await deps.stopProcess(candidate);
    if (await waitForServerToStop(port, deps))
      return {
        kind: "stopped",
        port,
        pid: state?.pid ?? candidate,
        managed: !!state,
        ...(state ? { unmanagedPid: candidate } : {}),
      };
  }
  return state
    ? { kind: "another-instance", state }
    : { kind: "unmanaged", port };
}

export async function runStop(
  deps: CliDependencies,
  all: boolean,
  json: boolean,
) {
  const outcome = await stopServer(deps, all);
  const stateFile = getServerStateFilePath(deps.env);
  const reason = "No confident unmanaged process candidate.";
  let data: Record<string, unknown>;
  let messages: string[];
  let error = false;
  let code = 0;
  switch (outcome.kind) {
    case "not-running":
      data = { stopped: false, running: false, stateFile };
      messages = ["Inkback is not running."];
      break;
    case "failed":
      data = { stopped: false, pid: outcome.pid, stateFile };
      messages = [`Failed to stop Inkback process ${outcome.pid}.`];
      error = true;
      code = 1;
      break;
    case "unmanaged": {
      const url = buildPublicBaseUrl(outcome.port);
      data = {
        stopped: false,
        managed: false,
        url,
        ...(all ? { reason } : {}),
        stateFile,
      };
      messages = [
        all
          ? `Inkback is still running at ${url}, but it could not be matched to a safe process candidate. Stop it manually.`
          : `Inkback is still running at ${url}, but it is not managed by ${stateFile}. Stop it manually.`,
      ];
      error = true;
      code = 1;
      break;
    }
    case "another-instance": {
      const url = buildPublicBaseUrl(outcome.state.port);
      data = {
        stopped: true,
        pid: outcome.state.pid,
        url,
        anotherInstanceRunning: true,
        ...(all ? { reason } : {}),
        stateFile,
      };
      messages = [
        `Stopped tracked Inkback process ${outcome.state.pid}, but another Inkback instance is still running at ${url}.`,
      ];
      error = true;
      code = 1;
      break;
    }
    case "stopped": {
      const url = buildPublicBaseUrl(outcome.port);
      data = {
        stopped: true,
        pid: outcome.pid,
        url,
        ...(!outcome.managed ? { managed: false } : {}),
        ...(outcome.unmanagedPid ? { unmanagedPid: outcome.unmanagedPid } : {}),
        stateFile,
      };
      messages = [
        outcome.managed
          ? `Stopped Inkback at ${url}.`
          : `Stopped unmanaged Inkback at ${url}.`,
      ];
      if (outcome.unmanagedPid)
        messages.push(
          `Stopped unmanaged Inkback process ${outcome.unmanagedPid}.`,
        );
      break;
    }
  }
  if (json) emitJson(deps.log, data);
  else for (const message of messages) (error ? deps.error : deps.log)(message);
  return code;
}
