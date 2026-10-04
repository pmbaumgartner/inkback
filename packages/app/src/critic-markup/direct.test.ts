import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createEditorExtensions } from "../editor-extensions";
import { parseDirect, serializeDirectDocument } from "./direct-parser";

describe("direct Markdown persistence", () => {
  it("preserves CRLF, references and reviewed code through schema normalization", () => {
    const input =
      '# Title\r\n\r\n[link][ref]\r\n\r\n[ref]: https://example.com\r\n\r\n```js\r\n{++new++}{id="change" by="AI" at="2024-01-01T00:00:00Z"}\r\n```\r\n';
    const { doc, comments } = parseDirect(input);
    const normalized = getSchema(createEditorExtensions(""))
      .nodeFromJSON(doc)
      .toJSON();
    expect(
      serializeDirectDocument(
        { ...doc, content: normalized.content },
        comments,
      ),
    ).toBe(input);
  });

  it("does not introduce unsafe links from source or resolver", () => {
    for (const input of ["[bad](javascript:alert(1))", "[bad](relative)"]) {
      const { doc } = parseDirect(input, {
        resolveLinkUrl: () => "javascript:alert(1)",
      });
      expect(JSON.stringify(doc.content)).not.toContain('"href":"javascript:');
    }
  });

  it("keeps unsafe raw HTML inert and source intact", () => {
    const input = "Before <img src=x onerror=alert(1)> after\n";
    const { doc, comments } = parseDirect(input);
    expect(doc.content?.[0]?.type).toBe("rawMarkdownBlock");
    expect(serializeDirectDocument(doc, comments)).toBe(input);
  });
});

const stamp = `{id="c1" by="AI" at="2024-01-01T00:00:00Z"}`;
const changeStamp = `{id="s1" by="AI" at="2024-01-01T00:00:00Z"}`;
function edited(
  input: string,
  edit: (doc: ReturnType<typeof parseDirect>["doc"]) => void,
) {
  const { doc, comments } = parseDirect(input);
  const normalized = getSchema(createEditorExtensions(""))
    .nodeFromJSON(doc)
    .toJSON();
  const state = { ...doc, content: normalized.content };
  edit(state);
  const saved = serializeDirectDocument(state, comments);
  return { saved, reloaded: parseDirect(saved), comments };
}

