import { parseRfmEndmatter } from "@inkback/rfm";
import DOMPurify from "dompurify";
import { marked, type Token } from "marked";

export const rawMarkdownBlockAttribute = "data-markdown-raw-block";

export interface MarkdownOptions {
  blockRemoteImages?: boolean;
  resolveFileUrl?: (path: string) => string | null;
  resolveLinkUrl?: (path: string) => string | null;
}

export interface YamlFrontmatterSplit {
  frontmatter: string | null;
  body: string;
}

export interface YamlDocumentMetadataSplit {
  frontmatter: string | null;
  body: string;
  endmatter: string | null;
}

export function isExternalUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
}

function isInPageAnchor(path: string): boolean {
  return path.startsWith("#");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function encodeRawMarkdownBlock(markdown: string): string {
  return encodeURIComponent(markdown);
}

export function decodeRawMarkdownBlock(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function createRawMarkdownBlock(markdown: string): string {
  return `<div ${rawMarkdownBlockAttribute}="${escapeHtml(
    encodeRawMarkdownBlock(markdown),
  )}"></div>\n`;
}

export function protectRichTextRoundTripMarkdown(markdown: string): string {
  let cursor = 0;
  let output = "";
  for (const token of marked.lexer(markdown, { gfm: true })) {
    const start = markdown.indexOf(token.raw, cursor);
    if (start < 0) continue;
    output += markdown.slice(cursor, start);
    const unsupported = isUnsupportedMarkdownBlock(token);
    output += unsupported ? createRawMarkdownBlock(token.raw) : token.raw;
    cursor = start + token.raw.length;
  }
  return output + markdown.slice(cursor);
}

export function isUnsupportedMarkdownBlock(
  token: Pick<Token, "type" | "raw">,
): boolean {
  return (
    ![
      "paragraph",
      "heading",
      "list",
      "blockquote",
      "code",
      "hr",
      "table",
      "space",
    ].includes(token.type) ||
    (token.type === "table" &&
      (token.raw.includes("\\|") || /`[^`\n]*\|[^`\n]*`/.test(token.raw))) ||
    (token.type === "list" && /\n[ \t]*\n(?: {4}|\t)/.test(token.raw))
  );
}

export function serializeMarkdownDestination(url: string): string {
  if (!/[\s()<>\\]/.test(url)) return url;
  return `<${url
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")}>`;
}

export function escapeMarkdownImageAlt(alt: string): string {
  return alt.replace(/[\\[\]]/g, "\\$&");
}

export function markdownReferenceDefinitions(
  links: Record<string, { href: string; title?: string | null }>,
): string {
  return Object.entries(links)
    .map(([id, value]) => {
      const title = value.title
        ? ` "${value.title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : "";
      return `[${id}]: ${serializeMarkdownDestination(value.href)}${title}`;
    })
    .join("\n");
}

export function resolveRenderedUrl(
  path: string,
  resolveFileUrl?: MarkdownOptions["resolveFileUrl"],
) {
  if (isExternalUrl(path) || isInPageAnchor(path)) return path;
  return resolveFileUrl?.(path) ?? path;
}

function isYamlFrontmatterDelimiter(line: string): boolean {
  return /^(?:---|\.\.\.)[ \t]*$/.test(line.replace(/\r$/, ""));
}

export function splitYamlFrontmatter(markdown: string): YamlFrontmatterSplit {
  const openingDelimiter = markdown.match(/^---[ \t]*(?:\r\n|\n)/);
  if (!openingDelimiter) return { frontmatter: null, body: markdown };

  let lineStart = openingDelimiter[0].length;

  while (lineStart < markdown.length) {
    const nextLineBreak = markdown.indexOf("\n", lineStart);
    const lineEnd = nextLineBreak === -1 ? markdown.length : nextLineBreak + 1;
    const line = markdown.slice(
      lineStart,
      nextLineBreak === -1 ? lineEnd : lineEnd - 1,
    );

    if (isYamlFrontmatterDelimiter(line)) {
      let bodyStart = lineEnd;

      while (bodyStart < markdown.length) {
        const blankLineBreak = markdown.indexOf("\n", bodyStart);
        const blankLineEnd =
          blankLineBreak === -1 ? markdown.length : blankLineBreak + 1;
        const blankLine = markdown.slice(
          bodyStart,
          blankLineBreak === -1 ? blankLineEnd : blankLineEnd - 1,
        );

        if (blankLine.replace(/\r$/, "").trim() !== "") break;
        bodyStart = blankLineEnd;
      }

      return {
        frontmatter: markdown.slice(0, bodyStart),
        body: markdown.slice(bodyStart),
      };
    }

    lineStart = lineEnd;
  }

  return { frontmatter: null, body: markdown };
}

export function prependYamlFrontmatter(
  markdown: string,
  frontmatter?: string | null,
): string {
  return frontmatter ? `${frontmatter}${markdown}` : markdown;
}

export function splitYamlDocumentMetadata(
  markdown: string,
): YamlDocumentMetadataSplit {
  const { frontmatter, body } = splitYamlFrontmatter(markdown);
  const parsed = parseRfmEndmatter(body);
  if (parsed.offset === null) return { frontmatter, body, endmatter: null };
  return {
    frontmatter,
    body: body.slice(0, parsed.offset).replace(/\s*$/, "\n"),
    endmatter: parsed.raw?.replace(/^\n/, "") ?? null,
  };
}

export function appendYamlEndmatter(
  markdown: string,
  endmatter?: string | null,
): string {
  return endmatter
    ? `${markdown.replace(/\s*$/, "\n")}\n${endmatter}`
    : markdown;
}

export function createMarkedRenderer(options?: MarkdownOptions) {
  const renderer = new marked.Renderer();
  const baseRenderer = new marked.Renderer();
  const resolveFileUrl = options?.resolveFileUrl;
  const resolveLinkUrl = options?.resolveLinkUrl;

  renderer.code = ({ text, lang, escaped }) => {
    const language = (lang || "").match(/\S+/)?.[0];
    const content = escaped ? text : escapeHtml(text);
    const classAttr = language
      ? ` class="language-${escapeHtml(language)}"`
      : "";

    return `<pre><code${classAttr}>${content}</code></pre>\n`;
  };

  renderer.link = function ({ href, title, tokens, raw }) {
    const rawHref = href || "";
    const renderedHref = resolveRenderedUrl(
      rawHref,
      (path) => resolveLinkUrl?.(path) ?? resolveFileUrl?.(path) ?? null,
    );
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const markdownSrcAttr = ` data-markdown-src="${escapeHtml(rawHref)}"`;
    const autolinkAttr =
      !title && raw?.startsWith("<") && raw.endsWith(">")
        ? ' data-markdown-autolink="true"'
        : "";
    const externalAttr =
      isExternalUrl(rawHref) && !rawHref.startsWith("mailto:")
        ? ' target="_blank" rel="noreferrer noopener"'
        : "";

    return `<a href="${escapeHtml(renderedHref)}"${titleAttr}${markdownSrcAttr}${autolinkAttr}${externalAttr}>${text}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    const rawHref = href || "";
    if (
      options?.blockRemoteImages &&
      /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(rawHref)
    )
      return `<span>${escapeHtml(text || "")}</span>`;
    const renderedHref = resolveRenderedUrl(rawHref, resolveFileUrl);
    const alt = text || "";
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const markdownSrcAttr = ` data-markdown-src="${escapeHtml(rawHref)}"`;

    return `<img src="${escapeHtml(renderedHref)}" alt="${escapeHtml(alt)}"${titleAttr}${markdownSrcAttr}>`;
  };

  renderer.list = function (token) {
    const hasTaskItems = token.items.some((item) => item.task);
    if (!hasTaskItems) {
      return baseRenderer.list.call(this, token);
    }

    const items = token.items
      .map((item) => {
        const checked = item.checked ? "true" : "false";
        const inner = this.parser.parse(item.tokens, false);
        return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${
          item.checked ? ' checked="checked"' : ""
        }><span></span></label><div>${inner}</div></li>`;
      })
      .join("");

    return `<ul data-type="taskList">${items}</ul>`;
  };

  return renderer;
}

export function toHtml(markdown: string, options?: MarkdownOptions): string {
  return sanitizeMarkdownHtml(
    marked.parse(markdown, {
      async: false,
      gfm: true,
      renderer: createMarkedRenderer(options),
    }) as string,
  );
}

export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-markdown-src", "data-markdown-autolink", "target"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|ftp|ftps|mailto|tel|callto|sms|cid|xmpp|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
  });
}
