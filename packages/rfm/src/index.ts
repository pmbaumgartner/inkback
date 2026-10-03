import {
  createLineStarts,
  hydrateMetadataAttrs,
  locationForOffset,
  type Metadata,
  type ParsedComment,
  type ParsedSuggestion,
  parseCanonicalMetadata,
  scanReview,
  serializeMetadataAttributes,
} from "./grammar.js";

export {
  hydrateMetadataAttrs,
  type Metadata,
  type ParsedComment,
  type ParsedSuggestion,
  parseComment,
  parseHighlight,
  parseMetadata,
  parseSuggestion,
  serializeMetadataAttributes,
} from "./grammar.js";

interface ReplyReference {
  id: string;
  parentId: string;
  offset: number;
}
interface IdReference {
  id: string;
  kind: "comment" | "suggestion";
  offset: number;
}
const CRITICMARKUP_CLOSE_DELIMITER_PATTERN = /<<}|\+\+}|--}|~~}|==}/;
export type RfmDiagnosticSeverity = "error" | "warning";

export interface RfmDiagnostic {
  severity: RfmDiagnosticSeverity;
  code: string;
  message: string;
  offset: number;
  line: number;
  column: number;
}

export interface RfmValidationSummary {
  comments: number;
  suggestions: number;
  legacyMetadata: number;
}

export interface RfmValidationResult {
  format: "inkback-flavored-markdown";
  version: "0.2";
  ok: boolean;
  diagnostics: RfmDiagnostic[];
  errors: RfmDiagnostic[];
  warnings: RfmDiagnostic[];
  summary: RfmValidationSummary;
}

export type RfmReviewItemKind = "comment" | "suggestion" | "reply";
export type RfmSuggestionKind = "addition" | "deletion" | "substitution";

export interface RfmReviewItem {
  id: string;
  kind: RfmReviewItemKind;
  suggestionKind?: RfmSuggestionKind;
  parentId: string | null;
  author: string | null;
  createdAt: string | null;
  status: string | null;
  text: string;
  originalText?: string;
  replacementText?: string;
  anchorText?: string;
  offset: number;
  endOffset: number;
  line: number;
  column: number;
}

export interface RfmReviewIndexSummary {
  comments: number;
  replies: number;
  suggestions: number;
  unresolved: number;
}

export interface RfmReviewIndex {
  format: "inkback-flavored-markdown";
  version: "0.2";
  items: RfmReviewItem[];
  diagnostics: RfmDiagnostic[];
  summary: RfmReviewIndexSummary;
}

export interface AppendInkbackReplyOptions {
  parentId: string;
  message: string;
  author?: string;
  at?: string;
  id?: string;
}

export interface AppendInkbackDocumentCommentOptions {
  message: string;
  author?: string;
  at?: string;
  id?: string;
}

export interface MarkInkbackResolvedOptions {
  targetId: string;
  summary?: string;
}

export interface RfmEndmatterEntry {
  body?: string;
  by?: string;
  at?: string;
  re?: string;
  status?: string;
  resolved?: string;
  [key: string]: unknown;
}

export interface RfmEndmatter {
  comments: Map<string, RfmEndmatterEntry>;
  suggestions: Map<string, RfmEndmatterEntry>;
  data: Record<string, unknown> | null;
  raw: string | null;
  offset: number | null;
  diagnostics: Array<{ code: string; message: string; offset: number }>;
}

