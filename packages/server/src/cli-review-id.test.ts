import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { runCli } from "./cli";
import { createCliDependencies } from "./cli/dependencies";

it("requires --no-watch when routing a viewer to an existing review consumer", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-viewer-"));
  const documentPath = path.join(tempDir, "draft.md");
  fs.writeFileSync(documentPath, "# Draft\n");
  const errors: string[] = [];
  const spawnServerProcess = vi.fn(() => {
    throw new Error(
      "A scoped viewer without --no-watch attempted server startup",
    );
  });
  const deps = createCliDependencies({
    cwd: tempDir,
    env: {
      INKBACK_STATE_DIR: path.join(tempDir, "state"),
      INKBACK_DEV_FRONTEND_STATE_FILE: path.join(tempDir, "dev-frontend.json"),
    },
    log: () => {},
    error: (message) => errors.push(message),
    fetchImpl: async () => {
      throw new Error("No server is running for this isolated invocation");
    },
    findAvailablePortImpl: async () => 7373,
    spawnServerProcess,
  });

  try {
    await expect(
      runCli(
        [
          "open",
          documentPath,
          "--review-id",
          "existing-consumer",
          "--timeout",
          "1",
        ],
        deps,
      ),
    ).resolves.toBe(2);
    expect(spawnServerProcess).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("--no-watch");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