describe("edited direct groups", () => {
  it.each([
    " new ",
    " ",
  ])("keeps suggested whitespace tracked through save/reload (%j)", (suggested) => {
    const input = `Before{++${suggested}++}${changeStamp}After\n`;
    const { saved, reloaded } = edited(input, (doc) => {
      const prefix = doc.content?.[0]?.content?.[0];
      if (!prefix) throw new Error("Expected editable prefix");
      prefix.text = "Edited";
    });
    expect(saved).toContain(`{++${suggested}++}`);
    const tracked = reloaded.doc.content?.[0]?.content
      ?.filter((node) =>
        node.marks?.some(
          (mark) =>
            mark.type === "criticChange" && mark.attrs?.changeId === "s1",
        ),
      )
      .map((node) => node.text)
      .join("");
    expect(tracked).toBe(suggested);
  });

  it("keeps a changed anchored comment and nested reply", () => {
    const input = `A {==word==}{>>root<<}${stamp}{>>reply<<}{id="c2" by="AI" at="2024-01-01T00:00:00Z" re="c1"}\n`;
    const { saved, reloaded } = edited(input, (doc) => {
      const node = doc.content?.[0]?.content?.find((n) => n.text === "word");
      if (!node) throw Error("missing anchor");
      node.text = "changed";
    });
    expect(saved).toContain("{==changed==}");
    expect(saved).toContain("{>>reply<<}");
    expect(reloaded.comments.get("c2")?.parentCommentId).toBe("c1");
  });

  it("serializes reviewed code with whitespace and a longer fence", () => {
    const input = `\`\`\`\`js\n  {++hello++}${changeStamp}\n\`\`\`\`\n`;
    const { saved, reloaded } = edited(input, (doc) => {
      const node = doc.content?.[0]?.content?.find((n) => n.text === "hello");
      if (!node) throw Error("missing code review");
      node.text = "hello ``` world";
    });
    expect(saved).toContain("{++hello ``` world++}");
    expect(saved).toMatch(/^`{4,}js\n/);
    expect(JSON.stringify(reloaded.doc.content)).toContain("hello ``` world");
  });

  it("pairs sibling substitutions and preserves an unpaired old side", () => {
    const input = `One {~~old~>new~~}${changeStamp} and {~~left~>right~~}{id="s2" by="AI" at="2024-01-01T00:00:00Z"}\n`;
    const paired = edited(input, (doc) => {
      const nodes = doc.content?.[0]?.content ?? [];
      const next = nodes.find((n) => n.text === "new");
      if (!next) throw Error("missing new side");
      next.text = "replacement";
    });
    expect(paired.saved).toContain("{~~old~>replacement~~}");
    expect(paired.saved).toContain("{~~left~>right~~}");
    expect([...paired.reloaded.changes.keys()]).toEqual(["s1", "s2"]);
    expect(JSON.stringify(paired.reloaded.doc.content)).toContain(
      "replacement",
    );
    const unpaired = edited(input, (doc) => {
      const nodes = doc.content?.[0]?.content ?? [];
      const paragraph = doc.content?.[0];
      if (!paragraph) throw Error("missing paragraph");
      paragraph.content = nodes.filter((n) => n.text !== "new");
    });
    expect(unpaired.saved).toContain("{--old--}");
    expect(unpaired.saved).toContain("{~~left~>right~~}");
    expect(JSON.stringify(unpaired.reloaded.doc.content)).toContain("deletion");
  });

  it("preserves punctuation as literal prose and table text after editing", () => {
    const input = "one plain\n\n| A | B |\n| --- | --- |\n| word | cell |\n";
    const { saved, reloaded } = edited(input, (doc) => {
      const prose = doc.content?.[0]?.content?.[0];
      if (!prose) throw Error("missing prose");
      prose.text = "literal *stars* [brackets]";
      const table = doc.content?.find((n) => n.type === "table");
      const cell =
        table?.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0];
      if (!cell) throw Error("missing table cell");
      cell.text = "literal *stars*";
    });
    expect(saved).toContain("\\*stars\\*");
    expect(
      reloaded.doc.content?.[0]?.content?.map((n) => n.text).join(""),
    ).toContain("literal *stars*");
    expect(
      reloaded.doc.content?.[0]?.content?.map((n) => n.text).join(""),
    ).toContain("[brackets]");
    const table = reloaded.doc.content?.find((node) => node.type === "table");
    expect(
      table?.content?.[1]?.content?.[0]?.content?.[0]?.content
        ?.map((node) => node.text)
        .join(""),
    ).toBe("literal *stars*");
  });
});

describe("direct source safety and isolation", () => {
  it("keeps comment-on-suggestion marks editable across an anchor edit", () => {
    const input = `A {++word++}${changeStamp}{>>Review suggestion<<}${stamp}\n`;
    const { saved, reloaded } = edited(input, (doc) => {
      const word = doc.content?.[0]?.content?.find(
        (node) => node.text === "word",
      );
      if (!word) throw new Error("Expected reviewed suggestion text");
      word.text = "changed";
    });
    getSchema(createEditorExtensions("")).nodeFromJSON(reloaded.doc).check();
    expect(saved).toContain("{++changed++}");
    expect(reloaded.comments.get("c1")?.content).toBe("Review suggestion");
    expect(reloaded.changes.get("s1")?.kind).toBe("addition");
  });

  it("keeps nested comment source valid and intact through a sibling edit", () => {
    const nested =
      '{==outer {==inner==}{>>Inner review<<}{id="c2"} tail==}{>>Outer review<<}{id="c1"}';
    const { saved, reloaded } = edited(`${nested}\n\nEditable.\n`, (doc) => {
      const text = doc.content?.at(-1)?.content?.[0];
      if (!text) throw new Error("Expected editable sibling");
      text.text = "Edited sibling.";
    });
    getSchema(createEditorExtensions("")).nodeFromJSON(reloaded.doc).check();
    expect(saved).toContain(nested);
    expect(saved).toContain("Edited sibling.");
  });

  it("keeps CRLF references after editing a different block", () => {
    const input =
      "Before\r\n\r\n[ref][target]\r\n\r\n[target]: https://example.com\r\n";
    const { saved, reloaded } = edited(input, (doc) => {
      const prose = doc.content?.[0]?.content?.[0];
      if (!prose) throw Error("missing prose");
      prose.text = "After";
    });
    expect(saved).toContain(
      "[ref][target]\r\n\r\n[target]: https://example.com",
    );
    expect(saved).toContain("After\r\n");
    expect(reloaded.doc.content?.[0]?.content?.[0]?.text).toBe("After");
  });

  it("does not inherit resolver or review parser state between documents", () => {
    const first = parseDirect(`[one](local) {++review++}${changeStamp}\n`, {
      resolveLinkUrl: () => "https://example.com/one",
    });
    const second = parseDirect("[two](local)\n");
    expect(JSON.stringify(first.doc.content)).toContain(
      "https://example.com/one",
    );
    expect(JSON.stringify(second.doc.content)).not.toContain(
      "https://example.com/one",
    );
    expect(JSON.stringify(second.doc.content)).toContain('"href":"local"');
    expect(second.changes.size).toBe(0);
  });

  it("rejects unsafe image source and resolved URL, but retains file previews", () => {
    for (const source of ["javascript:alert(1)", "relative"]) {
      const parsed = parseDirect(`![caption](${source})\n`, {
        resolveFileUrl: () => "javascript:alert(1)",
      });
      expect(JSON.stringify(parsed.doc.content)).not.toContain(
        '"src":"javascript:',
      );
    }
    const local = parseDirect("![caption](relative)\n", {
      resolveFileUrl: () => "file:///tmp/image.png",
    });
    expect(JSON.stringify(local.doc.content)).toContain(
      "file:///tmp/image.png",
    );
    expect(JSON.stringify(local.doc.content)).toContain(
      '"dataMarkdownSrc":"relative"',
    );
  });

  it("preserves mixed inline image and reviewed text as inert raw source", () => {
    const input = `Prefix ![image](photo.png) {++review++}${changeStamp} suffix\n`;
    const { doc, comments } = parseDirect(input);
    expect(doc.content?.[0]?.type).toBe("rawMarkdownBlock");
    expect(serializeDirectDocument(doc, comments)).toBe(input);
  });
});