const RFM_VERSION = "0.2" as const;
const requiredMetadataAttributes = ["id", "by", "at"] as const;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseReviewDocument(markdown: string) {
  const lineStarts = createLineStarts(markdown);
  const endmatter = parseRfmEndmatter(markdown);
  const syntaxDiagnostics: RfmDiagnostic[] = [];
  const tokens = scanReview(
    markdown,
    endmatter.offset ?? markdown.length,
    (severity, code, message, offset) => {
      syntaxDiagnostics.push({
        severity,
        code,
        message,
        offset,
        ...locationForOffset(lineStarts, offset),
      });
    },
  );
  return { lineStarts, endmatter, tokens, syntaxDiagnostics };
}
export function validateInkbackMarkdown(markdown: string): RfmValidationResult {
  return validateParsedReview(parseReviewDocument(markdown));
}
function validateParsedReview({
  lineStarts,
  endmatter,
  tokens,
  syntaxDiagnostics,
}: ReturnType<typeof parseReviewDocument>): RfmValidationResult {
  const diagnostics: RfmDiagnostic[] = [...syntaxDiagnostics];
  const ids = new Map<string, IdReference>();
  const replies: ReplyReference[] = [];
  const summary: RfmValidationSummary = {
    comments: 0,
    suggestions: 0,
    legacyMetadata: 0,
  };

  const addDiagnostic = (
    severity: RfmDiagnosticSeverity,
    code: string,
    message: string,
    offset: number,
  ) => {
    diagnostics.push({
      severity,
      code,
      message,
      offset,
      ...locationForOffset(lineStarts, offset),
    });
  };

  for (const diagnostic of endmatter.diagnostics) {
    addDiagnostic(
      "error",
      diagnostic.code,
      diagnostic.message,
      diagnostic.offset,
    );
  }

  const validateMetadata = (
    metadata: Metadata | null,
    kind: "comment" | "suggestion",
    markerOffset: number,
  ) => {
    if (!metadata) {
      for (const attribute of requiredMetadataAttributes) {
        addDiagnostic(
          "error",
          `missing-metadata-${attribute}`,
          `Missing required metadata attribute \`${attribute}\`.`,
          markerOffset,
        );
      }
      return;
    }

    if (metadata.kind === "reference") {
      const id = metadata.attrs.get("id");
      const entry =
        kind === "comment"
          ? endmatter.comments.get(id ?? "")
          : endmatter.suggestions.get(id ?? "");

      if (!id || !entry) {
        addDiagnostic(
          "error",
          "missing-endmatter-entry",
          `Missing YAML endmatter entry for review id \`${id ?? ""}\`.`,
          metadata.offset,
        );
        return;
      }

      const existing = ids.get(id);
      if (existing) {
        addDiagnostic(
          "error",
          "duplicate-id",
          `Duplicate review id \`${id}\`.`,
          metadata.offset,
        );
      } else {
        ids.set(id, { id, kind, offset: metadata.offset });
      }

      validateEndmatterEntry(id, entry, metadata.offset, addDiagnostic, false);
      return;
    }

    if (metadata.kind === "legacy") {
      summary.legacyMetadata += 1;
      addDiagnostic(
        "warning",
        "legacy-metadata",
        "Legacy metadata is accepted, but canonical attribute metadata is preferred.",
        metadata.offset,
      );
    }

    for (const attribute of requiredMetadataAttributes) {
      if (!metadata.attrs.get(attribute)) {
        addDiagnostic(
          "error",
          `missing-metadata-${attribute}`,
          `Missing required metadata attribute \`${attribute}\`.`,
          metadata.offset,
        );
      }
    }

    const at = metadata.attrs.get("at");
    if (at && !isValidDateTime(at)) {
      addDiagnostic(
        "error",
        "invalid-metadata-at",
        `Metadata attribute \`at\` must be an ISO 8601 date-time.`,
        metadata.offset,
      );
    }

    const id = metadata.attrs.get("id");
    if (id) {
      const existing = ids.get(id);
      if (existing) {
        addDiagnostic(
          "error",
          "duplicate-id",
          `Duplicate review id \`${id}\`.`,
          metadata.offset,
        );
      } else {
        ids.set(id, { id, kind, offset: metadata.offset });
      }
    }

    const parentId = metadata.attrs.get("re");
    if (kind === "comment" && id && parentId) {
      replies.push({ id, parentId, offset: metadata.offset });
    }
  };

  for (const token of tokens) {
    if (token.kind === "comment") summary.comments++;
    else summary.suggestions++;
    validateMetadata(token.parsed.metadata, token.kind, token.parsed.offset);
  }

  for (const [id, entry] of endmatter.comments) {
    if (!entry.body && !entry.re) continue;

    const existing = ids.get(id);
    if (existing) {
      addDiagnostic(
        "error",
        "duplicate-id",
        `Duplicate review id \`${id}\`.`,
        endmatter.offset ?? 0,
      );
      continue;
    }

    ids.set(id, { id, kind: "comment", offset: endmatter.offset ?? 0 });
    summary.comments += 1;
    validateEndmatterEntry(
      id,
      entry,
      endmatter.offset ?? 0,
      addDiagnostic,
      Boolean(entry.re),
    );
    if (entry.re) {
      replies.push({
        id,
        parentId: String(entry.re),
        offset: endmatter.offset ?? 0,
      });
    }
  }

  for (const reply of replies) {
    if (reply.id === reply.parentId) {
      addDiagnostic(
        "error",
        "self-reply",
        `Comment \`${reply.id}\` must not reply to itself.`,
        reply.offset,
      );
      continue;
    }

    if (reply.parentId && !ids.has(reply.parentId)) {
      addDiagnostic(
        "warning",
        "missing-reply-target",
        `Comment reply \`re="${reply.parentId}"\` points to a missing id.`,
        reply.offset,
      );
    }
  }

  for (const [id] of endmatter.suggestions) {
    if (endmatter.comments.has(id)) {
      addDiagnostic(
        "error",
        "duplicate-id",
        `Duplicate review id \`${id}\` across comments and suggestions endmatter.`,
        endmatter.offset ?? 0,
      );
    }
  }

  diagnostics.sort((a, b) => a.offset - b.offset);
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  );

  return {
    format: "inkback-flavored-markdown",
    version: RFM_VERSION,
    ok: errors.length === 0,
    diagnostics,
    errors,
    warnings,
    summary,
  };
}

