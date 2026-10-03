import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSaveController } from "../src/DocumentSaveController";
import { DocumentWorkspace } from "../src/DocumentWorkspace";
import type {
  CompleteReviewOptions,
  CompleteReviewResult,
  Page,
} from "../src/storage";
import { createBackend } from "./support/backend";
import { setupDomMocks } from "./support/dom-mocks";
import { createReactHarness } from "./support/react-harness";

// Handoff behavior belongs to the workspace; editor integration is covered in
// page-card.test.tsx.
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

async function change(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
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

describe("review handoff watcher affordance", () => {
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
    document.body.replaceChildren();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  async function renderWorkspace({
    getWatcherCount,
    documentPath = "test.md",
    onCompleteReview = async () => ({ delivered: false }),
  }: {
    getWatcherCount: () => number;
    documentPath?: string;
    onCompleteReview?: (
      options?: CompleteReviewOptions,
    ) => Promise<CompleteReviewResult>;
  }) {
    await act(async () => {
      root.render(
        <DocumentWorkspace
          documentPage={{ ...createPage(), id: documentPath }}
          activeDocumentPath={documentPath}
          documentCopyPath={null}
          documentFilenameLabel="test.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          saveController={
            new DocumentSaveController(
              documentPath,
              { ...createPage(), id: documentPath },
              createBackend(),
            )
          }
          documentDiskChangeState="clean"
          onReloadDocumentFromDisk={() => {}}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={onCompleteReview}
          backend={createBackend({
            getReviewWatchStatus: async () => ({
              watching: getWatcherCount() > 0,
              watcherCount: getWatcherCount(),
            }),
          })}
        />,
      );
      await Promise.resolve();
    });
  }

  it("hides the done reviewing button when no agent is watching", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });

    await renderWorkspace({ getWatcherCount: () => 0, onCompleteReview });

    expect(container.textContent).not.toContain("Finish review");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
    expect(onCompleteReview).not.toHaveBeenCalled();
  });

  it("shows the review completion button when an agent is watching", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    expect(doneReviewingButton).toBeDefined();
    expect(doneReviewingButton?.textContent).toContain("Finish review");
    expect(container.textContent).not.toContain("Agent waiting");
    expect(queryByTestId(container, "review-handoff-status")).toBeNull();

    if (!doneReviewingButton) {
      throw new Error("Finish review button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(onCompleteReview).toHaveBeenCalledWith(undefined);
    expect(container.textContent).toContain("Finished");
    expect(queryByTestId(container, "review-handoff-status")).toBeNull();
    expect(container.textContent).not.toContain("Agent notified");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
  });

  it("fades the whole handoff split button after sending", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const splitButton = queryByTestId<HTMLDivElement>(
      container,
      "review-handoff-split-button",
    );
    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    const commentTrigger = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-comment-trigger",
    );
    if (!splitButton || !doneReviewingButton || !commentTrigger) {
      throw new Error("Review handoff split button not found");
    }

    await click(doneReviewingButton);

    expect(splitButton.className).toContain("opacity-50");
    expect(doneReviewingButton.className).toContain("disabled:opacity-100");
    expect(commentTrigger.className).toContain("disabled:opacity-100");
  });

  it("shows visible feedback when the watcher disappears before handoff delivery", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("Finish review button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Finished");
    expect(container.textContent).not.toContain("Finish review");
  });

  it("keeps Finish review available after the watcher disconnects", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });
    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });
    await renderWorkspace({ getWatcherCount: () => 0, onCompleteReview });

    const button = getByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    expect(button.textContent).toBe("Finish review");
    expect(button.disabled).toBe(false);
    await click(button);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    const status = getByTestId(document.body, "review-handoff-status");
    expect(status.textContent).toContain("Your review is saved");
    expect(status.textContent).toContain("No agent was connected");
    expect(queryByTestId(status, "review-handoff-copy-message")).not.toBeNull();
  });

  it("does not carry a previous document's watcher into an unwatched file", async () => {
    await renderWorkspace({ getWatcherCount: () => 1 });
    await renderWorkspace({ getWatcherCount: () => 0 });
    expect(queryByTestId(container, "review-handoff-button")).not.toBeNull();

    await renderWorkspace({
      getWatcherCount: () => 0,
      documentPath: "other.md",
    });
    expect(queryByTestId(container, "review-handoff-button")).toBeNull();
  });

  it("ignores a previous document's in-flight completion after navigating", async () => {
    let resolveCompletion: (result: CompleteReviewResult) => void = () => {};
    const onCompleteReview = vi.fn(
      () =>
        new Promise<CompleteReviewResult>((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });
    await click(getByTestId(container, "review-handoff-button"));
    expect(onCompleteReview).toHaveBeenCalledOnce();

    await renderWorkspace({
      getWatcherCount: () => 0,
      documentPath: "other.md",
    });
    await act(async () => resolveCompletion({ delivered: true }));
    expect(queryByTestId(container, "review-handoff-button")).toBeNull();
    expect(queryByTestId(document.body, "review-handoff-status")).toBeNull();
  });

  it("lets a failed handoff be retried without losing the overall comment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onCompleteReview = vi
      .fn<(options?: CompleteReviewOptions) => Promise<CompleteReviewResult>>()
      .mockRejectedValueOnce(new Error("Server unavailable"))
      .mockResolvedValueOnce({ delivered: false });
    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });
    await click(getByTestId(container, "review-handoff-comment-trigger"));
    await change(
      getByTestId<HTMLTextAreaElement>(
        document.body,
        "review-handoff-overall-comment",
      ),
      "Please follow up.",
    );
    await click(getByTestId(container, "review-handoff-button"));

    const status = getByTestId(document.body, "review-handoff-status");
    expect(status.textContent).toContain("Could not finish review");
    const retry = getByTestId(status, "review-handoff-retry");
    await click(retry);
    expect(onCompleteReview).toHaveBeenLastCalledWith({
      overallComment: "Please follow up.",
    });
    expect(onCompleteReview).toHaveBeenCalledTimes(2);
    expect(
      getByTestId(document.body, "review-handoff-status").textContent,
    ).toContain("Your review is saved");
  });

  it("submits an overall comment from the handoff popover", async () => {
    const onCompleteReview = vi
      .fn<(options?: CompleteReviewOptions) => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const commentTrigger = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-comment-trigger",
    );
    if (!commentTrigger) {
      throw new Error("Review handoff comment trigger not found");
    }

    await click(commentTrigger);

    const textarea = queryByTestId<HTMLTextAreaElement>(
      document.body,
      "review-handoff-overall-comment",
    );
    if (!textarea) {
      throw new Error("Overall comment textarea not found");
    }
    expect(textarea.getAttribute("placeholder")).toBe("Overall comment");
    expect(document.body.textContent).not.toContain("Overall comment");

    await change(textarea, "  Please prioritize the CLI contract.  ");

    const submitButton = queryByTestId<HTMLButtonElement>(
      document.body,
      "review-handoff-submit-comment",
    );
    if (!submitButton) {
      throw new Error("Submit with comment button not found");
    }
    await click(submitButton);

    expect(onCompleteReview).toHaveBeenCalledWith({
      overallComment: "Please prioritize the CLI contract.",
    });
    expect(document.body.textContent).not.toContain(
      "Please prioritize the CLI contract.",
    );
  });

  it("includes an overall comment when finishing from the primary handoff button", async () => {
    const onCompleteReview = vi
      .fn<(options?: CompleteReviewOptions) => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const commentTrigger = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-comment-trigger",
    );
    if (!commentTrigger) {
      throw new Error("Review handoff comment trigger not found");
    }

    await click(commentTrigger);

    const textarea = queryByTestId<HTMLTextAreaElement>(
      document.body,
      "review-handoff-overall-comment",
    );
    if (!textarea) {
      throw new Error("Overall comment textarea not found");
    }

    await change(textarea, "  Please prioritize the CLI contract.  ");

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("Finish review button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledWith({
      overallComment: "Please prioritize the CLI contract.",
    });
  });

  it("keeps visible sent feedback after the watcher receives the event", async () => {
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("Finish review button not found");
    }

    await click(doneReviewingButton);
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Finished");
    expect(container.textContent).not.toContain("Agent notified");
    expect(container.textContent).not.toContain("Finish review");
  });

  it("lets a new watcher start another handoff after sent feedback", async () => {
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("Finish review button not found");
    }

    await click(doneReviewingButton);
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    expect(container.textContent).toContain("Finished");
    expect(container.textContent).not.toContain("Finish review");

    watcherCount = 1;
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Finish review");
    expect(container.textContent).not.toContain("Finished");
  });

  it("reopens the sent popover from the muted primary button", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => {});
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = getByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Finished");
    expect(document.body.textContent).toContain("Review complete");
    expect(document.body.textContent).toContain(
      "Your review is saved. An agent was connected when you finished, but receipt has not been confirmed.",
    );
    expect(queryByTestId(document.body, "review-handoff-status")).toBeDefined();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(queryByTestId(document.body, "review-handoff-status")).toBeNull();

    const sentButton = getByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    expect(sentButton.disabled).toBe(false);

    await click(sentButton);

    expect(onCompleteReview).toHaveBeenCalledTimes(1);
    expect(queryByTestId(document.body, "review-handoff-status")).toBeDefined();

    const copyLink = queryByTestId<HTMLButtonElement>(
      document.body,
      "review-handoff-copy-message",
    );
    expect(copyLink).toBeDefined();
    if (!copyLink) {
      throw new Error("Review handoff fallback copy link not found");
    }

    await click(copyLink);

    expect(writeText).toHaveBeenCalledWith(
      "I am done reviewing this file: test.md",
    );

    await click(getByTestId(document.body, "review-handoff-close-window"));

    expect(closeWindow).toHaveBeenCalled();
  });
});
