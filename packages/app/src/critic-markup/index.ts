import {
  hydrateMetadataAttrs,
  type Metadata,
  parseComment,
  parseHighlight,
  parseSuggestion,
} from "@inkback/rfm";
import { generateJSON, type JSONContent } from "@tiptap/core";
import {
  Marked,
  type RendererThis,
  type Token,
  type TokenizerAndRendererExtension,
  type TokenizerThis,
  type Tokens,
} from "marked";
import {
  type CriticChangeAttrs,
  type CriticChangeKind,
  createEditorExtensions,
} from "../editor-extensions";
import {
  createMarkedRenderer,
  type MarkdownOptions,
  protectRichTextRoundTripMarkdown,
  sanitizeMarkdownHtml,
  splitYamlDocumentMetadata,
} from "../markdown";

import {
  type CriticComment,
  createChangeWithContext,
  createCommentWithContext,
  type ParsedEndmatter,
  parseReviewEndmatter,
  unanchoredCommentSentinel,
} from "./model";

interface CriticCommentToken {
  type: "criticCommentAnchor";
  raw: string;
  commentIds: string[];
  tokens: Token[];
}

interface CriticStandaloneCommentToken {
  type: "criticStandaloneComment";
  raw: string;
  commentIds: string[];
}

interface CriticChangeToken {
  type: "criticChange";
  raw: string;
  change: CriticChangeAttrs;
  commentIds: string[];
  tokens?: Token[];
  oldTokens?: Token[];
  newTokens?: Token[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function commentPartialFromEndmatterEntry(
  id: string,
  entry?: Record<string, unknown>,
  options?: { includeParent?: boolean },
): Partial<Omit<CriticComment, "content">> {
  const author = typeof entry?.by === "string" ? entry.by : "user";
  const includeParent = options?.includeParent ?? true;

  return {
    id,
    createdAt:
      typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId:
      includeParent && typeof entry?.re === "string" ? entry.re : null,
  };
}

const ignoreDiagnostic = () => {};

function commentMetadata(
  metadata: Metadata | null,
  endmatter: ParsedEndmatter | undefined,
  kind: "comment" | "suggestion",
) {
  const fields =
    metadata && endmatter
      ? hydrateMetadataAttrs(metadata, endmatter, kind)
      : (metadata?.attrs ?? new Map<string, string>());
  const author = fields.get("by") ?? "user";
  return {
    id: fields.get("id"),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType:
      author.toUpperCase() === "AI" ? ("ai" as const) : ("user" as const),
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId:
      metadata?.kind === "reference" ? null : (fields.get("re") ?? null),
  };
}

function addEndmatterFeedback(
  comments: Map<string, CriticComment>,
  endmatter: ParsedEndmatter,
) {
  for (const [id, entry] of endmatter.comments) {
    if (typeof entry.body !== "string") {
      continue;
    }
    if (comments.has(id)) {
      continue;
    }

    comments.set(
      id,
      createCommentWithContext({
        ...commentPartialFromEndmatterEntry(id, entry),
        content: entry.body,
        parentCommentId: typeof entry.re === "string" ? entry.re : null,
        scope: typeof entry.re === "string" ? undefined : "document",
      }),
    );
  }
}

function tokenizeCriticCommentAnchor(
  lexer: TokenizerThis["lexer"],
  src: string,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
):
  | {
      token: CriticCommentToken;
      comments: CriticComment[];
    }
  | undefined {
  const highlight = parseHighlight(src, 0);

  if (!highlight?.text) return undefined;

  const anchor = highlight.text;
  let raw = src.slice(0, highlight.endOffset);
  const offset = raw.length;
  const result = tokenizeCriticCommentBlocks(
    src,
    offset,
    existingComments,
    endmatter,
  );
  const parsedComments = result.comments;
  raw += result.raw;

  if (parsedComments.length === 0) return undefined;

  return {
    token: {
      type: "criticCommentAnchor",
      raw,
      commentIds: parsedComments.map((comment) => comment.id),
      tokens: lexer.inlineTokens(anchor),
    },
    comments: parsedComments,
  };
}

function tokenizeCriticCommentBlocks(
  src: string,
  offset: number,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
) {
  let raw = "";
  let nextOffset = offset;
  const parsedComments: CriticComment[] = [];

  while (nextOffset < src.length) {
    const parsed = parseComment(src, nextOffset, ignoreDiagnostic);
    if (!parsed) break;
    const comment = createCommentWithContext(
      {
        ...commentMetadata(parsed.metadata, endmatter, "comment"),
        content: parsed.content,
      },
      [...existingComments, ...parsedComments],
    );
    parsedComments.push(comment);
    raw += src.slice(nextOffset, parsed.endOffset);
    nextOffset = parsed.endOffset;
  }

  return {
    raw,
    comments: parsedComments,
  };
}

function tokenizeCriticStandaloneComment(
  src: string,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
):
  | {
      token: CriticStandaloneCommentToken;
      comments: CriticComment[];
    }
  | undefined {
  const result = tokenizeCriticCommentBlocks(
    src,
    0,
    existingComments,
    endmatter,
  );

  if (result.comments.length === 0) return undefined;

  return {
    token: {
      type: "criticStandaloneComment",
      raw: result.raw,
      commentIds: result.comments.map((comment) => comment.id),
    },
    comments: result.comments,
  };
}

function tokenizeCriticChange(
  lexer: TokenizerThis["lexer"],
  src: string,
  existingChanges: Iterable<Pick<CriticChangeAttrs, "changeId">>,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
):
  | {
      token: CriticChangeToken;
      comments: CriticComment[];
    }
  | undefined {
  const parsed = parseSuggestion(src, 0, ignoreDiagnostic);
  if (
    !parsed ||
    (parsed.suggestionKind !== "substitution" && !parsed.text) ||
    (parsed.suggestionKind === "substitution" &&
      (!parsed.originalText || !parsed.replacementText))
  )
    return undefined;
  const trailing = tokenizeCriticCommentBlocks(
    src,
    parsed.endOffset,
    existingComments,
    endmatter,
  );
  const metadata = commentMetadata(parsed.metadata, endmatter, "suggestion");
  const change = createChangeWithContext(
    parsed.suggestionKind === "substitution"
      ? "substitution-old"
      : parsed.suggestionKind,
    {
      changeId: metadata.id,
      createdAt: metadata.createdAt,
      authorType: metadata.authorType,
      authorId: metadata.authorId,
    },
    existingChanges,
  );
  return {
    token: {
      type: "criticChange",
      raw: src.slice(0, parsed.endOffset) + trailing.raw,
      change,
      commentIds: trailing.comments.map((comment) => comment.id),
      ...(parsed.suggestionKind === "substitution"
        ? {
            oldTokens: lexer.inlineTokens(parsed.originalText ?? ""),
            newTokens: lexer.inlineTokens(parsed.replacementText ?? ""),
          }
        : { tokens: lexer.inlineTokens(parsed.text) }),
    },
    comments: trailing.comments,
  };
}

function renderCriticChangeSpan(
  change: CriticChangeAttrs,
  content: string,
  kind: CriticChangeKind = change.kind,
  commentIds: string[] = [],
) {
  const by = change.authorType === "ai" ? "AI" : change.authorId || "user";
  const changeSpan = `<span data-critic-change-kind="${escapeHtml(kind)}" data-critic-change-id="${escapeHtml(
    change.changeId,
  )}" data-critic-change-by="${escapeHtml(by)}" data-critic-change-at="${escapeHtml(
    change.createdAt,
  )}">${content}</span>`;

  if (commentIds.length === 0) {
    return changeSpan;
  }

  return `<span data-comment-ids="${escapeHtml(
    JSON.stringify(commentIds),
  )}">${changeSpan}</span>`;
}

function renderCriticCodeText(
  text: string,
  comments: Map<string, CriticComment>,
  endmatter?: ParsedEndmatter,
) {
  let result = "";
  let offset = 0;

  while (offset < text.length) {
    const highlight = parseHighlight(text, offset);

    if (!highlight?.text) {
      result += escapeHtml(text[offset] ?? "");
      offset += 1;
      continue;
    }

    const anchor = highlight.text;
    let nextOffset = highlight.endOffset;
    const parsed = tokenizeCriticCommentBlocks(
      text,
      nextOffset,
      comments.values(),
      endmatter,
    );
    const parsedComments = parsed.comments;
    nextOffset += parsed.raw.length;

    if (parsedComments.length === 0) {
      result += escapeHtml(text.slice(offset, highlight.endOffset));
      offset = highlight.endOffset;
      continue;
    }

    for (const comment of parsedComments) {
      comments.set(comment.id, comment);
    }

    result += `<span data-comment-ids="${escapeHtml(
      JSON.stringify(parsedComments.map((comment) => comment.id)),
    )}">${escapeHtml(anchor)}</span>`;
    offset = nextOffset;
  }

  return result;
}

function renderCriticCodeBlock(
  token: Tokens.Code,
  comments: Map<string, CriticComment>,
  endmatter?: ParsedEndmatter,
) {
  const language = (token.lang || "").match(/\S+/)?.[0];
  const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
  const content = token.escaped
    ? token.text
    : renderCriticCodeText(token.text, comments, endmatter);

  return `<pre><code${classAttr}>${content}</code></pre>\n`;
}

function createCriticMarked(
  markdownOptions?: MarkdownOptions,
  endmatter?: ParsedEndmatter,
) {
  const comments = new Map<string, CriticComment>();
  const changes = new Map<string, CriticChangeAttrs>();
  const renderer = createMarkedRenderer(markdownOptions);
  renderer.code = (token) => renderCriticCodeBlock(token, comments, endmatter);
  const parser = new Marked({
    gfm: true,
    async: false,
    renderer,
  });

  parser.use({
    extensions: [
      {
        name: "criticCommentAnchor",
        level: "inline",
        start(src: string) {
          return src.indexOf("{==");
        },
        tokenizer(this: TokenizerThis, src: string) {
          const result = tokenizeCriticCommentAnchor(
            this.lexer,
            src,
            comments.values(),
            endmatter,
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          return result.token;
        },
        renderer(this: RendererThis, token: Tokens.Generic) {
          const criticToken = token as CriticCommentToken;
          return `<span data-comment-ids="${escapeHtml(
            JSON.stringify(criticToken.commentIds),
          )}">${this.parser.parseInline(criticToken.tokens)}</span>`;
        },
        childTokens: ["tokens"],
      } satisfies TokenizerAndRendererExtension,
      {
        name: "criticStandaloneComment",
        level: "inline",
        start(src: string) {
          return src.indexOf("{>>");
        },
        tokenizer(src: string) {
          const result = tokenizeCriticStandaloneComment(
            src,
            comments.values(),
            endmatter,
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          return result.token;
        },
        renderer(token: Tokens.Generic) {
          const criticToken = token as CriticStandaloneCommentToken;
          return `<span data-comment-ids="${escapeHtml(
            JSON.stringify(criticToken.commentIds),
          )}" data-comment-anchorless="true">${unanchoredCommentSentinel}</span>`;
        },
      } satisfies TokenizerAndRendererExtension,
      {
        name: "criticChange",
        level: "inline",
        start(src: string) {
          const starts = ["{++", "{--", "{~~"]
            .map((marker) => src.indexOf(marker))
            .filter((index) => index >= 0);

          return starts.length > 0 ? Math.min(...starts) : undefined;
        },
        tokenizer(this: TokenizerThis, src: string) {
          const result = tokenizeCriticChange(
            this.lexer,
            src,
            changes.values(),
            comments.values(),
            endmatter,
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          changes.set(result.token.change.changeId, result.token.change);
          return result.token;
        },
        renderer(this: RendererThis, token: Tokens.Generic) {
          const criticToken = token as CriticChangeToken;

          if (criticToken.change.kind === "substitution-old") {
            const oldContent = this.parser.parseInline(
              criticToken.oldTokens ?? [],
            );
            const newContent = this.parser.parseInline(
              criticToken.newTokens ?? [],
            );
            const substitutionHtml = `${renderCriticChangeSpan(
              criticToken.change,
              oldContent,
              "substitution-old",
            )}${renderCriticChangeSpan(
              criticToken.change,
              newContent,
              "substitution-new",
            )}`;

            if (criticToken.commentIds.length === 0) {
              return substitutionHtml;
            }

            return `<span data-comment-ids="${escapeHtml(
              JSON.stringify(criticToken.commentIds),
            )}">${substitutionHtml}</span>`;
          }

          return renderCriticChangeSpan(
            criticToken.change,
            this.parser.parseInline(criticToken.tokens ?? []),
            criticToken.change.kind,
            criticToken.commentIds,
          );
        },
        childTokens: ["tokens", "oldTokens", "newTokens"],
      } satisfies TokenizerAndRendererExtension,
    ],
  });

  return { parser, comments, changes };
}

export function criticMarkdownHasReviewRail(
  markdown: string,
  options?: MarkdownOptions,
): boolean {
  const { body, endmatter } = splitYamlDocumentMetadata(markdown);
  const parsedEndmatter = parseReviewEndmatter(endmatter);
  const { parser, comments, changes } = createCriticMarked(
    options,
    parsedEndmatter,
  );
  parser.parse(protectRichTextRoundTripMarkdown(body));
  addEndmatterFeedback(comments, parsedEndmatter);
  return comments.size > 0 || changes.size > 0;
}

export function criticMarkdownToRenderedHtml(
  markdown: string,
  options?: MarkdownOptions,
): {
  html: string;
  comments: Map<string, CriticComment>;
  changes: Map<string, CriticChangeAttrs>;
  frontmatter: string | null;
  endmatter: string | null;
} {
  const { frontmatter, body, endmatter } = splitYamlDocumentMetadata(markdown);
  const parsedEndmatter = parseReviewEndmatter(endmatter);
  const { parser, comments, changes } = createCriticMarked(
    options,
    parsedEndmatter,
  );
  const html = sanitizeMarkdownHtml(
    parser.parse(protectRichTextRoundTripMarkdown(body)) as string,
  );
  addEndmatterFeedback(comments, parsedEndmatter);

  return { html, comments, changes, frontmatter, endmatter };
}

export function criticMarkdownToEditorState(
  markdown: string,
  options?: MarkdownOptions,
): {
  doc: JSONContent;
  comments: Map<string, CriticComment>;
  frontmatter: string | null;
  endmatter: string | null;
} {
  const { frontmatter, body, endmatter } = splitYamlDocumentMetadata(markdown);
  const parsedEndmatter = parseReviewEndmatter(endmatter);
  const { parser, comments } = createCriticMarked(options, parsedEndmatter);
  const html = sanitizeMarkdownHtml(
    parser.parse(protectRichTextRoundTripMarkdown(body)) as string,
  );
  const doc = generateJSON(html, extensions) as JSONContent & {
    yamlFrontmatter?: string;
    yamlEndmatter?: string;
  };
  addEndmatterFeedback(comments, parsedEndmatter);
  if (frontmatter) {
    doc.yamlFrontmatter = frontmatter;
  }
  if (endmatter) {
    doc.yamlEndmatter = endmatter;
  }

  return { doc, comments, frontmatter, endmatter };
}

const extensions = createEditorExtensions("");