export function extractInkbackReviewIndex(markdown: string): RfmReviewIndex {
  const parsed = parseReviewDocument(markdown);
  const { lineStarts, endmatter, tokens } = parsed;
  const validation = validateParsedReview(parsed);
  const items: RfmReviewItem[] = [];

  const addComment = (parsed: ParsedComment, anchorText?: string) => {
    const attrs = hydrateMetadataAttrs(parsed.metadata, endmatter, "comment");
    const id = attrs.get("id") ?? `comment-${parsed.offset.toString()}`;
    const parentId = attrs.get("re") ?? null;

    items.push({
      id,
      kind: parentId ? "reply" : "comment",
      parentId,
      author: attrs.get("by") ?? null,
      createdAt: attrs.get("at") ?? null,
      status: attrs.get("status") ?? null,
      text: parsed.content,
      anchorText,
      offset: parsed.offset,
      endOffset: parsed.endOffset,
      ...locationForOffset(lineStarts, parsed.offset),
    });
  };

  const addSuggestion = (parsed: ParsedSuggestion) => {
    const attrs = hydrateMetadataAttrs(
      parsed.metadata,
      endmatter,
      "suggestion",
    );
    const id = attrs.get("id") ?? `suggestion-${parsed.offset.toString()}`;

    items.push({
      id,
      kind: "suggestion",
      suggestionKind: parsed.suggestionKind,
      parentId: null,
      author: attrs.get("by") ?? null,
      createdAt: attrs.get("at") ?? null,
      status: attrs.get("status") ?? null,
      text: parsed.text,
      originalText: parsed.originalText,
      replacementText: parsed.replacementText,
      offset: parsed.offset,
      endOffset: parsed.endOffset,
      ...locationForOffset(lineStarts, parsed.offset),
    });
  };

  for (const token of tokens) {
    if (token.kind === "comment") addComment(token.parsed, token.anchorText);
    else addSuggestion(token.parsed);
  }

  for (const [id, entry] of endmatter.comments) {
    if (!entry.body) continue;

    items.push({
      id,
      kind: entry.re ? "reply" : "comment",
      parentId: entry.re ? String(entry.re) : null,
      author: typeof entry.by === "string" ? entry.by : null,
      createdAt: typeof entry.at === "string" ? entry.at : null,
      status: typeof entry.status === "string" ? entry.status : null,
      text: String(entry.body),
      offset: endmatter.offset ?? markdown.length,
      endOffset: endmatter.offset ?? markdown.length,
      ...locationForOffset(lineStarts, endmatter.offset ?? markdown.length),
    });
  }

  return {
    format: "inkback-flavored-markdown",
    version: RFM_VERSION,
    items,
    diagnostics: validation.diagnostics,
    summary: {
      comments: items.filter((item) => item.kind === "comment").length,
      replies: items.filter((item) => item.kind === "reply").length,
      suggestions: items.filter((item) => item.kind === "suggestion").length,
      unresolved: items.filter((item) => item.status !== "resolved").length,
    },
  };
}

