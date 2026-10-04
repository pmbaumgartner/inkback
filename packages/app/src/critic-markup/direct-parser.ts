// Parse supported Markdown directly to editor JSON. HTML-containing blocks are
// preserved inert when their mixed inline content cannot be represented safely.
import { collectReviewIds, parseHighlight, scanReview } from "@inkback/rfm";
import {
  type AnyExtension,
  Extension,
  getSchema,
  type JSONContent,
  type MarkdownToken,
} from "@tiptap/core";
import { Marked, type MarkedOptions, marked, type Token } from "direct-marked";
import {
  type CriticChangeAttrs,
  createEditorExtensions,
} from "../editor-extensions";
import {
  encodeRawMarkdownBlock,
  isExternalUrl,
  isUnsupportedMarkdownBlock,
  type MarkdownOptions,
  markdownReferenceDefinitions,
  resolveRenderedUrl,
  splitYamlDocumentMetadata,
} from "../markdown";
import { createDirectManager, saveDirectSource } from "./direct-writer";
import { addEndmatterFeedback, commentMetadata } from "./hydration";
import { collectLiveReview, collectOpaqueReviewIds } from "./live-review";
import {
  type CriticComment,
  createChangeWithContext,
  createCommentWithContext,
  parseReviewEndmatter,
  unanchoredCommentSentinel,
} from "./model";
import { serializeReviewEndmatter } from "./review-serialization";
import { attachSourceSnapshots } from "./source-blocks";

// A callable facade is additional integration code, not a library feature.
// The manager uses Lexer/use/lexer/setOptions; all route to one private instance.
function isolatedMarked(): typeof marked {
  const instance = new Marked();
  class ScopedLexer extends marked.Lexer {
    constructor(options: MarkedOptions = instance.defaults) {
      super(options);
    }
  }
  const callable: typeof marked = Object.assign(instance.parse, marked, {
    Lexer: ScopedLexer,
    lexer: instance.lexer.bind(instance),
    parse: instance.parse,
    parseInline: instance.parseInline,
  });
  callable.use = (...extensions) => {
    instance.use(...extensions);
    return callable;
  };
  callable.setOptions = (options) => {
    instance.setOptions(options);
    return callable;
  };
  callable.options = callable.setOptions;
  Object.defineProperty(callable, "defaults", { get: () => instance.defaults });
  return callable;
}

