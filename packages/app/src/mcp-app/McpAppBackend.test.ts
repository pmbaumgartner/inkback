import { expect, it, vi } from "vitest";
import { McpAppBackend, type AppClient } from "./McpAppBackend";
import { MarkdownFileConflictError } from "../storage";
function fakeClient() {
  const call = vi.fn<AppClient["callServerTool"]>();
  const send = vi.fn<AppClient["sendMessage"]>().mockResolvedValue({});
  return { call, send, app: { callServerTool: call, sendMessage: send } };
}
function result(data: Record<string, unknown>) {
  return { content: [], structuredContent: data };
}
it("maps reads, saves, and conflicts to the shared editor contract", async () => {
  const { call, app } = fakeClient();
  const backend = new McpAppBackend(app, "/docs/draft.md");
  const page = {
    id: "draft",
    title: "Draft",
    content: "# Draft",
    version: "v1",
    writable: true,
    notWritableReason: null,
  };
  call.mockResolvedValueOnce(result(page));
  expect(await backend.getMarkdownFile("draft.md")).toEqual(page);
  call.mockResolvedValueOnce(
    result({ status: "conflict", current: { ...page, version: "v2" } }),
  );
  await expect(
    backend.saveMarkdownFile("draft.md", "Change", "v1"),
  ).rejects.toBeInstanceOf(MarkdownFileConflictError);
  expect(call).toHaveBeenLastCalledWith(
    {
      name: "inkback_save_file",
      arguments: {
        documentPath: "/docs/draft.md",
        content: "Change",
        expectedVersion: "v1",
      },
    },
    { signal: undefined },
  );
});
it("backs off polling failures, delivers changes, and aborts when stopped", async () => {
  vi.useFakeTimers();
  try {
    const { call, app } = fakeClient();
    const backend = new McpAppBackend(app, "/docs/draft.md");
    const change = vi.fn();
    call
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockRejectedValueOnce(new Error("Disconnected"));
    call.mockResolvedValueOnce(
      result({ changed: true, exists: true, version: "v2" }),
    );
    call.mockImplementationOnce(
      (_args, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("Stopped")),
          ),
        ),
    );
    const stop = backend.watchMarkdownFile("draft.md", change);
    await vi.advanceTimersByTimeAsync(999);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(change).toHaveBeenCalledWith({
      path: "draft.md",
      changed: true,
      exists: true,
      version: "v2",
    });
    const signal = call.mock.calls.at(-1)?.[1]?.signal;
    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(call).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});
it("previews the exact handoff and retries host delivery without repeating finish", async () => {
  const { call, send, app } = fakeClient();
  const backend = new McpAppBackend(app, "/docs/draft.md");
  call.mockResolvedValue(result({ message: "Exact preview", version: "v2" }));
  expect(await backend.prepareReview({ overallComment: "Note" })).toBe(
    "Exact preview",
  );
  send.mockRejectedValueOnce(new Error("Refused"));
  expect(
    await backend.completeReview("draft.md", { overallComment: "Note" }),
  ).toEqual({ delivered: false });
  expect(backend.handoffMessage).toBe("Exact preview");
  expect(
    await backend.completeReview("draft.md", { overallComment: "Note" }),
  ).toEqual({ delivered: true, state: "received" });
  expect(call).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenLastCalledWith({
    role: "user",
    content: [{ type: "text", text: "Exact preview" }],
  });
  expect(await backend.getReviewWatchStatus("draft.md")).toEqual({
    watching: true,
    watcherCount: 1,
    state: "received",
  });
});