export function appendInkbackDocumentComment(
  markdown: string,
  options: AppendInkbackDocumentCommentOptions,
): string {
  assertSafeCommentBodyText(options.message);

  const index = extractInkbackReviewIndex(markdown);
  const endmatter = parseRfmEndmatter(markdown);
  const commentId = options.id ?? nextCommentId(index.items);
  const comments = new Map(endmatter.comments);
  comments.set(commentId, {
    body: options.message,
    by: options.author ?? "user",
    at: options.at ?? new Date().toISOString(),
  });

  return updateRfmEndmatter(markdown, comments, endmatter.suggestions);
}

export function appendInkbackReply(
  markdown: string,
  options: AppendInkbackReplyOptions,
): string {
  assertSafeCommentBodyText(options.message);

  const index = extractInkbackReviewIndex(markdown);
  const parent = index.items.find((item) => item.id === options.parentId);
  if (!parent) {
    throw new Error(`Review item not found: ${options.parentId}`);
  }

  const endmatter = parseRfmEndmatter(markdown);
  if (isEndmatterBackedItem(markdown, parent)) {
    const replyId = options.id ?? nextCommentId(index.items);
    const comments = new Map(endmatter.comments);
    comments.set(replyId, {
      body: options.message,
      by: options.author ?? "AI",
      at: options.at ?? new Date().toISOString(),
      re: options.parentId,
    });
    return updateRfmEndmatter(markdown, comments, endmatter.suggestions);
  }

  const reply = `{>>${options.message}<<}${serializeMetadataAttributes({
    id: options.id ?? nextCommentId(index.items),
    by: options.author ?? "AI",
    at: options.at ?? new Date().toISOString(),
    re: options.parentId,
  })}`;

  return `${markdown.slice(0, parent.endOffset)}${reply}${markdown.slice(parent.endOffset)}`;
}

function assertSafeCommentBodyText(message: string): void {
  const match = message.match(CRITICMARKUP_CLOSE_DELIMITER_PATTERN);
  if (!match) return;

  throw new Error(
    `Reply text contains CriticMarkup close delimiter "${match[0]}". Rewrite the reply without raw CriticMarkup delimiters.`,
  );
}

