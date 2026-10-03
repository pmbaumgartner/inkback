import { describe, expect, it } from "vitest";
import { criticMarkdownToEditorState } from "../src/critic-markup";
import { editorStateToCriticMarkdown } from "../src/critic-markup/writer";

function richTextRoundTrip(markdown: string): string {
  const { doc, comments, frontmatter } = criticMarkdownToEditorState(markdown);
  return editorStateToCriticMarkdown(doc, comments, { frontmatter });
}

describe("Markdown rich-text preservation", () => {
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
  const parsed = criticMarkdownToEditorState(preserved + "Edit me.\n");
  const last = parsed.doc.content?.at(-1);
  if (last?.content?.[0]) last.content[0].text = "Edited.";
  const output = editorStateToCriticMarkdown(parsed.doc, parsed.comments);
  expect(output).toBe(preserved + "Edited.\n");
  expect(
    parsed.doc.content?.slice(0, 3).map((node) => node.attrs?.level),
  ).toEqual([4, 5, 6]);
});

it("escapes literal punctuation in edited prose", () => {
  const parsed = criticMarkdownToEditorState("Original.\n");
  if (parsed.doc.content?.[0]?.content?.[0])
    parsed.doc.content[0].content[0].text = "*literal*";
  const output = editorStateToCriticMarkdown(parsed.doc, parsed.comments);
  expect(output).toContain("\\*literal\\*");
});

it("keeps reference definitions available after editing a referenced block", () => {
  const parsed = criticMarkdownToEditorState(
    "First [link][target].\n\n[target]: https://example.com\n\nSecond [link][target].\n",
  );
  parsed.doc.content![0]!.content![0]!.text = "Edited ";
  const output = editorStateToCriticMarkdown(parsed.doc, parsed.comments);
  expect(output).toContain("[target]: https://example.com");
  expect(output).toContain("Second [link][target].");
});
