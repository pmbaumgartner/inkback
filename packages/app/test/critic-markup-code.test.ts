import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  parseDirect,
  serializeDirectDocument,
} from "../src/critic-markup/direct-parser";

import { createEditorExtensions } from "../src/editor-extensions";

const timestamp = "2026-04-25T22:14:08.827Z";
const commentMetadata = `{id="c1" by="user" at="${timestamp}"}`;
const suggestionMetadata = `{id="s1" by="AI" at="${timestamp}"}`;

describe("reviewing code fences", () => {
  it("keeps embedded fences literal when saving a commented Markdown example", () => {
    const input = [
      "````md",
      "```python",
      `value = {==1==}{>>Use two<<}${commentMetadata}`,
      "```",
      "````",
      "",
    ].join("\n");
    const { doc, comments } = parseDirect(input);
    expect(serializeDirectDocument(doc, comments)).toBe(input);
  });

  it("preserves code whitespace and literal syntax through an editor save and reload", () => {
    const input = [
      "```python",
      "",
      "def f():",
      `    value = {==1==}{>>Use two<<}${commentMetadata}`,
      "\treturn value  ",
      "",
      "",
      '# literal *stars*, _underscores_, <tags> & "quotes"',
      "",
      "print(f())",
      "",
      "",
      "```",
      "",
    ].join("\n");
    const parsed = parseDirect(input);
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: parsed.doc,
    });

    try {
      const saved = serializeDirectDocument(editor.getJSON(), parsed.comments);
      expect(saved).toBe(input);
      const reloaded = parseDirect(saved);
      expect(reloaded.doc).toEqual(parsed.doc);
      expect(reloaded.comments).toEqual(parsed.comments);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    ["addition", "{++", "++}"],
    ["deletion", "{--", "--}"],
  ] as const)("preserves whitespace in a multiline %s with a comment", (kind, open, close) => {
    const code = "def f():\n\tvalue = 1\n    return value  \n\nprint(f())\n";
    const selected = "\tvalue = 1\n    return value  ";
    const { doc } = parseDirect(`\`\`\`python\n${code}\n\`\`\`\n`);
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: doc,
    });
    const comments = new Map([
      ["c1", { id: "c1", content: "Review this", createdAt: timestamp }],
    ]);

    try {
      const from = code.indexOf(selected) + 1;
      editor.commands.setTextSelection({ from, to: from + selected.length });
      expect(
        editor.commands.setCriticChange({
          kind,
          changeId: "s1",
          authorType: "ai",
          createdAt: timestamp,
        }),
      ).toBe(true);
      expect(editor.commands.setCommentRef({ commentIds: ["c1"] })).toBe(true);
      expect(serializeDirectDocument(editor.getJSON(), comments)).toBe(
        `\`\`\`python\n${code.replace(selected, `${open}${selected}${close}${suggestionMetadata}{>>Review this<<}${commentMetadata}`)}\n\`\`\`\n`,
      );
    } finally {
      editor.destroy();
    }
  });

  it("preserves whitespace in both sides of a multiline substitution", () => {
    const oldText = "    old()\n\told_again()  ";
    const newText = "    new()\n\tnew_again()  ";
    const code = `def f():\n${oldText}${newText}\n`;
    const { doc } = parseDirect(`\`\`\`python\n${code}\n\`\`\`\n`);
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: doc,
    });

    try {
      const from = code.indexOf(oldText) + 1;
      editor.commands.setTextSelection({ from, to: from + oldText.length });
      editor.commands.setCriticChange({
        kind: "substitution-old",
        changeId: "s1",
        authorType: "ai",
        createdAt: timestamp,
      });
      editor.commands.setTextSelection({
        from: from + oldText.length,
        to: from + oldText.length + newText.length,
      });
      editor.commands.setCriticChange({
        kind: "substitution-new",
        changeId: "s1",
        authorType: "ai",
        createdAt: timestamp,
      });
      expect(serializeDirectDocument(editor.getJSON(), new Map())).toBe(
        `\`\`\`python\ndef f():\n{~~${oldText}~>${newText}~~}${suggestionMetadata}\n\n\`\`\`\n`,
      );
    } finally {
      editor.destroy();
    }
  });
});
