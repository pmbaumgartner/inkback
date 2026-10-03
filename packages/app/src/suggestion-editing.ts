import { type CommandProps, Extension } from "@tiptap/core";
import type { Mark, Node } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { createCriticChange } from "./critic-markup/model";
import { SUGGESTED_PARAGRAPH_SENTINEL } from "./editor-extensions";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestionEditing: {
      suggestText: (
        text: string,
        range?: { from: number; to: number },
      ) => ReturnType;
      suggestDelete: (
        direction: "backward" | "forward" | "selection",
        word?: boolean,
      ) => ReturnType;
      suggestParagraph: () => ReturnType;
    };
  }
}

export function documentChangeIds(doc: Node) {
  const ids = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (
        mark.type.name === "criticChange" &&
        typeof mark.attrs.changeId === "string"
      )
        ids.add(mark.attrs.changeId);
    }
  });
  return [...ids].map((changeId) => ({ changeId }));
}
function isAddition(mark: Mark) {
  return (
    mark.type.name === "criticChange" &&
    (mark.attrs.kind === "addition" || mark.attrs.kind === "substitution-new")
  );
}
function segments(doc: Node, from: number, to: number) {
  const result: Array<{ from: number; to: number; addition: boolean }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    if (start >= end) return;
    const addition = node.marks.some(isAddition);
    const previous = result.at(-1);
    if (previous?.addition === addition && previous.to === start)
      previous.to = end;
    else result.push({ from: start, to: end, addition });
  });
  return result;
}
function adjacentMark(
  doc: Node,
  from: number,
  to: number,
  predicate: (mark: Mark) => boolean,
) {
  return (
    doc.resolve(from).nodeBefore?.marks.find(predicate) ??
    doc.resolve(to).nodeAfter?.marks.find(predicate)
  );
}
function insertSuggestion(
  { tr, dispatch }: CommandProps,
  text: string,
  from: number,
  to: number,
) {
  if (!text) return false;
  if (!dispatch) return true;
  const type = tr.doc.type.schema.marks.criticChange;
  const ranges = segments(tr.doc, from, to);
  const replacingOriginal = ranges.some((range) => !range.addition);
  const change = replacingOriginal
    ? createCriticChange("substitution-old", undefined, {
        existingChanges: documentChangeIds(tr.doc),
      })
    : null;
  for (const range of ranges.reverse()) {
    if (range.addition) tr.delete(range.from, range.to);
    else if (change) tr.addMark(range.from, range.to, type.create(change));
  }
  const position = tr.mapping.map(replacingOriginal ? to : from, -1);
  const mark = change
    ? type.create({ ...change, kind: "substitution-new" })
    : (adjacentMark(tr.doc, position, position, isAddition) ??
      type.create(
        createCriticChange("addition", undefined, {
          existingChanges: documentChangeIds(tr.doc),
        }),
      ));
  tr.insert(position, tr.doc.type.schema.text(text, [mark]));
  tr.setSelection(TextSelection.create(tr.doc, position + text.length));
  tr.scrollIntoView();
  return true;
}
function deleteSuggestion(
  { tr, dispatch }: CommandProps,
  direction: "backward" | "forward" | "selection",
  word: boolean,
) {
  const { selection } = tr;
  let { from, to } = selection;
  if (selection.empty && direction !== "selection") {
    const start = selection.$from.start();
    const end = selection.$from.end();
    if (direction === "backward") {
      const before = tr.doc.textBetween(start, from);
      from = word
        ? from -
          (before.match(/\S+\s*$/)?.[0].length ?? Math.min(1, before.length))
        : Math.max(start, from - 1);
    } else {
      const after = tr.doc.textBetween(to, end);
      to = word
        ? to + (after.match(/^\s*\S+/)?.[0].length ?? Math.min(1, after.length))
        : Math.min(end, to + 1);
    }
  }
  if (!dispatch || from === to) return true;
  const type = tr.doc.type.schema.marks.criticChange;
  for (const range of segments(tr.doc, from, to).reverse()) {
    if (range.addition) tr.delete(range.from, range.to);
    else {
      const mark =
        adjacentMark(
          tr.doc,
          range.from,
          range.to,
          (candidate) =>
            candidate.type === type && candidate.attrs.kind === "deletion",
        ) ??
        type.create(
          createCriticChange("deletion", undefined, {
            existingChanges: documentChangeIds(tr.doc),
          }),
        );
      tr.addMark(range.from, range.to, mark);
    }
  }
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      tr.mapping.map(direction === "backward" ? from : to, -1),
    ),
  );
  tr.scrollIntoView();
  return true;
}

export const SuggestionEditing = Extension.create<{
  isSuggesting: () => boolean;
}>({
  name: "suggestionEditing",
  priority: 1000,
  addOptions: () => ({ isSuggesting: () => false }),
  addCommands() {
    return {
      suggestText: (text, range) => (props) =>
        insertSuggestion(
          props,
          text,
          range?.from ?? props.tr.selection.from,
          range?.to ?? props.tr.selection.to,
        ),
      suggestDelete:
        (direction, word = false) =>
        (props) =>
          deleteSuggestion(props, direction, word),
      suggestParagraph:
        () =>
        ({ tr, dispatch }) => {
          const { selection } = tr;
          if (
            !selection.empty ||
            !selection.$from.parent.isTextblock ||
            selection.$from.parentOffset !== selection.$from.parent.content.size
          )
            return true;
          if (dispatch) {
            const change = createCriticChange("addition", undefined, {
              existingChanges: documentChangeIds(tr.doc),
            });
            tr.split(selection.from);
            const position = tr.selection.from;
            tr.insert(
              position,
              tr.doc.type.schema.text(SUGGESTED_PARAGRAPH_SENTINEL, [
                tr.doc.type.schema.marks.criticChange.create(change),
              ]),
            );
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                position + SUGGESTED_PARAGRAPH_SENTINEL.length,
              ),
            );
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const suggesting = this.options.isSuggesting;
    return [
      new Plugin({
        props: {
          handleTextInput: (_view, from, to, text) =>
            suggesting() && editor.commands.suggestText(text, { from, to }),
          handlePaste: (_view, event) => {
            if (!suggesting()) return false;
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;
            event.preventDefault();
            return editor.commands.suggestText(text);
          },
          handleKeyDown: (view, event) => {
            if (!suggesting()) return false;
            if (event.key === "Enter") {
              event.preventDefault();
              return editor.commands.suggestParagraph();
            }
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "x" &&
              !view.state.selection.empty
            ) {
              event.preventDefault();
              void navigator.clipboard.writeText(
                view.state.doc.textBetween(
                  view.state.selection.from,
                  view.state.selection.to,
                ),
              );
              return editor.commands.suggestDelete("selection");
            }
            if (event.key !== "Backspace" && event.key !== "Delete")
              return false;
            event.preventDefault();
            return editor.commands.suggestDelete(
              event.key === "Backspace" ? "backward" : "forward",
              event.ctrlKey || event.altKey,
            );
          },
        },
      }),
    ];
  },
});
