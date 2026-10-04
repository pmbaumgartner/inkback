import { describe, expect, it } from "vitest";
import {
  parseDirect,
  serializeDirectDocument,
} from "../src/critic-markup/direct-parser";

function richTextRoundTrip(markdown: string): string {
  const { doc, comments, frontmatter } = parseDirect(markdown);
  return serializeDirectDocument(doc, comments, { frontmatter });
}

describe("Markdown rich-text preservation", () => {
  it("keeps a spaced link destination through an edited containing paragraph", () => {
    const input = "[label](<https://example.com/a b>) text\n";
    const parsed = parseDirect(input);
    const paragraph = parsed.doc.content?.[0];
    const text = paragraph?.content?.at(-1);
    if (!text) throw new Error("Expected paragraph text");
    text.text = " edited";
    const output = serializeDirectDocument(parsed.doc, parsed.comments);
    const reloaded = parseDirect(output);
    expect(reloaded.doc.content?.[0]?.content?.[0]?.marks).toContainEqual(
      expect.objectContaining({
        type: "link",
        attrs: expect.objectContaining({
          dataMarkdownSrc: "https://example.com/a b",
        }),
      }),
    );
  });

  it("resolves spaced reference destinations without phantom editor text", () => {
    const parsed = parseDirect(
      "[label][ref]\n\n[ref]: <https://example.com/a b>\n",
    );
    expect(parsed.doc.content?.[0]?.content?.[0]?.marks).toContainEqual(
      expect.objectContaining({
        type: "link",
        attrs: expect.objectContaining({
          dataMarkdownSrc: "https://example.com/a b",
        }),
      }),
    );
    expect(
      parsed.doc.content?.[0]?.content?.map((node) => node.text).join(""),
    ).toBe("label");
  });

  it("tolerates malformed review attributes in imported HTML", () => {
    const input =
      'Before <span data-critic-change-kind="addition" data-critic-change-id="s1" data-critic-change-at="2024" data-critic-change-metadata="{">oops</span> after\n';
    const parsed = parseDirect(input);
    expect(parsed.doc.content?.[0]?.type).toBe("rawMarkdownBlock");
    expect(serializeDirectDocument(parsed.doc, parsed.comments)).toBe(input);
  });

  it("retains review metadata referenced by opaque content after a sibling edit", () => {
    const input = `<details>
{==opaque anchor==}{>>Keep this review<<}{#root}
{++opaque suggestion++}{#change}
</details>

Edit me.

---
comments:
  root:
    by: AI
    status: unresolved
    custom: retained
suggestions:
  change:
    by: AI
    custom: retained
`;
    const parsed = parseDirect(input);
    const paragraph = parsed.doc.content?.find(
      (node) => node.type === "paragraph",
    );
    if (!paragraph?.content?.[0]) throw new Error("Expected editable sibling");
    paragraph.content[0].text = "Edited sibling.";
    const output = serializeDirectDocument(parsed.doc, parsed.comments);
    expect(output).toContain("{>>Keep this review<<}{#root}");
    expect(output).toContain("{++opaque suggestion++}{#change}");
    expect(output).toContain("custom: retained");
    expect(output).toContain("status: unresolved");
    const reloaded = parseDirect(output);
    expect(reloaded.endmatter).toContain("root:");
    expect(reloaded.endmatter).toContain("change:");
  });

  it("preserves GFM strikethrough markup", () => {
    const input = "Keep ~~removed~~ and **bold** text.\n";

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves inline link titles", () => {
    const input = '[Inkback](./README.md "Local title")\n';

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves image titles", () => {
    const input = '![Alt text](./image.png "Image title")\n';

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves mailto autolinks as mailto URLs", () => {
    const input = "Visit <https://example.com/a?b=c> or <me@example.com>.\n";

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves source-only HTML comments", () => {
    const input = [
      "Before",
      "",
      "<!-- keep this source note -->",
      "",
      "After",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves raw details HTML blocks", () => {
    const input = [
      "<details>",
      "<summary>More</summary>",
      "",
      "Hidden **markdown** body.",
      "",
      "</details>",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves multi-line indented code blocks after lists", () => {
    const input = [
      "- Item before",
      "",
      "    code block",
      "    second line",
      "",
      "After",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves table cells containing escaped pipes and inline code pipes", () => {
    const input = [
      "| Column | Value |",
      "| --- | --- |",
      "| Escaped | `a | b` and plain a \\| b |",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });
});

it("preserves unchanged Markdown blocks byte-for-byte through an unrelated edit", () => {
  const preserved =
    "#### Four\n\n##### Five\n\n###### Six\n\nLiteral \\*word\\* and \\_word\\_.\n\n```html\n<details>\n<summary>Example</summary>\n</details>\n\n<!-- literal -->\n```\n\n";
  const parsed = parseDirect(`${preserved}Edit me.\n`);
  const last = parsed.doc.content?.at(-1);
  if (last?.content?.[0]) last.content[0].text = "Edited.";
  const output = serializeDirectDocument(parsed.doc, parsed.comments);
  expect(output).toBe(`${preserved}Edited.\n`);
  expect(
    parsed.doc.content?.slice(0, 3).map((node) => node.attrs?.level),
  ).toEqual([4, 5, 6]);
});

it("escapes literal punctuation in edited prose", () => {
  const parsed = parseDirect("Original.\n");
  if (parsed.doc.content?.[0]?.content?.[0])
    parsed.doc.content[0].content[0].text = "*literal*";
  const output = serializeDirectDocument(parsed.doc, parsed.comments);
  expect(output).toContain("\\*literal\\*");
});

it("keeps reference definitions available after editing a referenced block", () => {
  const parsed = parseDirect(
    "First [link][target].\n\n[target]: https://example.com\n\nSecond [link][target].\n",
  );
  const text = parsed.doc.content?.[0]?.content?.[0];
  if (!text) throw new Error("Expected referenced paragraph text");
  text.text = "Edited ";
  const output = serializeDirectDocument(parsed.doc, parsed.comments);
  expect(output).toContain("[target]: https://example.com");
  expect(output).toContain("Second [link][target].");
});
