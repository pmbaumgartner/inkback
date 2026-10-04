import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitYamlFrontmatter, toHtml } from "./markdown";

function readMarkdownFixture(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "test", "fixtures", "markdown", name),
    "utf8",
  );
}

describe("splitYamlFrontmatter", () => {
  it("preserves CRLF frontmatter byte-for-byte while splitting the body", () => {
    const input = "---\r\ntitle: CRLF\r\n---\r\n\r\n# Body\r\n";

    expect(splitYamlFrontmatter(input)).toEqual({
      frontmatter: "---\r\ntitle: CRLF\r\n---\r\n\r\n",
      body: "# Body\r\n",
    });
  });

  it("preserves empty frontmatter and table-like YAML text", () => {
    const empty = "---\n---\n\n# Body\n";
    const tableLike = readMarkdownFixture("frontmatter-table-yaml.md");

    expect(splitYamlFrontmatter(empty)).toEqual({
      frontmatter: "---\n---\n\n",
      body: "# Body\n",
    });
    expect(splitYamlFrontmatter(tableLike).frontmatter).toContain(
      "  | column | value |",
    );
  });
});

describe("toHtml", () => {
  it("preserves original markdown paths while resolving rendered URLs", () => {
    const html = toHtml(
      "[Draft](notes/draft.md)\n\n![Sketch](images/sketch.png)\n\n[Docs](https://example.com)",
      {
        resolveFileUrl: (path) => `/api/files?path=${encodeURIComponent(path)}`,
      },
    );

    expect(html).toContain(
      '<a href="/api/files?path=notes%2Fdraft.md" data-markdown-src="notes/draft.md">Draft</a>',
    );
    expect(html).toContain(
      '<img src="/api/files?path=images%2Fsketch.png" alt="Sketch" data-markdown-src="images/sketch.png">',
    );
    expect(html).toContain(
      '<a href="https://example.com" data-markdown-src="https://example.com" target="_blank" rel="noreferrer noopener">Docs</a>',
    );
  });

  it("can resolve markdown document links separately from file assets", () => {
    const html = toHtml(
      "[Target](local-link-target.md)\n\n![Diagram](local-link-target.md)",
      {
        resolveFileUrl: (path) => `/api/files?path=${encodeURIComponent(path)}`,
        resolveLinkUrl: (path) =>
          path.endsWith(".md")
            ? `/?path=${encodeURIComponent(`/project/${path}`)}`
            : null,
      },
    );

    expect(html).toContain(
      '<a href="/?path=%2Fproject%2Flocal-link-target.md" data-markdown-src="local-link-target.md">Target</a>',
    );
    expect(html).toContain(
      '<img src="/api/files?path=local-link-target.md" alt="Diagram" data-markdown-src="local-link-target.md">',
    );
  });

  it("renders in-page anchors, mailto links, task lists, and table fixtures", () => {
    const html = toHtml(
      `${readMarkdownFixture("links-and-images.md")}\n${readMarkdownFixture("tables-and-task-lists.md")}`,
    );

    expect(html).toContain(
      '<a href="#links-and-images" data-markdown-src="#links-and-images">In-page anchor</a>',
    );
    expect(html).toContain(
      '<a href="mailto:review@example.com" data-markdown-src="mailto:review@example.com">Mail</a>',
    );
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain("<table>");
    expect(html).toContain(
      '<img src="./images/sketch.png" alt="Sketch" title="Sketch title" data-markdown-src="./images/sketch.png">',
    );
  });
});
