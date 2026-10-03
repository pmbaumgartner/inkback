import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  getDocumentEditorViewModeFromLocation,
} from "../src/app-navigation";
import { DocumentSaveController } from "../src/DocumentSaveController";
import { DocumentWorkspace } from "../src/DocumentWorkspace";
import type { Page } from "../src/storage";
import { createBackend } from "./support/backend";
import { setupDomMocks } from "./support/dom-mocks";
import { createReactHarness } from "./support/react-harness";

function createPage(content = "Hello world"): Page {
  return {
    id: "test-doc",
    title: "Test Doc",
    content,
  };
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

describe("document view navigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("buildLocationForDocumentEditorViewMode produces a URL for history.replaceState", () => {
    window.history.replaceState(
      null,
      "",
      "/?path=/test/doc.md&editor=rich-text",
    );

    const nextLocation = buildLocationForDocumentEditorViewMode("code");

    expect(nextLocation).toContain("editor=code");
    expect(typeof nextLocation).toBe("string");
  });

  it("view mode can be read from the URL query param", () => {
    window.history.replaceState(null, "", "/?editor=rich-text");
    expect(getDocumentEditorViewModeFromLocation("rich-text")).toBe(
      "rich-text",
    );

    window.history.replaceState(null, "", "/?editor=code");
    expect(getDocumentEditorViewModeFromLocation("rich-text")).toBe("code");
  });

  it("buildLocationForDocumentEditorViewMode returns the expected path+search", () => {
    window.history.replaceState(null, "", "/doc.md?editor=rich-text");

    const result = buildLocationForDocumentEditorViewMode("code");

    expect(result).toBe("/doc.md?editor=code");
  });
});

describe("interaction mode across view changes", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    ({ container, root } = createReactHarness());
    setupDomMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("interaction mode is preserved when view mode changes without remount", async () => {
    // With the fix, view mode changes use React state (no page reload),
    // so the DocumentWorkspace component stays mounted and interaction
    // mode is preserved.

    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const renderWorkspace = async (viewMode: DocumentEditorViewMode) => {
      await act(async () => {
        root.render(
          <DocumentWorkspace
            documentPage={createPage()}
            activeDocumentPath="test.md"
            documentFilenameLabel="test.md"
            documentEditorViewMode={viewMode}
            onDocumentEditorViewModeChange={() => {}}
            saveController={
              new DocumentSaveController(
                "test.md",
                createPage(),
                createBackend(),
                () => {},
              )
            }
            documentDiskChangeState="clean"
            onReloadDocumentFromDisk={() => {}}
            onKeepEditingWithoutAutosave={() => {}}
            onOverwriteDocumentOnDisk={() => {}}
            onCompleteReview={async () => ({ delivered: false })}
            backend={createBackend()}
          />,
        );
      });
    };

    // Mount with rich-text -> mode is "Suggesting" by default
    await renderWorkspace("rich-text");
    expect(
      getByTestId(container, "document-mode-trigger").textContent,
    ).toContain("Suggesting");

    // Rerender with code view (same component instance, no remount) ->
    // mode stays "Suggesting" because the component is not destroyed.
    await renderWorkspace("code");
    expect(
      getByTestId(container, "document-mode-trigger").textContent,
    ).toContain("Suggesting");
  });
});
