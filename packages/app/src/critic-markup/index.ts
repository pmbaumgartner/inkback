import { collectReviewIds, parseHighlight, scanReview } from "@inkback/rfm";
import {
  Marked,
  type RendererThis,
  type Token,
  type TokenizerAndRendererExtension,
  type TokenizerThis,
  type Tokens,
} from "marked";
import type { CriticChangeAttrs, CriticChangeKind } from "../editor-extensions";
import {
  createMarkedRenderer,
  type MarkdownOptions,
  protectRichTextRoundTripMarkdown,
  sanitizeMarkdownHtml,
  splitYamlDocumentMetadata,
} from "../markdown";
import { addEndmatterFeedback, commentMetadata } from "./hydration";
import {
  type CriticComment,
  createChangeWithContext,
  createCommentWithContext,
  type ParsedEndmatter,
  parseReviewEndmatter,
  unanchoredCommentSentinel,
} from "./model";

const ignoreDiagnostic = () => {};

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
    const recognized = scanReview(
      src.slice(nextOffset),
      src.length - nextOffset,
      ignoreDiagnostic,
    )[0];
    const parsed =
      recognized?.kind === "comment" && recognized.parsed.offset === 0
        ? recognized.parsed
        : null;
    if (!parsed) break;
    const comment = createCommentWithContext(
      {
        ...commentMetadata(parsed.metadata, endmatter, "comment"),
        content: parsed.content,
      },
      [
        ...existingComments,
        ...parsedComments,
        ...[
          ...(endmatter?.comments.keys() ?? []),
          ...(endmatter?.suggestions.keys() ?? []),
        ].map((id) => ({ id })),
      ],
    );
    parsedComments.push(comment);
    raw += src.slice(nextOffset, nextOffset + parsed.endOffset);
    nextOffset += parsed.endOffset;
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
  const recognized = scanReview(src, src.length, ignoreDiagnostic)[0];
  const parsed =
    recognized?.kind === "suggestion" && recognized.parsed.offset === 0
      ? recognized.parsed
      : null;
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
      metadata: metadata.metadata,
      createdAt: metadata.createdAt,
      authorType: metadata.authorType,
      authorId: metadata.authorId,
    },
    [
      ...existingChanges,
      ...[
        ...(endmatter?.suggestions.keys() ?? []),
        ...(endmatter?.comments.keys() ?? []),
      ].map((changeId) => ({ changeId })),
    ],
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
  )}" data-critic-change-metadata="${escapeHtml(JSON.stringify(change.metadata ?? {}))}">${content}</span>`;

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
  changes: Map<string, CriticChangeAttrs>,
  endmatter?: ParsedEndmatter,
  reservedIds: string[] = [],
) {
  const startOf = (token: ReturnType<typeof scanReview>[number]) =>
    token.kind === "comment" && token.anchorText !== undefined
      ? text.lastIndexOf("{==", token.parsed.offset)
      : token.parsed.offset;
  const tokens = scanReview(text, text.length, ignoreDiagnostic, {
    code: true,
  }).sort((left, right) => startOf(left) - startOf(right));
  let result = "";
  let cursor = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) throw new Error("Expected a CriticMarkup code token");
    const parsed = token.parsed;
    if (parsed.offset < cursor) continue;
    if (token.kind === "comment") {
      const anchorStart =
        token.anchorText !== undefined
          ? text.lastIndexOf("{==", parsed.offset)
          : parsed.offset;
      result += escapeHtml(text.slice(cursor, anchorStart));
      const grouped = [token];
      let lastComment = token;
      while (true) {
        const next = tokens[index + 1];
        if (
          next?.kind !== "comment" ||
          next.parsed.offset !== lastComment.parsed.endOffset
        )
          break;
        grouped.push(next);
        lastComment = next;
        index++;
      }
      const ids: string[] = [];
      for (const commentToken of grouped) {
        const comment = createCommentWithContext(
          {
            ...commentMetadata(
              commentToken.parsed.metadata,
              endmatter,
              "comment",
            ),
            content: commentToken.parsed.content,
          },
          [
            ...comments.values(),
            ...reservedIds.map((id) => ({ id })),
            ...[
              ...(endmatter?.comments.keys() ?? []),
              ...(endmatter?.suggestions.keys() ?? []),
            ].map((id) => ({ id })),
          ],
        );
        comments.set(comment.id, comment);
        ids.push(comment.id);
      }
      result += `<span data-comment-ids="${escapeHtml(JSON.stringify(ids))}">${token.anchorText !== undefined ? renderCriticCodeText(token.anchorText, comments, changes, endmatter, reservedIds) : unanchoredCommentSentinel}</span>`;
      cursor = lastComment.parsed.endOffset;
    } else {
      result += escapeHtml(text.slice(cursor, parsed.offset));
      const metadata = commentMetadata(
        parsed.metadata,
        endmatter,
        "suggestion",
      );
      const change = createChangeWithContext(
        token.parsed.suggestionKind === "substitution"
          ? "substitution-old"
          : token.parsed.suggestionKind,
        { changeId: metadata.id, ...metadata },
        [
          ...changes.values(),
          ...reservedIds.map((changeId) => ({ changeId })),
          ...[...(endmatter?.suggestions.keys() ?? [])].map((changeId) => ({
            changeId,
          })),
        ],
      );
      changes.set(change.changeId, change);
      result +=
        token.parsed.suggestionKind === "substitution"
          ? renderCriticChangeSpan(
              change,
              escapeHtml(token.parsed.originalText ?? ""),
              "substitution-old",
            ) +
            renderCriticChangeSpan(
              change,
              escapeHtml(token.parsed.replacementText ?? ""),
              "substitution-new",
            )
          : renderCriticChangeSpan(change, escapeHtml(token.parsed.text));
      cursor = parsed.endOffset;
    }
  }
  return result + escapeHtml(text.slice(cursor));
}

function renderCriticCodeBlock(
  token: Tokens.Code,
  comments: Map<string, CriticComment>,
  changes: Map<string, CriticChangeAttrs>,
  endmatter?: ParsedEndmatter,
  reservedIds: string[] = [],
) {
  const language = (token.lang || "").match(/\S+/)?.[0];
  const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
  const content = token.escaped
    ? token.text
    : renderCriticCodeText(
        token.text,
        comments,
        changes,
        endmatter,
        reservedIds,
      );

  return `<pre><code${classAttr}>${content}</code></pre>\n`;
}

function createCriticMarked(
  markdownOptions?: MarkdownOptions,
  endmatter?: ParsedEndmatter,
  reservedIds: string[] = [],
) {
  const comments = new Map<string, CriticComment>();
  const changes = new Map<string, CriticChangeAttrs>();
  const renderer = createMarkedRenderer(markdownOptions);
  renderer.code = (token) =>
    renderCriticCodeBlock(token, comments, changes, endmatter, reservedIds);
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
            [...comments.values(), ...reservedIds.map((id) => ({ id }))],
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
            [...comments.values(), ...reservedIds.map((id) => ({ id }))],
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
            [
              ...changes.values(),
              ...reservedIds.map((changeId) => ({ changeId })),
            ],
            [...comments.values(), ...reservedIds.map((id) => ({ id }))],
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
    collectReviewIds(markdown),
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
    collectReviewIds(markdown),
  );
  const html = sanitizeMarkdownHtml(
    parser.parse(protectRichTextRoundTripMarkdown(body)) as string,
  );
  addEndmatterFeedback(comments, parsedEndmatter);

  return { html, comments, changes, frontmatter, endmatter };
}
