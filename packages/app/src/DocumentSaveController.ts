import {
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";

export type DocumentSaveState = "saved" | "unsaved" | "saving" | "error";
export type ManualSaveResult =
  | { status: "saved" }
  | { status: "blocked" }
  | { status: "error"; error: unknown };
export type DiskChangeState = "clean" | "changed" | "conflict" | "paused";

/** A single document's draft and persistence queue. Never shares a write with another document. */
export class DocumentSaveController {
  draft: string;
  accepted: Page;
  diskState: DiskChangeState = "clean";
  status: DocumentSaveState = "saved";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private generation = 0;
  private editRevision = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: {
    page: Page;
    status: DocumentSaveState;
    diskState: DiskChangeState;
    dirty: boolean;
  };

  constructor(
    readonly path: string,
    page: Page,
    private backend: StorageBackend,
  ) {
    this.accepted = page;
    this.draft = page.content;
    this.snapshot = this.makeSnapshot();
  }

  get dirty() {
    return this.draft !== this.accepted.content;
  }
  private makeSnapshot() {
    return {
      page: { ...this.accepted, content: this.draft },
      status: this.status,
      diskState: this.diskState,
      dirty: this.dirty,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((listener) => {
      listener();
    });
  }
  async onDiskEvent(event: {
    path: string;
    exists: boolean;
    version?: string | null;
  }) {
    if (this.disposed || event.path !== this.path) return;
    const generation = this.generation;
    const writing = this.writing;
    const wasDirty = this.dirty;
    if (writing) {
      try {
        await writing;
      } catch {
        /* the event still needs reconciliation */
      }
    }
    if (
      this.disposed ||
      generation !== this.generation ||
      this.diskState === "paused"
    )
      return;
    if (
      event.exists &&
      event.version &&
      event.version === this.accepted.version
    )
      return;
    if (
      !event.exists ||
      wasDirty ||
      this.dirty ||
      this.writing ||
      this.status === "saving"
    ) {
      this.setDiskState("changed");
      return;
    }
    const accepted = this.accepted;
    const revision = this.editRevision;
    try {
      const page = await this.backend.getMarkdownFile(this.path);
      if (
        this.disposed ||
        generation !== this.generation ||
        accepted !== this.accepted ||
        revision !== this.editRevision ||
        this.dirty ||
        this.writing ||
        this.diskState !== "clean"
      )
        return;
      this.accept(page);
    } catch (error) {
      console.error("Failed to reload changed markdown file:", error);
    }
  }
  private cancelTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  edit(content: string) {
    if (this.disposed) return;
    this.draft = content;
    this.editRevision++;
    this.cancelTimer();
    this.status =
      this.diskState === "clean"
        ? this.dirty
          ? "saving"
          : "saved"
        : this.dirty
          ? "unsaved"
          : "saved";
    this.changed();
    if (this.dirty && this.diskState === "clean")
      this.timer = setTimeout(() => {
        void this.flushSave();
      }, 500);
  }
  setDiskState(state: DiskChangeState) {
    this.diskState = state;
    if (state !== "clean") {
      this.cancelTimer();
      this.status = this.dirty ? "unsaved" : "saved";
    }
    this.changed();
  }
  accept(page: Page, force = false) {
    if (this.disposed) return;
    if (!force && (this.dirty || this.writing)) return;
    if (force) this.generation++;
    this.accepted = page;
    this.draft = page.content;
    this.status = "saved";
    this.changed();
  }
  async flushSave(): Promise<ManualSaveResult> {
    this.cancelTimer();
    if (this.disposed || this.diskState !== "clean")
      return { status: "blocked" };
    while (this.writing) {
      try {
        await this.writing;
      } catch (error) {
        return { status: "error", error };
      }
      if (this.disposed || this.diskState !== "clean")
        return { status: "blocked" };
    }
    if (!this.dirty) {
      this.status = "saved";
      this.changed();
      return { status: "saved" };
    }
    const content = this.draft;
    const accepted = this.accepted;
    const generation = this.generation;
    this.status = "saving";
    this.changed();
    const write = (async () => {
      const saved = await this.backend.saveMarkdownFile(
        this.path,
        content,
        accepted.version,
      );
      if (this.disposed || generation !== this.generation) return;
      const firstLine = content.split("\n")[0] || "";
      this.accepted = saved ?? {
        ...accepted,
        content,
        title: firstLine.replace(/^#*\s*/, "") || accepted.title,
      };
      this.status = this.dirty ? "saving" : "saved";
      this.changed();
    })();
    this.writing = write;
    try {
      await write;
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        if (error instanceof MarkdownFileConflictError)
          this.diskState = "conflict";
        this.status = "error";
        this.changed();
      }
      return { status: "error", error };
    } finally {
      if (this.writing === write) this.writing = null;
    }
    if (
      this.disposed ||
      generation !== this.generation ||
      this.diskState !== "clean"
    )
      return { status: "blocked" };
    return this.dirty ? this.flushSave() : { status: "saved" };
  }
  async reload() {
    const generation = ++this.generation;
    const editRevision = this.editRevision;
    this.setDiskState("changed");
    if (this.writing) {
      try {
        await this.writing;
      } catch {
        /* reload obtains the authoritative disk version */
      }
    }
    if (this.disposed || generation !== this.generation) return;
    const page = await this.backend.getMarkdownFile(this.path);
    if (this.disposed || generation !== this.generation) return;
    if (this.editRevision !== editRevision) {
      this.setDiskState("changed");
      return;
    }
    this.accept(page, true);
    this.setDiskState("clean");
  }
  async overwrite() {
    this.cancelTimer();
    const generation = this.generation;
    while (this.writing) {
      try {
        await this.writing;
      } catch {
        /* conflict is expected before an explicit overwrite */
      }
    }
    if (this.disposed || generation !== this.generation) return;
    const content = this.draft;
    this.status = "saving";
    this.changed();
    const write = (async () => {
      const page = await this.backend.saveMarkdownFile(this.path, content);
      if (this.disposed || generation !== this.generation) return;
      this.accepted = page ?? { ...this.accepted, content };
      this.diskState = "clean";
      this.status = this.dirty ? "saving" : "saved";
      this.changed();
    })();
    this.writing = write;
    try {
      await write;
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.status = "error";
        this.changed();
      }
      throw error;
    } finally {
      if (this.writing === write) this.writing = null;
    }
    if (!this.disposed && generation === this.generation && this.dirty)
      await this.flushSave();
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.cancelTimer();
    this.listeners.clear();
  }
}