type Document = JSONContent & {
  yamlFrontmatter?: string;
  yamlEndmatter?: string;
  lineEnding?: "\n" | "\r\n";
};
export function parseDirect(markdown: string, options: MarkdownOptions = {}) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const { frontmatter, body, endmatter } =
    splitYamlDocumentMetadata(normalized);
  const envelope = parseReviewEndmatter(endmatter);
  const reserved = collectReviewIds(normalized);
  const comments = new Map<string, CriticComment>();
  const changes = new Map<string, CriticChangeAttrs>();
  const addComment = (
    parsed: Extract<
      ReturnType<typeof scanReview>[number],
      { kind: "comment" }
    >["parsed"],
  ) => {
    const comment = createCommentWithContext(
      {
        ...commentMetadata(parsed.metadata, envelope, "comment"),
        content: parsed.content,
      },
      [...comments.values(), ...reserved.map((id) => ({ id }))],
    );
    comments.set(comment.id, comment);
    return comment.id;
  };
  const changeAttrs = (
    parsed: Extract<
      ReturnType<typeof scanReview>[number],
      { kind: "suggestion" }
    >["parsed"],
  ) => {
    const metadata = commentMetadata(parsed.metadata, envelope, "suggestion");
    const change = createChangeWithContext(
      parsed.suggestionKind === "substitution"
        ? "substitution-old"
        : parsed.suggestionKind,
      { ...metadata, changeId: metadata.id },
      [...changes.values(), ...reserved.map((changeId) => ({ changeId }))],
    );
    changes.set(change.changeId, change);
    return change;
  };
  const apply = (
    nodes: JSONContent[],
    mark: { type: string; attrs: Record<string, unknown> },
  ): JSONContent[] =>
    nodes.map((node) =>
      node.type === "text"
        ? { ...node, marks: [...(node.marks ?? []), mark] }
        : { ...node, content: apply(node.content ?? [], mark) },
    );
  // One scanner implementation for literal reviewed code and prose tokenization.
  const recognize = (source: string, code: boolean) => {
    const highlight = parseHighlight(source, 0);
    const reviews = scanReview(source, source.length, () => {}, { code });
    const first = reviews.find(
      (review) =>
        review.parsed.offset === 0 ||
        (highlight &&
          review.kind === "comment" &&
          review.parsed.offset === highlight.endOffset),
    );
    if (!first) return undefined;
    if (first.kind === "comment") {
      let end = first.parsed.endOffset;
      const ids = [addComment(first.parsed)];
      for (const next of reviews)
        if (next.kind === "comment" && next.parsed.offset === end) {
          ids.push(addComment(next.parsed));
          end = next.parsed.endOffset;
        }
      return {
        raw: source.slice(0, end),
        text: highlight?.text ?? unanchoredCommentSentinel,
        ids,
      };
    }
    const change = changeAttrs(first.parsed);
    let end = first.parsed.endOffset;
    const ids: string[] = [];
    for (const next of reviews)
      if (next.kind === "comment" && next.parsed.offset === end) {
        ids.push(addComment(next.parsed));
        end = next.parsed.endOffset;
      }
    return {
      raw: source.slice(0, end),
      text: first.parsed.text,
      oldText: first.parsed.originalText,
      newText: first.parsed.replacementText,
      change,
      ids,
    };
  };
  const literalCode = (source: string): JSONContent[] => {
    const result: JSONContent[] = [];
    let cursor = 0;
    const push = (text: string) => {
      if (text) result.push({ type: "text", text });
    };
    while (cursor < source.length) {
      const next = source.slice(cursor).search(/\{(?:==|>>|\+\+|--|~~)/);
      if (next < 0) {
        push(source.slice(cursor));
        break;
      }
      push(source.slice(cursor, cursor + next));
      cursor += next;
      const review = recognize(source.slice(cursor), true);
      if (!review) {
        push(source[cursor++]);
        continue;
      }
      const text = (value: string) =>
        value ? [{ type: "text", text: value }] : [];
      let nodes: JSONContent[] =
        review.change?.kind === "substitution-old"
          ? [
              ...apply(text(review.oldText ?? ""), {
                type: "criticChange",
                attrs: { ...review.change, kind: "substitution-old" },
              }),
              ...apply(text(review.newText ?? ""), {
                type: "criticChange",
                attrs: { ...review.change, kind: "substitution-new" },
              }),
            ]
          : review.change
            ? apply(text(review.text), {
                type: "criticChange",
                attrs: { ...review.change },
              })
            : text(review.text);
      if (review.ids.length)
        nodes = apply(nodes, {
          type: "commentRef",
          attrs: { commentIds: review.ids },
        });
      result.push(...nodes);
      cursor += review.raw.length;
    }
    return result;
  };
  const parser = isolatedMarked();
  const handlers: AnyExtension[] = [];
  handlers.push(
    Extension.create({
      name: "directEscape",
      markdownTokenName: "escape",
      parseMarkdown(token, helpers) {
        return helpers.createTextNode(token.text ?? "");
      },
    }),
  );
  handlers.push(
    Extension.create({
      name: "directReview",
      markdownTokenName: "directReview",
      markdownTokenizer: {
        name: "directReview",
        level: "inline",
        start(source) {
          const offset = source.search(/\{(?:==|>>|\+\+|--|~~)/);
          return offset;
        },
        tokenize(source, _tokens, helpers) {
          const review = recognize(source, false);
          if (!review) return undefined;
          return {
            type: "directReview",
            ...review,
            tokens: helpers.inlineTokens(review.text),
            oldTokens: helpers.inlineTokens(review.oldText ?? ""),
            newTokens: helpers.inlineTokens(review.newText ?? ""),
          };
        },
      },
      parseMarkdown(token, helpers) {
        const change: CriticChangeAttrs | undefined = token.change;
        let nodes: JSONContent[] =
          change?.kind === "substitution-old"
            ? [
                ...apply(helpers.parseInline(token.oldTokens), {
                  type: "criticChange",
                  attrs: { ...change, kind: "substitution-old" },
                }),
                ...apply(helpers.parseInline(token.newTokens), {
                  type: "criticChange",
                  attrs: { ...change, kind: "substitution-new" },
                }),
              ]
            : change
              ? apply(helpers.parseInline(token.tokens ?? []), {
                  type: "criticChange",
                  attrs: { ...change },
                })
              : helpers.parseInline(token.tokens ?? []);
        if (token.ids.length)
          nodes = apply(nodes, {
            type: "commentRef",
            attrs: { commentIds: token.ids },
          });
        return nodes;
      },
    }),
  );
  const safeUrl = (url: string, image: boolean) => {
    const compact = [...url]
      .filter((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code > 32 && code !== 127;
      })
      .join("");
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
    if (!scheme) return !compact.startsWith("\\");
    if (image && scheme === "data")
      return /^data:image\/(?:png|gif|jpeg|webp);base64,/i.test(compact);
    return [
      "http",
      "https",
      "ftp",
      "ftps",
      "mailto",
      "tel",
      "callto",
      "sms",
      "cid",
      "xmpp",
      "file",
    ].includes(scheme);
  };
  handlers.push(
    Extension.create({
      name: "directLink",
      markdownTokenName: "link",
      parseMarkdown(token, helpers) {
        const source = token.href ?? "";
        const display = resolveRenderedUrl(
          source,
          (path) =>
            options.resolveLinkUrl?.(path) ??
            options.resolveFileUrl?.(path) ??
            null,
        );
        const nodes = helpers.parseInline(token.tokens ?? []);
        if (!safeUrl(source, false) || !safeUrl(display, false)) return nodes;
        return apply(nodes, {
          type: "link",
          attrs: {
            href: display,
            title: token.title ?? null,
            dataMarkdownSrc: source,
            dataMarkdownAutolink:
              token.raw?.startsWith("<") && token.raw.endsWith(">")
                ? "true"
                : null,
          },
        });
      },
    }),
  );
  handlers.push(
    Extension.create({
      name: "directImage",
      markdownTokenName: "image",
      parseMarkdown(token, helpers) {
        const source = token.href ?? "";
        const display = resolveRenderedUrl(source, options.resolveFileUrl);
        if (
          (options.blockRemoteImages && isExternalUrl(source)) ||
          !safeUrl(source, true) ||
          !safeUrl(display, true)
        )
          return [
            {
              type: "paragraph",
              content: token.text ? [helpers.createTextNode(token.text)] : [],
            },
          ];
        return helpers.createNode("image", {
          src: display,
          alt: token.text ?? "",
          title: token.title ?? null,
          dataMarkdownSrc: source,
        });
      },
    }),
  );
  const manager = createDirectManager(comments, {
    marked: parser,
    parseCode: literalCode,
    useEndmatter: Boolean(endmatter),
    extensions: handlers,
  });
  const ordinary = new Marked({ gfm: true });
  const tokens = ordinary.lexer(body);
  const references = markdownReferenceDefinitions(tokens.links);
  const material = tokens.filter((token) => token.type !== "space");
  const schema = getSchema(createEditorExtensions(""));
  let blocks: JSONContent[] = [];
  const hasHtml = (token: Token | MarkdownToken): boolean =>
    token.type === "html" ||
    Object.values(token).some(
      (value) =>
        Array.isArray(value) &&
        value.some(
          (child) => child && typeof child === "object" && hasHtml(child),
        ),
    );
  const raw = (source: string): JSONContent => {
    for (const id of collectOpaqueReviewIds(source))
      if (!reserved.includes(id)) reserved.push(id);
    return {
      type: "rawMarkdownBlock",
      attrs: { rawMarkdown: encodeRawMarkdownBlock(source) },
    };
  };
  let cursor = 0;
  for (let index = 0; index < material.length; index++) {
    const token = material[index];
    const start = body.indexOf(token.raw, cursor);
    if (start < 0) throw new Error("Block source location not found");
    const next = material[index + 1];
    const end = next
      ? body.indexOf(next.raw, start + token.raw.length)
      : body.length;
    const tokenEnd = start + token.raw.length;
    const gap = body.slice(tokenEnd, end);
    const source = body.slice(cursor, /\S/.test(gap) ? tokenEnd : end);
    // Only a lone top-level image can inhabit this schema's block image node.
    // Descendant images (headings, lists, blockquotes, tables) and mixed prose
    // must remain inert instead of producing an invalid inline block child.
    const images: { href: string }[] = [];
    const findImages = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(findImages);
        return;
      }
      const child = value as Token;
      if (child.type === "image") images.push(child as { href: string });
      for (const [key, nested] of Object.entries(child))
        if (key !== "links") findImages(nested);
    };
    findImages(token);
    const inlineTokens = "tokens" in token ? token.tokens : undefined;
    const loneImage =
      token.type === "paragraph" &&
      Array.isArray(inlineTokens) &&
      inlineTokens.length === 1 &&
      inlineTokens[0]?.type === "image";
    const image = images[0];
    const imageSource = image?.href ?? "";
    const imageDisplay = image
      ? resolveRenderedUrl(imageSource, options.resolveFileUrl)
      : "";
    const unsupportedImage =
      images.length > 0 &&
      (!loneImage ||
        images.length !== 1 ||
        (options.blockRemoteImages && isExternalUrl(imageSource)) ||
        !safeUrl(imageSource, true) ||
        !safeUrl(imageDisplay, true));
    // Prose nested within a suggestion cannot hold two criticChange marks.
    // Keep the whole source block instead of silently dropping the inner ID.
    const nestedReview = scanReview(token.raw, token.raw.length, () => {}, {
      code: token.type === "code",
    }).some(
      (review) =>
        review.kind === "suggestion" &&
        /\{(?:\+\+|--|~~)/.test(review.parsed.text),
    );
    const opaque =
      unsupportedImage ||
      nestedReview ||
      isUnsupportedMarkdownBlock(token) ||
      hasHtml(token);
    const priorComments = new Map(comments);
    const priorChanges = new Map(changes);
    let nodes = opaque
      ? [raw(token.raw)]
      : (manager.parse(token.raw + (references ? `\n\n${references}` : ""))
          .content ?? []);
    if (!opaque) {
      try {
        schema.nodeFromJSON({ type: "doc", content: nodes }).check();
      } catch {
        // A single-mark schema cannot represent every overlapping review.
        // Preserve source instead of mounting invalid JSON or losing a mark.
        comments.clear();
        for (const [id, comment] of priorComments) comments.set(id, comment);
        changes.clear();
        for (const [id, change] of priorChanges) changes.set(id, change);
        nodes = [raw(token.raw)];
      }
    }
    // Manager models blank block separators as implicit paragraphs; Inkback's
    // current schema/source-group parser does not insert those editor nodes.
    while (
      nodes.length > 1 &&
      nodes.at(-1)?.type === "paragraph" &&
      !nodes.at(-1)?.content?.length
    )
      nodes.pop();
    for (const node of nodes) {
      node.attrs = {
        ...node.attrs,
        originalSource: source,
        sourceGroup: `block-${index}`,
      };
      blocks.push(node);
    }
    if (/\S/.test(gap)) {
      const node = raw(gap);
      node.attrs = {
        ...node.attrs,
        originalSource: gap,
        sourceGroup: `gap-${index}`,
      };
      blocks.push(node);
    }
    cursor = end;
  }
  addEndmatterFeedback(comments, envelope);
  // Snapshots must describe schema-normalized nodes, or mounting an Editor
  // changes default attributes and defeats unchanged-source reuse.
  blocks =
    schema.nodeFromJSON({ type: "doc", content: blocks }).toJSON().content ??
    [];
  attachSourceSnapshots(blocks, comments);
  const doc: Document = {
    type: "doc",
    attrs: { reviewIds: reserved },
    content: blocks,
    lineEnding: markdown.includes("\r\n") ? "\r\n" : "\n",
    ...(frontmatter ? { yamlFrontmatter: frontmatter } : {}),
    ...(endmatter ? { yamlEndmatter: endmatter } : {}),
  };
  return {
    doc,
    comments,
    frontmatter,
    endmatter,
    lineEnding: doc.lineEnding ?? "\n",
    manager,
    changes,
  };
}

