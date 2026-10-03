import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSaveController } from "../src/DocumentSaveController";
import { MarkdownFileConflictError, type StorageBackend } from "../src/storage";

const page = { id: "a.md", title: "A", content: "original", version: "v1" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function controller(save: StorageBackend["saveMarkdownFile"]) {
  const backend = { saveMarkdownFile: save } as StorageBackend;
  return new DocumentSaveController("a.md", page, backend);
}
afterEach(() => vi.useRealTimers());

describe("document save queue", () => {
  it("reconciles an own watcher event before write acceptance without blocking the next save", async () => {
    const write = deferred<typeof page>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => write.promise)
      .mockResolvedValueOnce({ ...page, content: "second", version: "v3" });
    const draft = controller(save);
    draft.edit("first");
    const first = draft.flushSave();
    const event = draft.onDiskEvent({
      path: "a.md",
      exists: true,
      version: "v2",
    });
    write.resolve({ ...page, content: "first", version: "v2" });
    await Promise.all([first, event]);
    expect(draft.diskState).toBe("clean");
    draft.edit("second");
    expect(await draft.flushSave()).toEqual({ status: "saved" });
    expect(save.mock.calls[1]).toEqual([
      "a.md",
      "second",
      { mode: "conditional", expectedVersion: "v2" },
    ]);
    draft.dispose();
  });

  it("ignores delayed autosave notifications when disk already matches the latest save", async () => {
    let disk = page;
    const backend = {
      saveMarkdownFile: vi.fn(
        async (_path, content) =>
          (disk = {
            ...page,
            content,
            version: content === "first" ? "v2" : "v3",
          }),
      ),
      getMarkdownFile: vi.fn(async () => disk),
    } as unknown as StorageBackend;
    const draft = new DocumentSaveController("a.md", page, backend);
    draft.edit("first");
    await draft.flushSave();
    draft.edit("second");
    await draft.flushSave();
    draft.edit("latest typing");
    await draft.onDiskEvent({ path: "a.md", exists: true, version: "v2" });
    expect(draft.diskState).toBe("clean");
    expect(draft.draft).toBe("latest typing");
    expect(await draft.flushSave()).toEqual({ status: "saved" });
    expect(disk.content).toBe("latest typing");
    draft.dispose();
  });

  it("reloads an external revert to an earlier locally saved version", async () => {
    const reverted = { ...page, content: "first", version: "v2" };
    const backend = {
      saveMarkdownFile: vi
        .fn()
        .mockResolvedValueOnce(reverted)
        .mockResolvedValueOnce({ ...page, content: "second", version: "v3" }),
      getMarkdownFile: vi.fn().mockResolvedValue(reverted),
    } as unknown as StorageBackend;
    const draft = new DocumentSaveController("a.md", page, backend);
    draft.edit("first");
    await draft.flushSave();
    draft.edit("second");
    await draft.flushSave();
    await draft.onDiskEvent({ path: "a.md", exists: true, version: "v2" });
    expect(backend.getMarkdownFile).toHaveBeenCalledTimes(1);
    expect(draft.getSnapshot().page.content).toBe("first");
    expect(draft.accepted.version).toBe("v2");
    draft.dispose();
  });

  it("blocks edits from saving during reload and retains edits made during its read", async () => {
    const read = deferred<typeof page>();
    const backend = {
      saveMarkdownFile: vi.fn(),
      getMarkdownFile: vi.fn(() => read.promise),
    } as unknown as StorageBackend;
    const draft = new DocumentSaveController("a.md", page, backend);
    const pending = draft.reload();
    draft.edit("new edit");
    expect(await draft.flushSave()).toEqual({ status: "blocked" });
    read.resolve({ ...page, content: "disk", version: "v2" });
    await pending;
    expect(draft.draft).toBe("new edit");
    expect(draft.diskState).toBe("changed");
    expect(backend.saveMarkdownFile).not.toHaveBeenCalled();
    draft.dispose();
  });

  it("does not read from the backend after disposal while waiting for a write on reload", async () => {
    const write = deferred<typeof page>();
    const backend = {
      saveMarkdownFile: vi.fn(() => write.promise),
      getMarkdownFile: vi.fn(),
    } as unknown as StorageBackend;
    const draft = new DocumentSaveController("a.md", page, backend);
    draft.edit("local");
    const saving = draft.flushSave();
    const reload = draft.reload();
    draft.dispose();
    write.resolve({ ...page, content: "local", version: "v2" });
    await Promise.all([saving, reload]);
    expect(backend.getMarkdownFile).not.toHaveBeenCalled();
  });

  it("blocks an external event during a dirty write", async () => {
    const write = deferred<typeof page>();
    const draft = controller(vi.fn(() => write.promise));
    draft.edit("local");
    const saving = draft.flushSave();
    const event = draft.onDiskEvent({
      path: "a.md",
      exists: true,
      version: "external",
    });
    write.resolve({ ...page, content: "local", version: "v2" });
    await Promise.all([saving, event]);
    expect(draft.diskState).toBe("changed");
    draft.edit("more local");
    expect(await draft.flushSave()).toEqual({ status: "blocked" });
    draft.dispose();
  });

  it("does not install a late external read after disposal or a live edit", async () => {
    for (const dispose of [false, true]) {
      const read = deferred<typeof page>();
      const backend = {
        getMarkdownFile: vi.fn(() => read.promise),
      } as unknown as StorageBackend;
      const draft = new DocumentSaveController("a.md", page, backend);
      const event = draft.onDiskEvent({
        path: "a.md",
        exists: true,
        version: "v2",
      });
      if (dispose) draft.dispose();
      else draft.edit("live edit");
      read.resolve({ ...page, content: "disk", version: "v2" });
      await event;
      expect(draft.draft).toBe(dispose ? "original" : "live edit");
      draft.dispose();
    }
  });
  it("updates a clean draft when accepting external disk content", () => {
    const draft = controller(vi.fn());
    draft.accept({ ...page, content: "external", version: "v2" });
    expect(draft.draft).toBe("external");
    expect(draft.dirty).toBe(false);
    draft.dispose();
  });

  it("serializes overwrites and flushes without overlapping backend writes", async () => {
    const first = deferred<typeof page>();
    const second = deferred<typeof page>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValue({ ...page, content: "latest", version: "v4" });
    const draft = controller(save);
    draft.edit("first");
    draft.setDiskState("changed");
    const overwrite = draft.overwrite();
    draft.edit("latest");
    const nextOverwrite = draft.overwrite();
    const flush = draft.flushSave();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ ...page, content: "first", version: "v2" });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    second.resolve({ ...page, content: "latest", version: "v3" });
    await Promise.all([overwrite, nextOverwrite, flush]);
    expect(save.mock.calls).toEqual([
      ["a.md", "first", { mode: "overwrite" }],
      ["a.md", "latest", { mode: "conditional", expectedVersion: "v2" }],
      ["a.md", "latest", { mode: "overwrite" }],
    ]);
    expect(draft.dirty).toBe(false);
    draft.dispose();
  });
  it("debounces edits and cancels a queued write when the disk changes", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const draft = controller(save);
    draft.edit("first");
    vi.advanceTimersByTime(300);
    draft.edit("second");
    vi.advanceTimersByTime(300);
    expect(save).not.toHaveBeenCalled();
    draft.setDiskState("changed");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
    expect(await draft.flushSave()).toEqual({ status: "blocked" });
    expect(draft.draft).toBe("second");
    draft.dispose();
  });

  it("flushes the newest edit after an in-flight save with the newly accepted version", async () => {
    const first = deferred<typeof page>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ...page, content: "final", version: "v3" });
    const draft = controller(save);
    draft.edit("intermediate");
    const pending = draft.flushSave();
    draft.edit("final");
    const handoff = draft.flushSave();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ ...page, content: "intermediate", version: "v2" });
    expect(await handoff).toEqual({ status: "saved" });
    expect(await pending).toEqual({ status: "saved" });
    expect(save.mock.calls).toEqual([
      ["a.md", "intermediate", { mode: "conditional", expectedVersion: "v1" }],
      ["a.md", "final", { mode: "conditional", expectedVersion: "v2" }],
    ]);
    expect(draft.dirty).toBe(false);
    draft.dispose();
  });

  it("blocks queued autosave on a conflict and allows an explicit overwrite", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new MarkdownFileConflictError("a.md"))
      .mockResolvedValueOnce({ ...page, content: "local", version: "v3" });
    const draft = controller(save);
    draft.edit("local");
    expect((await draft.flushSave()).status).toBe("error");
    expect(draft.diskState).toBe("conflict");
    expect(await draft.flushSave()).toEqual({ status: "blocked" });
    await draft.overwrite();
    expect(save.mock.calls).toEqual([
      ["a.md", "local", { mode: "conditional", expectedVersion: "v1" }],
      ["a.md", "local", { mode: "overwrite" }],
    ]);
    expect(draft.dirty).toBe(false);
    draft.dispose();
  });

  it("ignores a save result from before a forced disk reload", async () => {
    const write = deferred<typeof page>();
    const disk = { ...page, content: "disk", version: "v4" };
    const backend = {
      saveMarkdownFile: vi.fn(() => write.promise),
      getMarkdownFile: vi.fn(async () => disk),
    } as unknown as StorageBackend;
    const draft = new DocumentSaveController("a.md", page, backend);
    draft.edit("old edit");
    const pending = draft.flushSave();
    write.resolve({ ...page, content: "old edit", version: "v2" });
    await draft.reload();
    expect(await pending).toEqual({ status: "blocked" });
    expect(draft.draft).toBe("disk");
    expect(draft.accepted.version).toBe("v4");
    draft.dispose();
  });
});
