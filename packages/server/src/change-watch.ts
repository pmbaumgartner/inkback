import fs from "node:fs";
import { fileVersionFromFile } from "./document-files.js";

function state(absPath: string) {
  try {
    return { exists: true, version: fileVersionFromFile(absPath) };
  } catch {
    return { exists: false, version: null };
  }
}
export class ChangeWatcher {
  private pending = new Set<() => void>();
  private watchers = new Map<
    string,
    { listener: () => void; callbacks: Set<() => void> }
  >();
  waitForChange(
    absPath: string,
    sinceVersion: string | null,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const current = state(absPath);
    if (current.version !== sinceVersion || signal?.aborted)
      return Promise.resolve({
        changed: current.version !== sinceVersion,
        ...current,
      });
    return new Promise<{
      changed: boolean;
      exists: boolean;
      version: string | null;
    }>((resolve) => {
      let entry = this.watchers.get(absPath);
      if (!entry) {
        const callbacks = new Set<() => void>();
        const listener = () => {
          for (const callback of [...callbacks]) callback();
        };
        entry = { listener, callbacks };
        this.watchers.set(absPath, entry);
        fs.watchFile(absPath, { interval: 500 }, listener);
      }
      const finish = () => {
        this.pending.delete(finish);
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        entry.callbacks.delete(check);
        if (!entry.callbacks.size) {
          fs.unwatchFile(absPath, entry.listener);
          this.watchers.delete(absPath);
        }
        const next = state(absPath);
        resolve({ changed: next.version !== sinceVersion, ...next });
      };
      const check = () => {
        if (state(absPath).version !== sinceVersion) finish();
      };
      const timer = setTimeout(
        finish,
        Math.min(25_000, Math.max(1, timeoutMs)),
      );
      this.pending.add(finish);
      entry.callbacks.add(check);
      signal?.addEventListener("abort", finish, { once: true });
      check();
    });
  }
  close() {
    for (const finish of [...this.pending]) finish();
    for (const [file, entry] of this.watchers)
      fs.unwatchFile(file, entry.listener);
    this.watchers.clear();
  }
}
