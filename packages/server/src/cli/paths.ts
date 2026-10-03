import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const currentServerRoot = path.resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);
export function getDevFrontendStateFilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicitFile = env.INKBACK_DEV_FRONTEND_STATE_FILE?.trim();
  if (explicitFile) {
    return path.resolve(explicitFile);
  }

  return path.join(currentServerRoot, ".context", "dev-frontend.json");
}
export function getServerStateFilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicitFile = env.INKBACK_STATE_FILE?.trim();
  if (explicitFile) {
    return path.resolve(explicitFile);
  }

  const explicitDir = env.INKBACK_STATE_DIR?.trim();
  if (explicitDir) {
    return path.join(path.resolve(explicitDir), "server.json");
  }

  return path.join(os.homedir(), ".inkback", "server.json");
}
