import fs from "node:fs";
import path from "node:path";
import {
  INKBACK_BIND_HOST,
  INKBACK_DEFAULT_PORT,
  INKBACK_LOOPBACK_HOSTS,
  INKBACK_PUBLIC_HOST,
} from "../network.js";
import { watchReviewEvents } from "../watch-review-events.js";
import {
  PROCESS_WAIT_ATTEMPTS,
  PROCESS_WAIT_DELAY_MS,
} from "./dependencies.js";
import { emitJson } from "./output.js";
import {
  currentServerRoot,
  getDevFrontendStateFilePath,
  getServerStateFilePath,
} from "./paths.js";
import type {
  CliDependencies,
  DevFrontendState,
  EnsureRunningResult,
  InkbackServerState,
  LiveDevFrontend,
  ParsedWatchOptions,
  ResolvedTargetPath,
  ReusableServer,
  StatusPayload,
} from "./types.js";

const STATUS_PATH = "/api/status";

const STATUS_TIMEOUT_MS = 750;

const SERVER_WAIT_ATTEMPTS = 40;

const SERVER_WAIT_DELAY_MS = 150;

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : INKBACK_DEFAULT_PORT;
}

export function getPreferredPort(env: NodeJS.ProcessEnv): number {
  return parsePort(env.INKBACK_PORT || env.PORT);
}

export function buildPublicBaseUrl(port: number): string {
  return `http://${INKBACK_PUBLIC_HOST}:${port}`;
}

function buildLoopbackUrl(host: string, port: number, pathname = "/"): URL {
  const baseHost = host.includes(":") ? `[${host}]` : host;
  return new URL(`http://${baseHost}:${port}${pathname}`);
}

export function buildTargetUrl(baseUrl: string, openPath: string): string {
  const url = new URL(baseUrl);

  url.pathname = "/";
  url.searchParams.set("path", openPath);
  return url.toString();
}

export async function sendOpenRequestToExistingWindow(
  deps: CliDependencies,
  baseUrl: string,
  openPath: string,
  reviewId?: string,
): Promise<boolean> {
  try {
    const requestUrl = new URL("/api/open-request", baseUrl);
    const response = await deps.fetchImpl(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: openPath,
        reviewId,
      }),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { delivered?: unknown };
    return payload.delivered === true;
  } catch {
    return false;
  }
}

export function resolveTargetPath(inputPath: string): ResolvedTargetPath {
  const resolvedPath = path.resolve(inputPath);
  const looksLikeMarkdownFile = resolvedPath.toLowerCase().endsWith(".md");

  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`Inkback can only open .md files: ${resolvedPath}`);
    }

    if (stat.isFile()) {
      if (!looksLikeMarkdownFile) {
        throw new Error(`Inkback can only open .md files: ${resolvedPath}`);
      }

      return {
        projectDir: path.dirname(resolvedPath),
        openPath: resolvedPath,
      };
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Inkback can only open")
    ) {
      throw error;
    }

    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") {
      throw new Error(`Path not found: ${resolvedPath}`);
    }

    throw new Error(`Failed to read path: ${resolvedPath}`);
  }

  throw new Error(`Unsupported path: ${resolvedPath}`);
}

function isValidServerState(value: unknown): value is InkbackServerState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<InkbackServerState>;
  return (
    typeof candidate.port === "number" &&
    Number.isFinite(candidate.port) &&
    typeof candidate.pid === "number" &&
    Number.isFinite(candidate.pid) &&
    typeof candidate.startedAt === "string" &&
    candidate.startedAt.length > 0 &&
    typeof candidate.url === "string" &&
    candidate.url.length > 0
  );
}

function isValidDevFrontendState(value: unknown): value is DevFrontendState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<DevFrontendState>;
  return (
    (candidate.apiPort === null ||
      (typeof candidate.apiPort === "number" &&
        Number.isFinite(candidate.apiPort))) &&
    typeof candidate.appPort === "number" &&
    Number.isFinite(candidate.appPort) &&
    (candidate.mode === undefined ||
      candidate.mode === "full-dev" ||
      candidate.mode === "preview-web") &&
    typeof candidate.repoRoot === "string" &&
    candidate.repoRoot.length > 0 &&
    typeof candidate.startedAt === "string" &&
    candidate.startedAt.length > 0 &&
    typeof candidate.url === "string" &&
    candidate.url.length > 0
  );
}

