import fs from "node:fs";
import path from "node:path";
import { currentServerRoot } from "./paths.js";
export function readPackageVersion(): string {
  try {
    const packageJsonPath = path.join(currentServerRoot, "package.json");
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {}

  return "0.0.0";
}

export function emitJson(log: (message: string) => void, value: unknown) {
  log(JSON.stringify(value, null, 2));
}