export function markInkbackResolved(
  markdown: string,
  options: MarkInkbackResolvedOptions,
): string {
  const index = extractInkbackReviewIndex(markdown);
  const target = index.items.find((item) => item.id === options.targetId);
  if (!target) {
    throw new Error(`Review item not found: ${options.targetId}`);
  }

  const endmatter = parseRfmEndmatter(markdown);
  const endmatterKind = endmatter.comments.has(options.targetId)
    ? "comment"
    : endmatter.suggestions.has(options.targetId)
      ? "suggestion"
      : null;

  if (endmatterKind) {
    const comments = new Map(endmatter.comments);
    const suggestions = new Map(endmatter.suggestions);
    const map = endmatterKind === "comment" ? comments : suggestions;
    const current = map.get(options.targetId) ?? {};
    map.set(options.targetId, {
      ...current,
      status: "resolved",
      ...(options.summary ? { resolved: options.summary } : {}),
    });
    return updateRfmEndmatter(markdown, comments, suggestions);
  }

  const metadataStart = findCanonicalMetadataStart(markdown, target.endOffset);
  if (metadataStart === null) {
    throw new Error(
      `Review item has no canonical metadata: ${options.targetId}`,
    );
  }

  const metadata = parseCanonicalMetadata(markdown, metadataStart);
  if (!metadata) {
    throw new Error(`Review item has invalid metadata: ${options.targetId}`);
  }

  metadata.attrs.set("status", "resolved");
  if (options.summary) {
    metadata.attrs.set("resolved", options.summary);
  }

  return `${markdown.slice(0, metadata.offset)}${serializeMetadataAttributes(
    Object.fromEntries(metadata.attrs),
  )}${markdown.slice(metadata.endOffset)}`;
}

export function parseRfmEndmatter(markdown: string): RfmEndmatter {
  const empty: RfmEndmatter = {
    comments: new Map(),
    suggestions: new Map(),
    data: null,
    raw: null,
    offset: null,
    diagnostics: [],
  };
  const match = findFinalYamlEndmatter(markdown);
  if (!match) return empty;

  let parsed: unknown;
  try {
    parsed = parseYaml(match.yaml);
  } catch (error) {
    if (!match.raw.includes("{#")) return empty;

    return {
      ...empty,
      raw: match.raw,
      offset: match.offset,
      diagnostics: [
        {
          code: "invalid-endmatter-yaml",
          message: `YAML endmatter could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
          offset: match.offset,
        },
      ],
    };
  }

  if (!isPlainObject(parsed)) return empty;
  const hasInkbackKeys = "comments" in parsed || "suggestions" in parsed;
  if (!hasInkbackKeys) return empty;
  if (
    !markdown.slice(0, match.offset).includes("{#") &&
    !hasDocumentLevelComment(parsed)
  ) {
    return empty;
  }

  return {
    comments: readEndmatterEntries(parsed.comments),
    suggestions: readEndmatterEntries(parsed.suggestions),
    data: parsed,
    raw: match.raw,
    offset: match.offset,
    diagnostics: [],
  };
}

function hasDocumentLevelComment(parsed: Record<string, unknown>): boolean {
  const comments = readEndmatterEntries(parsed.comments);
  for (const entry of comments.values()) {
    if (
      typeof entry.body === "string" &&
      typeof entry.by === "string" &&
      typeof entry.at === "string" &&
      !entry.re
    ) {
      return true;
    }
  }

  return false;
}

function findFinalYamlEndmatter(
  markdown: string,
): { raw: string; yaml: string; offset: number } | null {
  const matches = [...markdown.matchAll(/\n---[ \t]*\r?\n/g)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return null;

  const raw = markdown.slice(last.index);
  return {
    raw,
    yaml: raw.replace(/^\n---[ \t]*\r?\n/, ""),
    offset: last.index,
  };
}

function readEndmatterEntries(value: unknown): Map<string, RfmEndmatterEntry> {
  const entries = new Map<string, RfmEndmatterEntry>();
  if (!isPlainObject(value)) return entries;

  for (const [id, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) continue;
    entries.set(id, entry as RfmEndmatterEntry);
  }

  return entries;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEndmatterEntry(
  id: string,
  entry: RfmEndmatterEntry,
  offset: number,
  addDiagnostic: (
    severity: RfmDiagnosticSeverity,
    code: string,
    message: string,
    offset: number,
  ) => void,
  isReply: boolean,
): void {
  for (const attribute of ["by", "at"] as const) {
    if (typeof entry[attribute] !== "string" || !entry[attribute]) {
      addDiagnostic(
        "error",
        `missing-endmatter-${attribute}`,
        `Missing required YAML endmatter attribute \`${attribute}\` for \`${id}\`.`,
        offset,
      );
    }
  }

  if (typeof entry.at === "string" && !isValidDateTime(entry.at)) {
    addDiagnostic(
      "error",
      "invalid-endmatter-at",
      `YAML endmatter attribute \`at\` for \`${id}\` must be an ISO 8601 date-time.`,
      offset,
    );
  }

  if (isReply && !entry.re) {
    addDiagnostic(
      "error",
      "missing-reply-target",
      `YAML endmatter reply \`${id}\` must include \`re\`.`,
      offset,
    );
  }
}

/** Update review entries while retaining unrelated YAML and unchanged source verbatim. */
export function updateRfmEndmatter(
  markdown: string,
  comments: Map<string, RfmEndmatterEntry>,
  suggestions: Map<string, RfmEndmatterEntry>,
): string {
  const existing = parseRfmEndmatter(markdown);
  if (
    existing.offset !== null &&
    existing.raw &&
    existing.data &&
    entriesEqual(existing.comments, comments) &&
    entriesEqual(existing.suggestions, suggestions)
  ) {
    return markdown;
  }
  return writeRfmEndmatter(markdown, { comments, suggestions });
}

function entriesEqual(
  left: Map<string, RfmEndmatterEntry>,
  right: Map<string, RfmEndmatterEntry>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, entry] of left) {
    const other = right.get(id);
    if (
      !other ||
      Object.keys(entry).length !== Object.keys(other).length ||
      Object.entries(entry).some(
        ([key, value]) => !yamlValuesEqual(value, other[key]),
      )
    )
      return false;
  }
  return true;
}

function yamlValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => yamlValuesEqual(value, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) =>
          Object.hasOwn(right, key) && yamlValuesEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function writeRfmEndmatter(
  markdown: string,
  endmatter: {
    comments: Map<string, RfmEndmatterEntry>;
    suggestions: Map<string, RfmEndmatterEntry>;
  },
): string {
  const existing = parseRfmEndmatter(markdown);
  const body =
    existing.offset === null
      ? markdown.replace(/\s*$/, "\n")
      : markdown.slice(0, existing.offset).replace(/\s*$/, "\n");
  const data: Record<string, unknown> = { ...(existing.data ?? {}) };
  if (endmatter.comments.size > 0) {
    data.comments = Object.fromEntries(endmatter.comments);
  } else {
    delete data.comments;
  }
  if (endmatter.suggestions.size > 0) {
    data.suggestions = Object.fromEntries(endmatter.suggestions);
  } else {
    delete data.suggestions;
  }

  if (Object.keys(data).length === 0) return body;
  return `${body}\n---\n${stringifyYaml(data)}`;
}

function isEndmatterBackedItem(markdown: string, item: RfmReviewItem): boolean {
  return markdown.slice(item.offset, item.endOffset).includes(`{#${item.id}}`);
}

function nextCommentId(items: RfmReviewItem[]): string {
  let maxId = 0;

  for (const item of items) {
    const match = item.id.match(/^c(\d+)$/);
    if (!match) continue;

    const parsed = Number.parseInt(match[1] ?? "0", 10);
    maxId = Math.max(maxId, parsed);
  }

  return `c${maxId + 1}`;
}

function findCanonicalMetadataStart(
  markdown: string,
  itemEndOffset: number,
): number | null {
  let cursor = itemEndOffset - 1;

  while (cursor >= 0) {
    if (markdown[cursor] !== "{") {
      cursor -= 1;
      continue;
    }

    const parsed = parseCanonicalMetadata(markdown, cursor);
    if (parsed?.endOffset === itemEndOffset) {
      return cursor;
    }

    cursor -= 1;
  }

  return null;
}

function isValidDateTime(value: string): boolean {
  return dateTimePattern.test(value) && !Number.isNaN(Date.parse(value));
}

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export { buildReviewHandoffMessage, REVIEW_AUTHORIZATION } from "./handoff.js";
