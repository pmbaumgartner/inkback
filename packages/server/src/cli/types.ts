import type { spawnSync } from "node:child_process";
import type { findAvailablePort } from "../ports.js";
import type { openDetached } from "./browser.js";
import type { KNOWN_COMMANDS } from "./options.js";

export interface InkbackServerState {
  port: number;
  pid: number;
  startedAt: string;
  url: string;
}

export interface StatusPayload {
  backend?: string;
  pid?: number;
  projectDir?: string;
  serverRoot?: string;
  port?: number;
}

export interface DevFrontendState {
  apiPort: number | null;
  appPort: number;
  mode?: "full-dev" | "preview-web";
  repoRoot: string;
  startedAt: string;
  url: string;
}

export interface LiveDevFrontend {
  frontendUrl: string;
  apiUrl: string | null;
}

export interface SpawnedServer {
  pid: number;
}

export interface CliDependencies {
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetchImpl: typeof fetch;
  findAvailablePortImpl: typeof findAvailablePort;
  sleepImpl: (ms: number) => Promise<void>;
  spawnServerProcess: (options: {
    port: number;
    projectDir: string;
  }) => Promise<SpawnedServer> | SpawnedServer;
  isProcessRunning: (pid: number) => boolean;
  stopProcess: (pid: number) => Promise<void>;
  openUrl: (url: string) => OpenMode;
  log: (message: string) => void;
  error: (message: string) => void;
}

export type OpenMode =
  | "browser"
  | "chrome-app"
  | "disabled"
  | "existing-window"
  | "none";

export interface EnsureRunningResult {
  server: {
    port: number;
    url: string;
    tracked: boolean;
    pid: number | null;
    startedAt: string | null;
  };
  reused: boolean;
  portChanged: boolean;
}

export interface ResolvedTargetPath {
  projectDir: string;
  openPath: string;
}

export interface ReusableServer {
  port: number;
  url: string;
  tracked: boolean;
  pid: number | null;
  startedAt: string | null;
}

export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

export interface ParsedGlobalFlags {
  help: boolean;
  json: boolean;
  noColor: boolean;
  version: boolean;
}

export interface ParsedCli {
  command: string | null;
  global: ParsedGlobalFlags;
  rest: string[];
}

export interface ParsedCommandOptions {
  all: boolean;
  batchWindowSeconds: number;
  help: boolean;
  json: boolean;
  noOpen: boolean;
  noWatch: boolean;
  noRoots?: boolean;
  printUrl: boolean;
  reviewId?: string;
  port?: string;
  replay: boolean;
  stateDir?: string;
  stateFile?: string;
  timeoutSeconds?: number;
  watch: boolean;
  positionals: string[];
}

export type ParsedWatchOptions = ParsedCommandOptions & { serverUrl?: string };

export type OptionFlag =
  | "all"
  | "no-open"
  | "review-id"
  | "print-url"
  | "watch"
  | "no-watch"
  | "no-roots"
  | "replay"
  | "timeout"
  | "batch-window"
  | "port"
  | "state-file"
  | "state-dir";

export type SpawnSyncCommand = typeof spawnSync;

export type OpenDetachedCommand = typeof openDetached;

export interface SseEvent {
  event: string;
  data: string;
}

export interface ParsedSseChunk {
  events: SseEvent[];
  remainder: string;
}

export interface RemoteOpenOptions {
  host: string;
  openPath: string;
  noOpen: boolean;
  printUrl: boolean;
  json: boolean;
}

export type StopOutcome =
  | { kind: "not-running" }
  | { kind: "failed"; pid: number }
  | { kind: "unmanaged"; port: number }
  | { kind: "another-instance"; state: InkbackServerState }
  | {
      kind: "stopped";
      port: number;
      pid: number;
      unmanagedPid?: number;
      managed: boolean;
    };
