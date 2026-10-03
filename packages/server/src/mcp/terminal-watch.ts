import fs from "node:fs";
import path from "node:path";
import { getServerStateFilePath } from "../cli/paths.js";
import {
  type ReviewWatchResult,
  watchReviewEvents,
} from "../watch-review-events.js";

export function watchTerminalReview(
  args: {
    documentPath: string;
    projectPath?: string;
    timeoutSeconds?: number;
    batchWindowSeconds?: number;
  },
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ReviewWatchResult> {
  const server = readServerState(env);
  if (!server)
    throw new Error("Inkback is not running. Start it before watching.");
  const projectPath = args.projectPath
    ? path.resolve(args.projectPath)
    : path.dirname(args.documentPath);
  return watchReviewEvents({
    serverUrl: server.url,
    projectPath,
    path: path.relative(projectPath, args.documentPath),
    timeoutSeconds: args.timeoutSeconds,
    batchWindowSeconds: args.batchWindowSeconds ?? 0.25,
    fetchImpl,
    signal,
  });
}
function readServerState(
  env: NodeJS.ProcessEnv,
): { url: string; port: number } | null {
  const stateFile = getServerStateFilePath(env);
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
      url?: unknown;
      port?: unknown;
    };
    if (typeof parsed.url === "string" && typeof parsed.port === "number") {
      return { url: parsed.url, port: parsed.port };
    }
  } catch {}

  return null;
}
