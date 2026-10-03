import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { setupDomMocks } from "../test/support/dom-mocks";
import { createReactHarness } from "../test/support/react-harness";
import { createMarkdownCodeEditorExtensions } from "./MarkdownCodeEditor";

describe("createMarkdownCodeEditorExtensions", () => {
  it("loads YAML frontmatter and Markdown content without rewriting the document", () => {
    const input = "---\ntitle: Code mode\n---\n\n# Body\n";
    const onChange = vi.fn();
    const state = EditorState.create({
      doc: input,
      extensions: createMarkdownCodeEditorExtensions(false, onChange, {
        current: input,
      }),
    });

    expect(state.doc.toString()).toBe(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});

it("keeps the current content and view when read-only changes", async () => {
  const { act } = await import("react");
  const { EditorView } = await import("@codemirror/view");
  const { MarkdownCodeEditor } = await import("./MarkdownCodeEditor");
  setupDomMocks();
  const harness = createReactHarness();
  const { container, root } = harness;
  const onChange = vi.fn();
  try {
    await act(async () =>
      root.render(<MarkdownCodeEditor value="Initial" onChange={onChange} />),
    );
    await act(async () =>
      root.render(<MarkdownCodeEditor value="Updated" onChange={onChange} />),
    );
    const element = container.querySelector(".cm-editor");
    if (!(element instanceof HTMLElement))
      throw new Error("Code editor did not mount");
    const view = EditorView.findFromDOM(element);
    await act(async () =>
      root.render(
        <MarkdownCodeEditor value="Updated" onChange={onChange} readOnly />,
      ),
    );
    expect(container.querySelector(".cm-editor")).toBe(element);
    expect(EditorView.findFromDOM(element)).toBe(view);
    expect(view?.state.doc.toString()).toBe("Updated");
    expect(view?.state.readOnly).toBe(true);
  } finally {
    await harness.cleanup();
    vi.restoreAllMocks();
  }
});
