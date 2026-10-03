import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChangeWatcher } from "./change-watch.js";
import { fileVersionFromFile } from "./document-files.js";

let directory: string;
let document: string;
let watcher: ChangeWatcher;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-changes-"));
  document = path.join(directory, "draft.md");
  fs.writeFileSync(document, "# Draft");
  watcher = new ChangeWatcher();
});
afterEach(() => {
  watcher.close();
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});
it("returns immediately for a changed version and on timeout or cancellation", async () => {
  const version = fileVersionFromFile(document);
  expect(await watcher.waitForChange(document, "old", 1000)).toMatchObject({
    changed: true,
    version,
  });
  expect(await watcher.waitForChange(document, version, 5)).toMatchObject({
    changed: false,
    exists: true,
    version,
  });
  const controller = new AbortController();
  const wait = watcher.waitForChange(
    document,
    version,
    25_000,
    controller.signal,
  );
  controller.abort();
  expect(await wait).toMatchObject({ changed: false });
});
it("wakes two callers on one file change and releases the shared watcher", async () => {
  const watch = vi.spyOn(fs, "watchFile");
  const unwatch = vi.spyOn(fs, "unwatchFile");
  const version = fileVersionFromFile(document);
  const first = watcher.waitForChange(document, version, 3000);
  const second = watcher.waitForChange(document, version, 3000);
  fs.writeFileSync(document, "# Changed");
  expect(await first).toMatchObject({ changed: true });
  expect(await second).toMatchObject({ changed: true });
  expect(watch).toHaveBeenCalledTimes(1);
  expect(unwatch).toHaveBeenCalledTimes(1);
});
