import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import type {
  OpenDetachedCommand,
  OpenMode,
  SpawnSyncCommand,
} from "./types.js";

function hasChromeAppMode(
  platform: NodeJS.Platform = process.platform,
  spawnSyncCommand: SpawnSyncCommand = spawnSync,
) {
  if (platform !== "darwin") return false;
  return (
    spawnSyncCommand("open", ["-Ra", "Google Chrome"], {
      stdio: "ignore",
    }).status === 0
  );
}

export function openDetached(command: string, args: string[]) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function resolveDefaultBrowserBundleId(
  platform: NodeJS.Platform = process.platform,
  spawnSyncCommand: SpawnSyncCommand = spawnSync,
): string | null {
  if (platform !== "darwin") return null;

  const result = spawnSyncCommand(
    "plutil",
    [
      "-extract",
      "LSHandlers",
      "json",
      "-o",
      "-",
      path.join(
        os.homedir(),
        "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
      ),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.status !== 0) return null;

  try {
    const handlers = JSON.parse(result.stdout) as Array<{
      LSHandlerRoleAll?: string;
      LSHandlerURLScheme?: string;
    }>;
    return (
      handlers
        .find((handler) => handler.LSHandlerURLScheme === "http")
        ?.LSHandlerRoleAll?.trim()
        .toLowerCase() ?? null
    );
  } catch {
    return null;
  }
}

function isChromeBundleId(bundleId: string | null): boolean {
  return bundleId === "com.google.chrome";
}

export function createDefaultOpenUrl({
  env = process.env,
  platform = process.platform,
  spawnSyncCommand = spawnSync,
  openDetachedCommand = openDetached,
}: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnSyncCommand?: SpawnSyncCommand;
  openDetachedCommand?: OpenDetachedCommand;
} = {}): (url: string) => OpenMode {
  return (url: string) => {
    if (env.INKBACK_NO_OPEN === "1") {
      return "disabled";
    }

    if (
      isChromeBundleId(
        resolveDefaultBrowserBundleId(platform, spawnSyncCommand),
      )
    ) {
      if (hasChromeAppMode(platform, spawnSyncCommand)) {
        openDetachedCommand("open", [
          "-na",
          "Google Chrome",
          "--args",
          `--app=${url}`,
        ]);
        return "chrome-app";
      }
    }

    if (platform === "darwin") {
      openDetachedCommand("open", [url]);
      return "browser";
    }

    if (platform === "linux") {
      openDetachedCommand("xdg-open", [url]);
      return "browser";
    }

    if (platform === "win32") {
      openDetachedCommand("rundll32", ["url.dll,FileProtocolHandler", url]);
      return "browser";
    }

    return "none";
  };
}

export function defaultOpenUrl(url: string): OpenMode {
  return createDefaultOpenUrl()(url);
}
