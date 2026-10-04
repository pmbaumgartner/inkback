// Direct Markdown serialization using the Tiptap Markdown extension hooks.

import type { AnyExtension, JSONContent, Mark, Node } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import Paragraph from "@tiptap/extension-paragraph";
import { MarkdownManager } from "@tiptap/markdown";
import type { marked } from "direct-marked";
import {
  type CriticChangeAttrs,
  createEditorExtensions,
} from "../editor-extensions";
import {
  appendYamlEndmatter,
  decodeRawMarkdownBlock,
  escapeMarkdownImageAlt,
  prependYamlFrontmatter,
  serializeMarkdownDestination,
} from "../markdown";
import type { CriticComment } from "./model";
import {
  serializeChangeMetadata,
  serializeCommentBlocks,
} from "./review-serialization";
import { saveSourceGroups } from "./source-blocks";

export function createDirectManager(
  comments: Map<string, CriticComment>,
  options: {
    marked?: typeof marked;
    parseCode?: (text: string) => JSONContent[];
    useEndmatter?: boolean;
    extensions?: AnyExtension[];
  } = {},
) {
  let manager: MarkdownManager;
  const inline = (nodes: JSONContent[], code: boolean): string => {
    let output = "";
    for (let i = 0; i < nodes.length; ) {
      const first = nodes[i];
      const commentIds = (node: JSONContent): string[] =>
        node.marks?.find((mark) => mark.type === "commentRef")?.attrs
          ?.commentIds ?? [];
      const ids = commentIds(first);
      if (ids.length) {
        const anchored: JSONContent[] = [];
        while (
          i < nodes.length &&
          JSON.stringify(commentIds(nodes[i])) === JSON.stringify(ids)
        )
          anchored.push(nodes[i++]);
        const unanchored = anchored.map((node) => ({
          ...node,
          marks: node.marks?.filter((mark) => mark.type !== "commentRef"),
        }));
        const rendered = inline(unanchored, code);
        const changeId = anchored[0]?.marks?.find(
          (mark) => mark.type === "criticChange",
        )?.attrs?.changeId;
        const onlyChange =
          changeId &&
          anchored.every((node) =>
            node.marks?.some(
              (mark) =>
                mark.type === "criticChange" &&
                mark.attrs?.changeId === changeId,
            ),
          );
        const commentText = serializeCommentBlocks(
          ids,
          comments,
          options.useEndmatter,
        );
        output +=
          (rendered === "\u2060"
            ? ""
            : onlyChange
              ? rendered
              : `{==${rendered}==}`) + commentText;
        continue;
      }
      const reviewMarks = (node: JSONContent) =>
        (node.marks ?? []).filter((m) =>
          ["criticChange", "commentRef"].includes(m.type),
        );
      const signature = JSON.stringify(reviewMarks(first));
      const group: JSONContent[] = [];
      while (
        i < nodes.length &&
        JSON.stringify(reviewMarks(nodes[i])) === signature
      )
        group.push(nodes[i++]);
      const clean = (items: JSONContent[]) =>
        items.map((n) => ({
          ...n,
          text: n.marks?.some((mark) => mark.type === "code")
            ? n.text
            : n.text?.replace(/[\\`*_{}[\]<>#!|~]/g, "\\$&"),
          marks: (n.marks ?? []).filter(
            (m) => !["criticChange", "commentRef"].includes(m.type),
          ),
        }));
      const render = (items: JSONContent[]) =>
        code
          ? items.map((n) => n.text ?? "").join("")
          : manager.renderNodes(clean(items), { type: "paragraph" });
      const change = first.marks?.find((m) => m.type === "criticChange")?.attrs;
      let text = render(group);
      if (change) {
        if (change.kind === "substitution-old") {
          const next: JSONContent[] = [];
          while (
            i < nodes.length &&
            nodes[i].marks?.some(
              (m) =>
                m.type === "criticChange" &&
                m.attrs?.kind === "substitution-new" &&
                m.attrs?.changeId === change.changeId,
            )
          )
            next.push(nodes[i++]);
          text =
            (next.length ? `{~~${text}~>${render(next)}~~}` : `{--${text}--}`) +
            (options.useEndmatter
              ? `{#${change.changeId}}`
              : serializeChangeMetadata(change as CriticChangeAttrs));
        } else if (change.kind === "substitution-new") {
          text = `{++${text}++}${options.useEndmatter ? `{#${change.changeId}}` : serializeChangeMetadata(change as CriticChangeAttrs)}`;
        } else {
          const delimiter = change.kind === "addition" ? "++" : "--";
          text = `{${delimiter}${text}${delimiter}}${options.useEndmatter ? `{#${change.changeId}}` : serializeChangeMetadata(change as CriticChangeAttrs)}`;
        }
      }
      output += text;
    }
    return output;
  };
  const extensions = createEditorExtensions("").map((extension) => {
    if (extension.name === "starterKit")
      return extension.configure({ paragraph: false, heading: false });
    if (extension.name === "link")
      return (extension as Mark).extend({
        renderMarkdown(node, helpers) {
          const href = node.attrs?.dataMarkdownSrc || node.attrs?.href || "";
          const title = node.attrs?.title
            ? ` "${String(node.attrs.title).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
            : "";
          if (node.attrs?.dataMarkdownAutolink === "true" && !title)
            return `<${href.startsWith("mailto:") ? href.slice(7) : href}>`;
          return `[${helpers.renderChildren(node)}](${serializeMarkdownDestination(href)}${title})`;
        },
      });
    if (extension.name === "image")
      return (extension as Node).extend({
        renderMarkdown(node) {
          const src = node.attrs?.dataMarkdownSrc || node.attrs?.src || "";
          const title = node.attrs?.title
            ? ` "${String(node.attrs.title).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
            : "";
          return `![${escapeMarkdownImageAlt(node.attrs?.alt ?? "")}](${serializeMarkdownDestination(src)}${title})`;
        },
      });
    if (extension.name !== "codeBlock") return extension;
    return (extension as Node).extend({
      parseMarkdown(token, helpers) {
        const text = token.text ?? "";
        return helpers.createNode(
          "codeBlock",
          { language: token.lang || null },
          options.parseCode
            ? options.parseCode(text)
            : [{ type: "text", text }],
        );
      },
      renderMarkdown(node) {
        const text = inline(node.content ?? [], true);
        const fence = "`".repeat(
          Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
        );
        return `${fence}${node.attrs?.language ?? ""}\n${text}\n${fence}`;
      },
    });
  });
  extensions.push(
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }).extend({
      renderMarkdown(node: JSONContent) {
        return `${"#".repeat(node.attrs?.level ?? 1)} ${inline(node.content ?? [], false)}`;
      },
    }),
    Paragraph.extend({
      renderMarkdown(node: JSONContent) {
        return inline(node.content ?? [], false);
      },
    }),
  );
  manager = new MarkdownManager({
    extensions: [...(options.extensions ?? []), ...extensions],
    marked: options.marked,
  });
  return manager;
}

export function saveDirectSource(
  doc: JSONContent,
  comments: Map<string, CriticComment>,
  manager: MarkdownManager,
): string {
  const document = doc as JSONContent & {
    yamlFrontmatter?: string;
    yamlEndmatter?: string;
    lineEnding?: string;
  };
  const body = saveSourceGroups(doc, comments, (grouped) => {
    if (grouped.content?.some((node) => node.type === "rawMarkdownBlock")) {
      if (
        grouped.content?.length !== 1 ||
        grouped.content[0]?.type !== "rawMarkdownBlock"
      )
        throw new Error("Cannot serialize a mixed raw Markdown group");
      const node = grouped.content[0];
      const raw = decodeRawMarkdownBlock(node.attrs?.rawMarkdown ?? "");
      // Moves and default-attribute normalization may invalidate a snapshot;
      // only emit raw source if the encoded bytes still match the captured text.
      if (
        typeof node.attrs?.originalSource !== "string" ||
        raw !== node.attrs.originalSource.trimEnd()
      )
        throw new Error("Cannot serialize modified raw Markdown source");
      return raw;
    }
    return manager.serialize(grouped).trim();
  });
  const output = appendYamlEndmatter(
    prependYamlFrontmatter(body, document.yamlFrontmatter ?? null),
    document.yamlEndmatter ?? null,
  );
  return document.lineEnding === "\r\n"
    ? output.replace(/\r?\n/g, "\r\n")
    : output;
}
