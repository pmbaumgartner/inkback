import type { App } from "@modelcontextprotocol/ext-apps";
import {
  type BackendInfo,
  type CompleteReviewOptions,
  type CompleteReviewResult,
  type MarkdownFileChangeEvent,
  MarkdownFileConflictError,
  type Page,
  type SaveIntent,
  type StorageBackend,
} from "../storage";
import { ImageCache } from "./image-cache";
export type AppClient = Pick<App, "callServerTool" | "sendMessage">;
export class McpAppBackend implements StorageBackend {
  info: BackendInfo;
  canManageProjects = false;
  reviewDelivery = "conversation" as const;
  writable = true;
  notWritableReason: string | null = null;
  handoffMessage: string | null = null;
  private images = new ImageCache();
  private version: string | null = null;
  private finishState: CompleteReviewResult["state"] = "waiting";
  private finishRequest: {
    requestId: string;
    overallComment?: string;
    message?: string;
  } | null = null;
  private loops = new Set<AbortController>();
  constructor(
    private app: AppClient,
    readonly documentPath: string,
  ) {
    this.info = {
      kind: "mcp-app",
      label: "MCP App",
      detail: documentPath.split(/[\\/]/).pop() ?? documentPath,
    };
  }
  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const result = await this.app.callServerTool(
      { name, arguments: { documentPath: this.documentPath, ...args } },
      { signal },
    );
    if (result.isError)
      throw new Error(
        result.content
          ?.map((block) => (block.type === "text" ? block.text : ""))
          .join("\n") || "Inkback operation failed.",
      );
    if (!result.structuredContent)
      throw new Error("Inkback returned no operation data.");
    return result.structuredContent as T;
  }
  async getMarkdownFile(_path: string) {
    const page = await this.call<
      Page & { writable: boolean; notWritableReason: string | null }
    >("inkback_read_file", {});
    this.writable = page.writable;
    this.notWritableReason = page.notWritableReason;
    this.version = page.version ?? null;
    await this.images.prefetch(page.content, (path) =>
      this.call("inkback_read_asset", { path }),
    );
    return page;
  }
  async saveMarkdownFile(_path: string, content: string, intent: SaveIntent) {
    const result = await this.call<
      { status: "saved"; page: Page } | { status: "conflict"; current: Page }
    >("inkback_save_file", { content, save: intent });
    if (result.status === "conflict")
      throw new MarkdownFileConflictError(result.current);
    this.version = result.page.version ?? null;
    return result.page;
  }
  watchMarkdownFile(
    _path: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ) {
    const controller = new AbortController();
    this.loops.add(controller);
    void (async () => {
      let sinceVersion = this.version;
      let delay = 1000;
      while (!controller.signal.aborted) {
        try {
          const change = await this.call<{
            changed: boolean;
            exists: boolean;
            version: string | null;
          }>(
            "inkback_poll_changes",
            { sinceVersion, timeoutSeconds: 25 },
            controller.signal,
          );
          if (controller.signal.aborted) break;
          delay = 1000;
          if (change.changed) {
            sinceVersion = change.version;
            onChange({ path: _path, ...change });
          }
        } catch {
          if (controller.signal.aborted) break;
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, delay);
            controller.signal.addEventListener("abort", done, { once: true });
          });
          delay = Math.min(delay * 2, 30_000);
        }
      }
      this.loops.delete(controller);
    })();
    return () => {
      controller.abort();
      this.loops.delete(controller);
    };
  }
  async prepareReview(options: CompleteReviewOptions = {}): Promise<string> {
    const overallComment = options.overallComment?.trim() || undefined;
    if (
      !this.finishRequest ||
      this.finishRequest.overallComment !== overallComment
    )
      this.finishRequest = { requestId: crypto.randomUUID(), overallComment };
    const request = this.finishRequest;
    if (!request.message) {
      const result = await this.call<{ message: string; version: string }>(
        "inkback_finish_review",
        { overallComment, requestId: request.requestId },
      );
      request.message = result.message;
      this.version = result.version;
    }
    this.handoffMessage = request.message;
    return request.message;
  }
  async completeReview(
    _path: string,
    options: CompleteReviewOptions = {},
  ): Promise<CompleteReviewResult> {
    const message = await this.prepareReview(options);
    try {
      const result = await this.app.sendMessage({
        role: "user",
        content: [{ type: "text", text: message }],
      });
      if (result.isError) throw new Error("Host refused the message.");
      this.finishState = "received";
      this.finishRequest = null;
      return { delivered: true, state: "received" };
    } catch {
      return { delivered: false };
    }
  }
  async getReviewWatchStatus(_path: string) {
    return { watching: true, watcherCount: 1, state: this.finishState };
  }
  async saveAsset(file: File) {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read image."));
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(file);
    });
    const { markdownPath } = await this.call<{ markdownPath: string }>(
      "inkback_save_asset",
      { filename: file.name, mimeType: file.type, dataBase64 },
    );
    return {
      markdownPath,
      previewUrl: this.images.set(markdownPath, file.type, dataBase64),
      mimeType: file.type,
    };
  }
  resolveFileUrl(path: string) {
    return this.images.get(path);
  }
  async openProject(_path: string) {}
  dispose() {
    for (const loop of this.loops) loop.abort();
    this.loops.clear();
  }
}