describe("direct endmatter edits", () => {
  it("filters orphan entries while retaining replies and document metadata", () => {
    const input = [
      "{==word==}{>>Root<<}{#c1} {++claim++}{#s1}",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: AI",
      '    at: "2024-01-01T00:00:00Z"',
      "  c2:",
      "    body: Reply",
      "    re: c1",
      "    by: user",
      "  doc:",
      "    body: Document note",
      "    by: AI",
      "    custom: retain-me",
      "  orphan:",
      "    body: Orphan reply",
      "    re: missing",
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2024-01-01T00:00:00Z"',
      "  stale:",
      "    by: AI",
      "",
    ].join("\n");
    const { saved, reloaded } = edited(input, (doc) => {
      const paragraph = doc.content?.[0];
      const word = paragraph?.content?.find((n) => n.text === "word");
      if (!word) throw Error("missing anchor");
      word.text = "edited";
      if (!paragraph) throw Error("missing paragraph");
      paragraph.content = paragraph.content?.filter((n) => n.text !== "claim");
    });
    expect(saved).toContain("{==edited==}{>>Root<<}{#c1}");
    expect(saved).toContain("body: Reply");
    expect(saved).toContain("custom: retain-me");
    expect(saved).not.toContain("orphan:");
    expect(saved).not.toContain("stale:");
    expect(saved).not.toContain("  s1:");
    expect(reloaded.comments.get("doc")?.scope).toBe("document");
    expect(reloaded.comments.get("c2")?.parentCommentId).toBe("c1");
  });
});

it("retains metadata referenced only inside an opaque HTML block after a sibling edit", () => {
  const input = [
    "A <span>raw</span> {==word==}{>>Root<<}{#root}",
    "",
    "Editable",
    "",
    "---",
    "comments:",
    "  root:",
    "    by: AI",
    "    custom: keep-this",
    "",
  ].join("\n");
  const parsed = parseDirect(input);
  expect(parsed.doc.content?.[0]?.type).toBe("rawMarkdownBlock");
  const { saved, reloaded } = edited(input, (doc) => {
    const node = doc.content?.[1]?.content?.[0];
    if (!node) throw Error("missing editable sibling");
    node.text = "Updated";
  });
  expect(saved).toContain("A <span>raw</span> {==word==}{>>Root<<}{#root}");
  expect(saved).toContain("custom: keep-this");
  expect(reloaded.endmatter).toContain("root:");
});