function serializeDirect(
  state: Pick<
    ReturnType<typeof parseDirect>,
    "doc" | "comments" | "endmatter" | "manager"
  >,
) {
  const { changes, liveComments, opaqueReviewIds } = collectLiveReview(
    state.doc,
    state.comments,
  );
  state.doc.yamlEndmatter =
    serializeReviewEndmatter(
      state.endmatter ?? null,
      liveComments,
      changes,
      opaqueReviewIds,
    ) ?? undefined;
  return saveDirectSource(state.doc, liveComments, state.manager);
}

export function serializeDirectDocument(
  doc: JSONContent,
  comments: Map<string, CriticComment>,
  options?: {
    frontmatter?: string | null;
    endmatter?: string | null;
    lineEnding?: "\n" | "\r\n";
  },
): string {
  const envelope = doc as Document;
  const endmatter = options?.endmatter ?? envelope.yamlEndmatter ?? null;
  return serializeDirect({
    doc: {
      ...envelope,
      yamlFrontmatter: options?.frontmatter ?? envelope.yamlFrontmatter,
      yamlEndmatter: endmatter ?? undefined,
      lineEnding: options?.lineEnding ?? envelope.lineEnding,
    },
    comments,
    endmatter,
    manager: createDirectManager(comments, {
      marked: isolatedMarked(),
      useEndmatter: Boolean(endmatter),
    }),
  });
}
