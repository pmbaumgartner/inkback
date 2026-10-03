import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSaveState } from "../src/DocumentSaveController";
import { DocumentSaveController } from "../src/DocumentSaveController";
import {
  DocumentSaveStatusIndicator,
  DocumentWorkspace,
} from "../src/DocumentWorkspace";
import type { Page } from "../src/storage";
import {
  getReviewHandoffButtonLabel,
  isReviewHandoffDisabled,
} from "../src/useReviewHandoff";
import { createBackend } from "./support/backend";
import { setupDomMocks } from "./support/dom-mocks";
import { createReactHarness } from "./support/react-harness";

// File actions use the page's Markdown, not the editor. Keep these tests focused
// on workspace controls; page-card.test.tsx exercises the real editor.
vi.mock("../src/PageCard", () => ({ PageCard: () => null }));

function createPage(content = "Hello world"): Page {
  return {
    id: "test-doc",
    title: "Test Doc",
    content,
  };
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function queryByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  return container.querySelector<T>(`[data-testid="${testId}"]`);
}

function getByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  const element = queryByTestId<T>(container, testId);
  expect(element).not.toBeNull();
  return element as T;
}

describe("workspace save status", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    ({ container, root } = createReactHarness());
    setupDomMocks();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    Reflect.deleteProperty(globalThis, "ClipboardItem");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderSaveStatus({
    saveState = "saved",
    documentDiskChangeState = "clean",
  }: {
    saveState?: DocumentSaveState;
    documentDiskChangeState?: "clean" | "changed" | "conflict" | "paused";
  } = {}) {
    await act(async () => {
      root.render(
        <DocumentSaveStatusIndicator
          saveState={saveState}
          diskChangeState={documentDiskChangeState}
        />,
      );
      await Promise.resolve();
    });
  }

  async function renderWorkspace({
    documentDiskChangeState = "clean",
    documentContent = "Hello world",
    documentCopyPath = "test.md",
    watcherCount = 0,
    onSaveDocument = async () => {},
  }: {
    documentDiskChangeState?: "clean" | "changed" | "conflict" | "paused";
    documentContent?: string;
    documentCopyPath?: string | null;
    watcherCount?: number;
    onSaveDocument?: (id: string, content: string) => Promise<void>;
  } = {}) {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    await act(async () => {
      root.render(
        <DocumentWorkspace
          documentPage={createPage(documentContent)}
          activeDocumentPath="test.md"
          documentCopyPath={documentCopyPath}
          documentFilenameLabel="test.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          saveController={
            new DocumentSaveController("test.md", createPage(documentContent), {
              ...createBackend({
                getReviewWatchStatus: async () => ({
                  watching: watcherCount > 0,
                  watcherCount,
                }),
              }),
              saveMarkdownFile: async (_path, content) => {
                await onSaveDocument("test.md", content);
                return undefined;
              },
            })
          }
          documentDiskChangeState={documentDiskChangeState}
          onReloadDocumentFromDisk={() => {}}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={async () => ({ delivered: false })}
          backend={createBackend({
            getReviewWatchStatus: async () => ({
              watching: watcherCount > 0,
              watcherCount,
            }),
          })}
        />,
      );
      await Promise.resolve();
    });
  }

  async function openFileMenu() {
    await click(getByTestId(container, "document-file-menu-trigger"));
    return getByTestId(document.body, "document-file-menu");
  }

  it.each([
    ["saved", "Saved", "document-save-status-saved"],
    ["saving", "Saving", "animate-spin"],
    ["unsaved", "Unsaved changes", "animate-spin"],
    ["error", "Save failed", ""],
  ] satisfies Array<
    [DocumentSaveState, string, string]
  >)("shows icon-only %s save status", async (saveState, label, iconClass) => {
    await renderSaveStatus({ saveState });

    const status = getByTestId(container, "document-save-status");
    expect(status.getAttribute("aria-label")).toBe(label);
    expect(status.textContent).toBe("");
    const icon = getByTestId(status, "document-save-status-icon");
    if (iconClass) {
      expect(icon.classList.contains(iconClass)).toBe(true);
    }
  });

  it.each([
    ["changed", "File changed on disk"],
    ["conflict", "Save conflict"],
    ["paused", "Autosave paused"],
  ] as const)("shows disk-blocked %s save status", async (state, label) => {
    await renderSaveStatus({ documentDiskChangeState: state });

    const status = getByTestId(container, "document-save-status");
    expect(status.getAttribute("aria-label")).toBe(label);
    expect(status.textContent).toBe("");
    expect(getByTestId(status, "document-save-status-icon")).not.toBeNull();
  });

  it("renders save status in the fixed corner when handoff exists", async () => {
    await renderWorkspace({ watcherCount: 1 });

    const stack = queryByTestId(container, "document-status-stack");
    const header = getByTestId(container, "document-page-header");
    const corner = getByTestId(container, "document-save-status-corner");
    const doneReviewingButton = queryByTestId(
      container,
      "review-handoff-button",
    );
    expect(stack).not.toBeNull();
    expect(doneReviewingButton).toBeDefined();
    expect(doneReviewingButton?.textContent).toContain("Finish review");
    expect(doneReviewingButton?.textContent).not.toContain("Saved");
    expect(stack?.textContent).not.toContain("Saved");
    expect(header.textContent).toContain("test.md");
    expect(header.textContent).not.toContain("Saved");
    expect(queryByTestId(header, "document-save-status")).toBeNull();
    expect(
      getByTestId(corner, "document-save-status").getAttribute("aria-label"),
    ).toBe("Saved");
  });

  it("renders save status in the fixed corner without handoff", async () => {
    await renderWorkspace();

    const stack = queryByTestId(container, "document-status-stack");
    const header = getByTestId(container, "document-page-header");
    const corner = getByTestId(container, "document-save-status-corner");
    expect(stack).not.toBeNull();
    expect(stack?.textContent).not.toContain("Finish review");
    expect(stack?.textContent).not.toContain("Saved");
    expect(header.textContent).toContain("test.md");
    expect(header.textContent).not.toContain("Saved");
    expect(queryByTestId(header, "document-save-status")).toBeNull();
    expect(
      getByTestId(corner, "document-save-status").getAttribute("aria-label"),
    ).toBe("Saved");
  });

  it.each([
    ["path", "/Users/me/project/test.md"],
    ["filename", "test.md"],
    ["markdown", "# Heading\n\nBody"],
  ] as const)("copies document %s from the file menu", async (action, text) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await renderWorkspace({
      documentContent: "# Heading\n\nBody",
      documentCopyPath: "/Users/me/project/test.md",
    });
    await openFileMenu();
    await click(getByTestId(document.body, `document-file-menu-${action}`));

    expect(writeText).toHaveBeenCalledWith(text);
  });

  it("keeps the file menu open and shows temporary copied feedback", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await renderWorkspace({ documentContent: "# Heading\n\nBody" });
    await openFileMenu();
    await click(getByTestId(document.body, "document-file-menu-path"));

    const menu = getByTestId(document.body, "document-file-menu");
    expect(menu.textContent).toContain("Copied!");
    expect(menu.textContent).not.toContain("Copy:");

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(
      getByTestId(document.body, "document-file-menu").textContent,
    ).toContain("Path");
    vi.useRealTimers();
  });

  it("shows copy previews below each file menu action", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    await renderWorkspace({ documentContent: "# Heading\n\nBody" });
    await openFileMenu();

    const menu = getByTestId(document.body, "document-file-menu");
    expect(menu.textContent).toContain("Path");
    expect(menu.textContent).toContain("test.md");
    expect(menu.textContent).toContain("Filename");
    expect(menu.textContent).toContain("Markdown");
    expect(menu.textContent).toContain("# Heading Body");
    expect(menu.textContent).toContain("Rich text");
    const richTextAction = getByTestId(
      document.body,
      "document-file-menu-rich-text",
    );
    expect(richTextAction.textContent).toContain("Heading Body");
    expect(richTextAction.textContent).not.toContain("# Heading");
  });

  it("copies document rich text with html and plain markdown flavors", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardItems: Array<Record<string, Blob>> = [];
    class ClipboardItemMock {
      items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
        clipboardItems.push(items);
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: ClipboardItemMock,
    });

    await renderWorkspace({ documentContent: "# Heading\n\nBody" });
    await openFileMenu();
    await click(getByTestId(document.body, "document-file-menu-rich-text"));

    expect(clipboardItems).toHaveLength(1);
    expect(clipboardItems[0]).toEqual({
      "text/html": expect.any(Blob),
      "text/plain": expect.any(Blob),
    });
    await expect(clipboardItems[0]["text/html"].text()).resolves.toContain(
      "<h1>Heading</h1>",
    );
    await expect(clipboardItems[0]["text/plain"].text()).resolves.toBe(
      "Heading\nBody",
    );
    expect(write).toHaveBeenCalledWith([
      expect.objectContaining({ items: expect.any(Object) }),
    ]);
  });

  it("strips comments and suggestions from copied rich text", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardItems: Array<Record<string, Blob>> = [];
    class ClipboardItemMock {
      items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
        clipboardItems.push(items);
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: ClipboardItemMock,
    });

    await renderWorkspace({
      documentContent:
        'Keep {==the launch date==}{>>Verify this.<<}{#c1}, omit {++new claim++}{#s1}, keep {--old claim--}{#s2}, and use {~~rough~>polished~~}{#s3} wording.\n\n{>>Standalone note<<}{#c2}\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-04-28T12:00:00.000Z"\n  c2:\n    by: user\n    at: "2026-04-28T12:01:00.000Z"\nsuggestions:\n  s1:\n    by: AI\n    at: "2026-04-28T12:02:00.000Z"\n  s2:\n    by: AI\n    at: "2026-04-28T12:03:00.000Z"\n  s3:\n    by: AI\n    at: "2026-04-28T12:04:00.000Z"\n',
    });
    await openFileMenu();
    await click(getByTestId(document.body, "document-file-menu-rich-text"));

    const html = await clipboardItems[0]["text/html"].text();
    const plain = await clipboardItems[0]["text/plain"].text();

    expect(html).toContain("Keep the launch date");
    expect(html).toContain("old claim");
    expect(html).toContain("rough");
    expect(html).not.toContain("Verify this");
    expect(html).not.toContain("Standalone note");
    expect(html).not.toContain("new claim");
    expect(html).not.toContain("polished");
    expect(html).not.toContain("data-comment-ids");
    expect(html).not.toContain("data-critic-change-kind");
    expect(plain).toBe(
      "Keep the launch date, omit , keep old claim, and use rough wording.",
    );
  });

  it.each([
    ["Meta+S", { key: "s", metaKey: true }],
    ["Control+S", { key: "s", ctrlKey: true }],
  ])("prevents browser save on %s", async (_label, init) => {
    const onSaveDocument = vi.fn().mockResolvedValue(undefined);
    await renderWorkspace({ onSaveDocument });

    const event = new KeyboardEvent("keydown", {
      ...init,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it("prevents browser save even when disk conflict blocks persistence", async () => {
    const onSaveDocument = vi.fn().mockResolvedValue(undefined);
    await renderWorkspace({
      documentDiskChangeState: "conflict",
      onSaveDocument,
    });

    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onSaveDocument).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Save conflict");
  });

  it("shows conflict status without replacing the existing conflict banner", async () => {
    await renderWorkspace({ documentDiskChangeState: "conflict" });

    expect(container.textContent).toContain("Save conflict");
    expect(container.textContent).toContain("This file changed on disk");
    expect(
      getByTestId(container, "document-save-status").getAttribute("aria-label"),
    ).toBe("Save conflict");
  });

  it.each([
    ["error", "clean"],
    ["saved", "conflict"],
  ] satisfies Array<
    [DocumentSaveState, "clean" | "changed" | "conflict" | "paused"]
  >)("keeps handoff disabled for save state %s and disk state %s", (saveState, documentDiskChangeState) => {
    expect(
      isReviewHandoffDisabled({
        saveState,
        documentDiskChangeState,
        reviewHandoffState: "idle",
      }),
    ).toBe(true);
  });

  it.each([
    "saving",
    "unsaved",
  ] satisfies DocumentSaveState[])("keeps handoff enabled while a debounced save is pending (save state %s)", (saveState) => {
    // The button must not dim on every keystroke while autosave debounces; it
    // stays enabled and flushes the pending save on click instead.
    expect(
      isReviewHandoffDisabled({
        saveState,
        documentDiskChangeState: "clean",
        reviewHandoffState: "idle",
      }),
    ).toBe(false);
  });

  it("allows handoff when saved, conflict-free, and idle", () => {
    expect(
      isReviewHandoffDisabled({
        saveState: "saved",
        documentDiskChangeState: "clean",
        reviewHandoffState: "idle",
      }),
    ).toBe(false);
  });

  it("uses a stable completion label for an idle review", () => {
    expect(getReviewHandoffButtonLabel({ reviewHandoffState: "idle" })).toBe(
      "Finish review",
    );
  });
});