describe("unsupported content remains intact and schema-valid", () => {
  it.each([
    "# Hello ![pic](x.png) end\n",
    "- Hello ![pic](x.png) end\n",
    "> Hello ![pic](x.png) end\n",
    "| A |\n| --- |\n| Hello ![pic](x.png) end |\n",
  ])("preserves nested images in %s", (input) => {
    const { doc, comments } = parseDirect(input);
    getSchema(createEditorExtensions("")).nodeFromJSON(doc).check();
    expect(doc.content?.[0]?.type).toBe("rawMarkdownBlock");
    expect(serializeDirectDocument(doc, comments)).toBe(input);
  });

  it("preserves blocked lone images rather than inserting invalid inline paragraphs", () => {
    const input = "![pic](https://example.com/pic.png)\n";
    const { doc, comments } = parseDirect(input, { blockRemoteImages: true });
    getSchema(createEditorExtensions("")).nodeFromJSON(doc).check();
    expect(doc.content?.[0]?.type).toBe("rawMarkdownBlock");
    expect(serializeDirectDocument(doc, comments)).toBe(input);
  });

  it("retains overlapping suggestions rather than duplicating same-type marks", () => {
    const input = '{++outer {--inner--}{id="s2"} tail++}{id="s1"}\n';
    const { doc, comments } = parseDirect(input);
    getSchema(createEditorExtensions("")).nodeFromJSON(doc).check();
    expect(doc.content?.[0]?.type).toBe("rawMarkdownBlock");
    expect(serializeDirectDocument(doc, comments)).toBe(input);
  });

  it("resolves an angle-delimited reference without a phantom definition, even after editing", () => {
    const input = "[label][ref]\n\n[ref]: <https://example.com/a b>\n";
    const { doc, comments } = parseDirect(input);
    getSchema(createEditorExtensions("")).nodeFromJSON(doc).check();
    expect(JSON.stringify(doc.content)).toContain("https://example.com/a b");
    expect(doc.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "rawMarkdownBlock",
    ]);
    const node = doc.content?.[0]?.content?.[0];
    if (!node) throw Error("missing link");
    node.text = "edited";
    const saved = serializeDirectDocument(doc, comments);
    expect(saved).toContain("[edited](<https://example.com/a b>)");
    const reloaded = parseDirect(saved);
    expect(JSON.stringify(reloaded.doc.content)).toContain(
      "https://example.com/a b",
    );
    expect(
      reloaded.doc.content?.filter((n) => n.type === "paragraph"),
    ).toHaveLength(1);
  });

  it("does not throw on a moved but unmodified opaque block", () => {
    const input = "Before <span>raw</span> after\n\nEditable\n";
    const { doc, comments } = parseDirect(input);
    const blocks = doc.content ?? [];
    doc.content = [blocks[1], blocks[0]];
    expect(serializeDirectDocument(doc, comments)).toContain(
      "Before <span>raw</span> after",
    );
  });
});

it("retains both overlapping review endmatter IDs when an adjacent group changes", () => {
  const input = [
    "{++outer {--inner--}{#s2} tail++}{#s1}",
    "",
    "Editable",
    "",
    "---",
    "suggestions:",
    "  s1:",
    "    by: AI",
    "    custom: outer",
    "  s2:",
    "    by: AI",
    "    custom: inner",
    "",
  ].join("\n");
  const { saved, reloaded } = edited(input, (doc) => {
    const text = doc.content?.[1]?.content?.[0];
    if (!text) throw Error("missing editable sibling");
    text.text = "Changed";
  });
  expect(saved).toContain("custom: outer");
  expect(saved).toContain("custom: inner");
  expect(saved).toContain("{++outer {--inner--}{#s2} tail++}{#s1}");
  expect(reloaded.doc.content?.[0]?.type).toBe("rawMarkdownBlock");
});

it("escapes changed link destinations and image alt text on save and reload", () => {
  const link = edited("[label](https://example.com/start)\n", (doc) => {
    const mark = doc.content?.[0]?.content?.[0]?.marks?.find(
      (m) => m.type === "link",
    );
    if (!mark) throw Error("missing link");
    mark.attrs = {
      ...mark.attrs,
      href: "https://example.com/a b(c)",
      dataMarkdownSrc: "https://example.com/a b(c)",
    };
  });
  expect(link.saved).toContain("(<https://example.com/a b(c)>)");
  expect(JSON.stringify(link.reloaded.doc.content)).toContain(
    "https://example.com/a b(c)",
  );

  const image = edited("![old](photo.png)\n", (doc) => {
    const attrs = doc.content?.[0]?.attrs;
    if (!attrs) throw Error("missing image");
    attrs.alt = "a [bracket]";
    attrs.src = "new photo.png";
    attrs.dataMarkdownSrc = "new photo.png";
  });
  expect(image.saved).toContain("![a \\[bracket\\]](<new photo.png>)");
  expect(JSON.stringify(image.reloaded.doc.content)).toContain("new photo.png");
});
