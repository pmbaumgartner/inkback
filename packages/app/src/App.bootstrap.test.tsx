import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { StorageBackend } from "./storage";
const renderWorkspace = vi.hoisted(() => vi.fn());
vi.mock("./DocumentWorkspace", () => ({
  DocumentWorkspace: (props: unknown) => {
    renderWorkspace(props);
    return <div>Review workspace</div>;
  },
}));
vi.mock("./detect-backend", () => ({
  detectBackend: () => {
    throw new Error("Sandbox has no browser API backend");
  },
}));
import { App } from "./App";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("opens a supplied document and switches view mode in a sandbox without browser navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "EventSource",
    class {
      constructor() {
        throw new Error("Sandbox cannot use EventSource");
      }
    },
  );
  const history = vi
    .spyOn(window.history, "replaceState")
    .mockImplementation(() => {
      throw new Error("Sandbox cannot mutate its URL");
    });
  const backend: StorageBackend = {
    info: { kind: "mcp-app", label: "MCP App", detail: "draft.md" },
    canManageProjects: false,
    getMarkdownFile: vi.fn().mockResolvedValue({
      id: "draft",
      title: "Draft",
      content: "# Draft",
      version: "v1",
    }),
    saveMarkdownFile: vi.fn(),
    saveAsset: vi.fn(),
    resolveFileUrl: () => null,
    openProject: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <App bootstrap={{ backend, documentPath: "/docs/draft.md" }} />,
      ),
    );
    expect(container.textContent).toContain("Review workspace");
    expect(backend.getMarkdownFile).toHaveBeenCalledWith("draft.md");
    const props = renderWorkspace.mock.calls.at(-1)?.[0] as {
      documentCopyPath: string;
      onDocumentEditorViewModeChange: (mode: string) => void;
      documentEditorViewMode: string;
    };
    expect(props.documentCopyPath).toBe("/docs/draft.md");
    await act(async () => props.onDocumentEditorViewModeChange("code"));
    expect(renderWorkspace.mock.calls.at(-1)?.[0].documentEditorViewMode).toBe(
      "code",
    );
    expect(history).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
