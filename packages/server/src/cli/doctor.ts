import fs from "node:fs";

import path from "node:path";

import { type RfmDiagnostic, validateInkbackMarkdown } from "@inkback/rfm";
import { USAGE_ERROR } from "./options.js";
import { emitJson, readPackageVersion } from "./output.js";
import { currentServerRoot, getServerStateFilePath } from "./paths.js";
import {
  getPreferredPort,
  getStatusPayload,
  readServerStateFromDisk,
} from "./server-lifecycle.js";
import type { CliDependencies } from "./types.js";

export async function runDoctor(
  deps: CliDependencies,
  json: boolean,
): Promise<number> {
  const stateFilePath = getServerStateFilePath(deps.env);
  const persistedState = readServerStateFromDisk(stateFilePath);
  const preferredPort = getPreferredPort(deps.env);
  const preferredStatus = await getStatusPayload(preferredPort, deps);
  const trackedStatus = persistedState
    ? await getStatusPayload(persistedState.port, deps)
    : null;
  const cwdReadable = (() => {
    try {
      fs.accessSync(deps.cwd, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  })();
  const managedPidRunning = persistedState
    ? deps.isProcessRunning(persistedState.pid)
    : false;
  const serverRootMatches =
    trackedStatus?.serverRoot !== undefined
      ? path.resolve(trackedStatus.serverRoot) === currentServerRoot
      : false;
  const commandPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
  const { createPathPolicy } = await import("../path-policy.js");
  const { REVIEW_HTML_PATH } = await import("../mcp/ui-resource.js");
  const policy = createPathPolicy({
    cwd: deps.cwd,
    env: deps.env,
    log: () => {},
  });
  const mcpApp = {
    found: fs.existsSync(REVIEW_HTML_PATH),
    bytes: fs.existsSync(REVIEW_HTML_PATH)
      ? fs.statSync(REVIEW_HTML_PATH).size
      : null,
  };
  const report = {
    mcpApp,
    writableDirectories: policy.describe(),
    packageVersion: readPackageVersion(),
    nodeVersion: process.version,
    commandPath,
    stateFile: stateFilePath,
    stateFileExists: fs.existsSync(stateFilePath),
    managedPid: persistedState?.pid ?? null,
    managedPidRunning,
    recordedPort: persistedState?.port ?? null,
    recordedPortResponds: Boolean(trackedStatus),
    preferredPort,
    preferredPortResponds: Boolean(preferredStatus),
    serverRoot: trackedStatus?.serverRoot ?? null,
    serverRootMatches,
    browserOpeningDisabled: deps.env.INKBACK_NO_OPEN === "1",
    cwd: deps.cwd,
    cwdReadable,
  };

  if (json) {
    emitJson(deps.log, report);
    return 0;
  }

  deps.log(`Package version: ${report.packageVersion}`);
  deps.log(`Node version: ${report.nodeVersion}`);
  deps.log(`Command path: ${report.commandPath ?? "unknown"}`);
  deps.log(`State file: ${report.stateFile}`);
  deps.log(`State file exists: ${report.stateFileExists ? "yes" : "no"}`);
  deps.log(
    `Managed PID: ${
      report.managedPid === null
        ? "none"
        : `${report.managedPid} (${report.managedPidRunning ? "running" : "not running"})`
    }`,
  );
  deps.log(
    `Recorded port: ${
      report.recordedPort === null
        ? "none"
        : `${report.recordedPort} (${report.recordedPortResponds ? "responding" : "not responding"})`
    }`,
  );
  deps.log(
    `Preferred port: ${report.preferredPort} (${report.preferredPortResponds ? "responding" : "not responding"})`,
  );
  deps.log(
    `Server root matches checkout: ${report.serverRootMatches ? "yes" : "no"}`,
  );
  deps.log(
    `Browser opening disabled: ${report.browserOpeningDisabled ? "yes" : "no"}`,
  );
  deps.log(`Current directory readable: ${report.cwdReadable ? "yes" : "no"}`);
  deps.log(
    `MCP App UI: ${mcpApp.found ? `found (${mcpApp.bytes} bytes)` : "missing; run pnpm build"}`,
  );
  deps.log(
    `MCP writable directories: ${
      policy
        .describe()
        .map((entry) => `${entry.path} (${entry.source})`)
        .join(", ") || "none"
    }`,
  );
  return 0;
}

export async function runMarkdownDoctor(
  deps: CliDependencies,
  targetPath: string,
  json: boolean,
): Promise<number> {
  if (!isMarkdownPath(targetPath)) {
    deps.error(`Inkback doctor can only validate .md files: ${targetPath}`);
    return USAGE_ERROR;
  }

  const absolutePath = path.resolve(deps.cwd, targetPath);
  let markdown: string;

  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      deps.error(`Path is not a file: ${absolutePath}`);
      return USAGE_ERROR;
    }
    markdown = fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    deps.error(
      code === "ENOENT"
        ? `Path not found: ${absolutePath}`
        : `Could not read path: ${absolutePath}`,
    );
    return USAGE_ERROR;
  }

  const validation = validateInkbackMarkdown(markdown);
  const payload = {
    kind: "markdown" as const,
    path: absolutePath,
    format: validation.format,
    version: validation.version,
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    summary: validation.summary,
  };

  if (json) {
    emitJson(deps.log, payload);
    return validation.ok ? 0 : 1;
  }

  const displayPath = relativeDisplayPath(deps.cwd, absolutePath);
  deps.log(`Inkback Markdown doctor: ${displayPath}`);
  deps.log(`Status: ${validation.ok ? "passed" : "failed"}`);

  if (validation.errors.length > 0) {
    deps.log("");
    deps.log("Errors:");
    for (const diagnostic of validation.errors) {
      deps.log(formatMarkdownDiagnostic(diagnostic));
    }
  }

  if (validation.warnings.length > 0) {
    deps.log("");
    deps.log("Warnings:");
    for (const diagnostic of validation.warnings) {
      deps.log(formatMarkdownDiagnostic(diagnostic));
    }
  }

  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    deps.log("");
    deps.log(
      `Found ${validation.summary.comments} comment(s) and ${validation.summary.suggestions} suggestion(s).`,
    );
  }

  return validation.ok ? 0 : 1;
}

function isMarkdownPath(targetPath: string): boolean {
  const extension = path.extname(targetPath).toLowerCase();
  return extension === ".md";
}

function relativeDisplayPath(cwd: string, absolutePath: string): string {
  const relativePath = path.relative(cwd, absolutePath);
  return relativePath && !relativePath.startsWith("..")
    ? relativePath
    : absolutePath;
}

function formatMarkdownDiagnostic(diagnostic: RfmDiagnostic): string {
  return `  ${diagnostic.line}:${diagnostic.column}  ${diagnostic.message}`;
}