export function readServerStateFromDisk(
  stateFilePath: string,
): InkbackServerState | null {
  try {
    const raw = fs.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isValidServerState(parsed)) {
      return parsed;
    }
  } catch {}

  if (fs.existsSync(stateFilePath)) {
    removeServerStateFile(stateFilePath);
  }

  return null;
}

function readDevFrontendStateFromDisk(
  stateFilePath: string,
): DevFrontendState | null {
  try {
    const raw = fs.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isValidDevFrontendState(parsed)) {
      return parsed;
    }
  } catch {}

  return null;
}

export function writeServerStateToDisk(
  stateFilePath: string,
  state: InkbackServerState,
) {
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  fs.writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function removeServerStateFile(stateFilePath: string) {
  try {
    fs.rmSync(stateFilePath, { force: true });
  } catch {}
}

export async function getStatusPayload(
  port: number,
  deps: CliDependencies,
): Promise<StatusPayload | null> {
  for (const host of [INKBACK_BIND_HOST, ...INKBACK_LOOPBACK_HOSTS]) {
    try {
      const response = await deps.fetchImpl(
        buildLoopbackUrl(host, port, STATUS_PATH),
        {
          signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as StatusPayload;
      if (payload.backend === "local-files") {
        return payload;
      }
    } catch {}
  }

  return null;
}

async function waitForServer(port: number, deps: CliDependencies) {
  for (let attempt = 0; attempt < SERVER_WAIT_ATTEMPTS; attempt += 1) {
    const payload = await getStatusPayload(port, deps);
    if (payload) {
      return payload;
    }
    await deps.sleepImpl(SERVER_WAIT_DELAY_MS);
  }

  throw new Error("Timed out waiting for Inkback to start.");
}

export async function waitForServerToStop(
  port: number,
  deps: CliDependencies,
): Promise<boolean> {
  for (let attempt = 0; attempt < PROCESS_WAIT_ATTEMPTS; attempt += 1) {
    const payload = await getStatusPayload(port, deps);
    if (!payload) {
      return true;
    }

    await deps.sleepImpl(PROCESS_WAIT_DELAY_MS);
  }

  return false;
}

export async function resolveLiveDevFrontendBaseUrl(
  deps: CliDependencies,
): Promise<LiveDevFrontend | null> {
  const state = readDevFrontendStateFromDisk(
    getDevFrontendStateFilePath(deps.env),
  );
  if (!state) {
    return null;
  }

  if (path.resolve(state.repoRoot) !== currentServerRoot) {
    return null;
  }

  try {
    const frontendUrl = new URL(state.url);
    const mode =
      state.mode ?? (state.apiPort === null ? "preview-web" : "full-dev");

    if (mode === "preview-web") {
      const response = await deps.fetchImpl(frontendUrl, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }
    } else {
      const statusUrl = new URL("/api/status", frontendUrl);
      const response = await deps.fetchImpl(statusUrl, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as StatusPayload;
      if (payload.backend !== "local-files") {
        return null;
      }

      if (
        !payload.serverRoot ||
        path.resolve(payload.serverRoot) !== currentServerRoot
      ) {
        return null;
      }

      if (
        typeof payload.port === "number" &&
        state.apiPort !== null &&
        payload.port !== state.apiPort
      ) {
        return null;
      }
    }

    frontendUrl.pathname = "/";
    frontendUrl.search = "";
    frontendUrl.hash = "";
    return {
      frontendUrl: frontendUrl.toString(),
      apiUrl:
        mode === "full-dev" && state.apiPort !== null
          ? buildPublicBaseUrl(state.apiPort)
          : null,
    };
  } catch {
    return null;
  }
}

async function normalizeTrackedState(
  persistedState: InkbackServerState,
  stateFilePath: string,
): Promise<InkbackServerState> {
  const normalizedState = {
    ...persistedState,
    url: buildPublicBaseUrl(persistedState.port),
  };

  if (normalizedState.url !== persistedState.url) {
    writeServerStateToDisk(stateFilePath, normalizedState);
  }

  return normalizedState;
}

export async function findReusableServer(
  deps: CliDependencies,
  options: { serverRoot?: string } = {},
): Promise<ReusableServer | null> {
  const stateFilePath = getServerStateFilePath(deps.env);
  const persistedState = readServerStateFromDisk(stateFilePath);
  const preferredPort = getPreferredPort(deps.env);
  const expectedServerRoot = path.resolve(
    options.serverRoot ?? currentServerRoot,
  );

  const matchesServerRoot = (payload: StatusPayload | null) =>
    payload?.serverRoot
      ? path.resolve(payload.serverRoot) === expectedServerRoot
      : false;

  if (persistedState) {
    const pidRunning = deps.isProcessRunning(persistedState.pid);
    const statusPayload = await getStatusPayload(persistedState.port, deps);

    if (pidRunning && statusPayload && matchesServerRoot(statusPayload)) {
      const normalizedState = await normalizeTrackedState(
        persistedState,
        stateFilePath,
      );
      return {
        port: normalizedState.port,
        url: normalizedState.url,
        tracked: true,
        pid: normalizedState.pid,
        startedAt: normalizedState.startedAt,
      };
    }

    removeServerStateFile(stateFilePath);

    if (statusPayload && matchesServerRoot(statusPayload)) {
      return {
        port: persistedState.port,
        url: buildPublicBaseUrl(persistedState.port),
        tracked: false,
        pid: null,
        startedAt: null,
      };
    }
  }

  const preferredStatus = await getStatusPayload(preferredPort, deps);
  if (!preferredStatus || !matchesServerRoot(preferredStatus)) {
    return null;
  }

  return {
    port: preferredPort,
    url: buildPublicBaseUrl(preferredPort),
    tracked: false,
    pid: null,
    startedAt: null,
  };
}

export async function readRunningServerState(
  deps: CliDependencies,
): Promise<InkbackServerState | null> {
  const reusableServer = await findReusableServer(deps, {
    serverRoot: currentServerRoot,
  });
  if (
    !reusableServer?.tracked ||
    reusableServer.pid === null ||
    reusableServer.startedAt === null
  ) {
    return null;
  }

  return {
    port: reusableServer.port,
    pid: reusableServer.pid,
    startedAt: reusableServer.startedAt,
    url: reusableServer.url,
  };
}

export async function ensureServerRunning(
  deps: CliDependencies,
  options: { projectDir?: string } = {},
): Promise<EnsureRunningResult> {
  const reusableServer = await findReusableServer(deps, {
    serverRoot: currentServerRoot,
  });
  if (reusableServer) {
    return { server: reusableServer, reused: true, portChanged: false };
  }

  const preferredPort = getPreferredPort(deps.env);
  const port = await deps.findAvailablePortImpl(preferredPort);
  const projectDir = path.resolve(options.projectDir ?? deps.cwd);
  const spawned = await deps.spawnServerProcess({
    port,
    projectDir,
  });

  try {
    await waitForServer(port, deps);
  } catch (error) {
    await deps.stopProcess(spawned.pid);
    throw error;
  }

  const state: InkbackServerState = {
    port,
    pid: spawned.pid,
    startedAt: new Date().toISOString(),
    url: buildPublicBaseUrl(port),
  };
  writeServerStateToDisk(getServerStateFilePath(deps.env), state);

  return {
    server: {
      port: state.port,
      url: state.url,
      tracked: true,
      pid: state.pid,
      startedAt: state.startedAt,
    },
    reused: false,
    portChanged: port !== preferredPort,
  };
}

export function buildServerStatusJson(
  server: ReusableServer | null,
  stateFilePath: string,
) {
  if (!server) {
    return {
      running: false,
      stateFile: stateFilePath,
    };
  }

  return {
    running: true,
    url: server.url,
    port: server.port,
    pid: server.pid,
    startedAt: server.startedAt,
    stateFile: stateFilePath,
    managed: server.tracked,
  };
}

export async function runWatch(
  deps: CliDependencies,
  targetPath: string,
  options: ParsedWatchOptions,
  json: boolean,
): Promise<number> {
  const target = resolveTargetPath(targetPath);
  let serverUrl = options.serverUrl;
  if (!serverUrl) {
    const result = await ensureServerRunning(deps, {
      projectDir: target.projectDir,
    });
    serverUrl = result.server.url;
  }
  const relativePath = path.relative(target.projectDir, target.openPath);
  const payload = await watchReviewEvents({
    serverUrl,
    projectPath: target.projectDir,
    path: relativePath,
    batchWindowSeconds: options.batchWindowSeconds,
    timeoutSeconds: options.timeoutSeconds,
    replay: options.replay,
    fetchImpl: deps.fetchImpl,
  });

  if (json) {
    emitJson(deps.log, payload);
    return payload.timedOut ? 1 : 0;
  }

  if (payload.timedOut) {
    deps.log(`No review completed event received for ${target.openPath}.`);
    return 1;
  }

  deps.log(`Review completed for ${target.openPath}.`);
  deps.log(`Received ${(payload.events ?? []).length} event(s).`);
  return 0;
}
