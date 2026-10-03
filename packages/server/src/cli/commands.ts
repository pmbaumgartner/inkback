import { USAGE_ERROR } from "./options.js";
import { emitJson } from "./output.js";
import { getServerStateFilePath } from "./paths.js";
import {
  buildPublicBaseUrl,
  buildServerStatusJson,
  buildTargetUrl,
  ensureServerRunning,
  findReusableServer,
  getPreferredPort,
  resolveLiveDevFrontendBaseUrl,
  resolveTargetPath,
  runWatch,
  sendOpenRequestToExistingWindow,
} from "./server-lifecycle.js";
import type {
  CliDependencies,
  EnsureRunningResult,
  OpenMode,
  ParsedCommandOptions,
  ParsedWatchOptions,
  ResolvedTargetPath,
} from "./types.js";
export async function runStart(
  deps: CliDependencies,
  options: ParsedCommandOptions,
  json: boolean,
): Promise<number> {
  if (options.positionals.length > 0) {
    deps.error("Usage: inkback start [--port <port>] [--json]");
    return USAGE_ERROR;
  }

  const result = await ensureServerRunning(deps);
  if (json) {
    emitJson(deps.log, {
      ...buildServerStatusJson(result.server, getServerStateFilePath(deps.env)),
      reused: result.reused,
      portChanged: result.portChanged,
    });
    return 0;
  }

  if (result.reused) {
    if (result.server.tracked) {
      deps.log(`Inkback is already running at ${result.server.url}`);
    } else {
      deps.log(
        `Inkback is already running at ${result.server.url}, but it is not managed by ${getServerStateFilePath(deps.env)}.`,
      );
    }
    return 0;
  }

  if (result.portChanged) {
    deps.log(
      `Preferred port ${getPreferredPort(deps.env)} is busy, using ${result.server.port}.`,
    );
  }

  deps.log(`Inkback running at ${result.server.url}`);
  return 0;
}
export async function runStatus(
  deps: CliDependencies,
  options: ParsedCommandOptions,
  json: boolean,
): Promise<number> {
  if (options.positionals.length > 0) {
    deps.error("Usage: inkback status [--json]");
    return USAGE_ERROR;
  }

  const server = await findReusableServer(deps);
  if (!server) {
    if (json) {
      emitJson(
        deps.log,
        buildServerStatusJson(null, getServerStateFilePath(deps.env)),
      );
      return 0;
    }

    deps.log("Inkback is not running. Start it with `inkback start`.");
    return 1;
  }

  if (json) {
    emitJson(
      deps.log,
      buildServerStatusJson(server, getServerStateFilePath(deps.env)),
    );
    return 0;
  }

  deps.log(`Inkback is running at ${server.url}`);
  if (server.tracked && server.pid !== null && server.startedAt !== null) {
    deps.log(`PID: ${server.pid}`);
    deps.log(`Started: ${server.startedAt}`);
    deps.log(`State file: ${getServerStateFilePath(deps.env)}`);
  } else {
    deps.log(
      `This server is not managed by ${getServerStateFilePath(deps.env)}.`,
    );
  }
  return 0;
}
export async function runOpen(
  deps: CliDependencies,
  options: ParsedCommandOptions,
  json: boolean,
): Promise<number> {
  const target = options.positionals[0];
  if (!target) {
    deps.error("Usage: inkback open <path>");
    return USAGE_ERROR;
  }

  if (options.positionals.length > 1) {
    deps.error("Usage: inkback open <path>");
    return USAGE_ERROR;
  }

  if (options.watch && options.noWatch) {
    deps.error("Use either --watch or --no-watch, not both.");
    return USAGE_ERROR;
  }
  if (options.reviewId && !options.noWatch) {
    deps.error(
      "--review-id requires --no-watch; its review is owned by an existing consumer.",
    );
    return USAGE_ERROR;
  }

  if (options.watch && options.printUrl) {
    deps.error("Use either --watch or --print-url, not both.");
    return USAGE_ERROR;
  }

  let resolvedTarget: ResolvedTargetPath;
  try {
    resolvedTarget = resolveTargetPath(target);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : "Invalid path.");
    return 1;
  }

  const { projectDir, openPath } = resolvedTarget;

  const liveDevFrontend = await resolveLiveDevFrontendBaseUrl(deps);
  let result: EnsureRunningResult | null = null;
  let baseUrl: string;

  if (liveDevFrontend) {
    baseUrl = liveDevFrontend.frontendUrl;
  } else {
    result = await ensureServerRunning(deps, { projectDir });
    baseUrl = buildPublicBaseUrl(result.server.port);
  }

  const viewer = new URL(buildTargetUrl(baseUrl, openPath));
  if (options.reviewId) viewer.searchParams.set("reviewId", options.reviewId);
  const targetUrl = viewer.href;
  let openMode: OpenMode = "disabled";
  if (!options.noOpen && deps.env.INKBACK_NO_OPEN !== "1") {
    openMode = (await sendOpenRequestToExistingWindow(
      deps,
      baseUrl,
      openPath,
      options.reviewId,
    ))
      ? "existing-window"
      : deps.openUrl(targetUrl);
  }

  if (result?.portChanged) {
    const message = `Preferred port ${getPreferredPort(deps.env)} is busy, using ${result.server.port}.`;
    if (options.printUrl) {
      deps.error(message);
    } else if (!json) {
      deps.log(message);
    }
  }

  if (options.printUrl) {
    deps.log(targetUrl);
    return 0;
  }

  const shouldWatch = !options.noWatch && !options.printUrl;

  if (shouldWatch) {
    if (!json) {
      if (openMode === "chrome-app") {
        deps.log(`Opened Inkback in a Chrome app window: ${targetUrl}`);
      } else if (openMode === "existing-window") {
        deps.log(`Reused an existing Inkback window: ${targetUrl}`);
      } else if (openMode === "browser") {
        deps.log(`Opened Inkback in the default browser: ${targetUrl}`);
      } else {
        deps.log(`Inkback is running at ${targetUrl}`);
      }
      deps.log("Waiting for Finish review...");
    }

    const watchOptions: ParsedWatchOptions = {
      ...options,
      batchWindowSeconds: options.batchWindowSeconds,
      help: false,
      json,
      positionals: [target],
      replay: options.replay,
      serverUrl: liveDevFrontend?.apiUrl ?? undefined,
      stateDir: options.stateDir,
      stateFile: options.stateFile,
      timeoutSeconds: options.timeoutSeconds,
    };
    return runWatch(deps, target, watchOptions, json);
  }

  if (json) {
    emitJson(deps.log, {
      opened: true,
      url: targetUrl,
      serverUrl: baseUrl,
      path: openPath,
      openMode,
    });
    return 0;
  }

  if (openMode === "chrome-app") {
    deps.log(`Opened Inkback in a Chrome app window: ${targetUrl}`);
    return 0;
  }

  if (openMode === "existing-window") {
    deps.log(`Reused an existing Inkback window: ${targetUrl}`);
    return 0;
  }

  if (openMode === "browser") {
    deps.log(`Opened Inkback in the default browser: ${targetUrl}`);
    return 0;
  }

  deps.log(`Inkback is running at ${targetUrl}`);
  return 0;
}
