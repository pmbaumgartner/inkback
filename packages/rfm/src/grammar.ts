import type {
  RfmDiagnosticSeverity,
  RfmEndmatter,
  RfmSuggestionKind,
} from "./index.js";
export interface Metadata {
  attrs: Map<string, string>;
  kind: "canonical" | "legacy" | "reference";
  offset: number;
  endOffset: number;
}

interface FenceState {
  marker: "`" | "~";
  length: number;
}

export interface ParsedComment {
  content: string;
  metadata: Metadata | null;
  offset: number;
  markerEndOffset: number;
  endOffset: number;
}

export interface ParsedSuggestion {
  suggestionKind: RfmSuggestionKind;
  text: string;
  originalText?: string;
  replacementText?: string;
  metadata: Metadata | null;
  offset: number;
  markerEndOffset: number;
  endOffset: number;
}

const attributeNamePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function createLineStarts(markdown: string): number[] {
  const lineStarts = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

export function locationForOffset(
  lineStarts: readonly number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;
    const nextLineStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < lineStart) {
      high = middle - 1;
    } else if (offset >= nextLineStart) {
      low = middle + 1;
    } else {
      return {
        line: middle + 1,
        column: offset - lineStart + 1,
      };
    }
  }

  const lastLineStart = lineStarts[lineStarts.length - 1] ?? 0;
  return {
    line: lineStarts.length,
    column: offset - lastLineStart + 1,
  };
}

function isLineStart(markdown: string, offset: number): boolean {
  return offset === 0 || markdown[offset - 1] === "\n";
}

function nextLineOffset(markdown: string, offset: number): number {
  const nextNewline = markdown.indexOf("\n", offset);
  return nextNewline === -1 ? markdown.length : nextNewline + 1;
}

function matchFence(
  markdown: string,
  offset: number,
  fence: FenceState | null,
): { fence: FenceState } | null {
  const lineEnd = nextLineOffset(markdown, offset);
  const line = markdown.slice(offset, lineEnd).replace(/\r?\n$/, "");
  const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  if (!match) return null;

  const markerText = match[1] ?? "";
  const marker = markerText[0] as "`" | "~";

  if (!fence) {
    return {
      fence: {
        marker,
        length: markerText.length,
      },
    };
  }

  if (fence.marker !== marker || markerText.length < fence.length) {
    return null;
  }

  return { fence };
}

function matchInlineCodeSpan(markdown: string, offset: number): number | null {
  if (markdown[offset] !== "`") return null;

  let length = 1;
  while (markdown[offset + length] === "`") {
    length += 1;
  }

  let cursor = offset + length;
  while (cursor < markdown.length) {
    if (markdown[cursor] === "\n") {
      const lineStart = cursor + 1;
      const line = markdown.slice(
        lineStart,
        nextLineOffset(markdown, lineStart),
      );
      if (
        /^[ \t]*(?:\r?\n)?$/.test(line) ||
        matchFence(markdown, lineStart, null)
      )
        break;
    }
    if (markdown[cursor] === "`") {
      let runEnd = cursor + 1;
      while (markdown[runEnd] === "`") runEnd++;
      if (runEnd - cursor === length) return runEnd;
      cursor = runEnd;
    } else cursor++;
  }
  return offset + length;
}

export function parseComment(
  markdown: string,
  offset: number,
  addDiagnostic: (
    severity: RfmDiagnosticSeverity,
    code: string,
    message: string,
    offset: number,
  ) => void,
): ParsedComment | null {
  if (!markdown.startsWith("{>>", offset)) return null;
  const close = markdown.indexOf("<<}", offset + 3);
  if (close === -1) {
    addDiagnostic(
      "error",
      "unclosed-comment",
      "Comment marker is missing closing `<<}`.",
      offset,
    );
    return null;
  }

  const metadata = parseMetadata(markdown, close + 3, true, addDiagnostic);

  return {
    content: markdown.slice(offset + 3, close),
    metadata,
    offset,
    markerEndOffset: close + 3,
    endOffset: metadata?.endOffset ?? close + 3,
  };
}

export function parseSuggestion(
  markdown: string,
  offset: number,
  addDiagnostic: (
    severity: RfmDiagnosticSeverity,
    code: string,
    message: string,
    offset: number,
  ) => void,
): ParsedSuggestion | null {
  const addition = parseWrappedMarker(markdown, offset, "{++", "++}");
  if (addition) {
    const metadata = parseMetadata(
      markdown,
      addition.endOffset,
      false,
      addDiagnostic,
    );
    return {
      suggestionKind: "addition",
      text: markdown.slice(offset + 3, addition.endOffset - 3),
      metadata,
      offset,
      markerEndOffset: addition.endOffset,
      endOffset: metadata?.endOffset ?? addition.endOffset,
    };
  }
  if (markdown.startsWith("{++", offset)) {
    addDiagnostic(
      "error",
      "unclosed-addition",
      "Addition marker is missing closing `++}`.",
      offset,
    );
    return null;
  }

  const deletion = parseWrappedMarker(markdown, offset, "{--", "--}");
  if (deletion) {
    const metadata = parseMetadata(
      markdown,
      deletion.endOffset,
      false,
      addDiagnostic,
    );
    const text = markdown.slice(offset + 3, deletion.endOffset - 3);
    return {
      suggestionKind: "deletion",
      text,
      originalText: text,
      metadata,
      offset,
      markerEndOffset: deletion.endOffset,
      endOffset: metadata?.endOffset ?? deletion.endOffset,
    };
  }
  if (markdown.startsWith("{--", offset)) {
    addDiagnostic(
      "error",
      "unclosed-deletion",
      "Deletion marker is missing closing `--}`.",
      offset,
    );
    return null;
  }

  if (markdown.startsWith("{~~", offset)) {
    const separator = markdown.indexOf("~>", offset + 3);
    const close =
      separator === -1 ? -1 : markdown.indexOf("~~}", separator + 2);

    if (separator === -1 || close === -1) {
      addDiagnostic(
        "error",
        "unclosed-substitution",
        "Substitution marker is missing `~>` or closing `~~}`.",
        offset,
      );
      return null;
    }

    const endOffset = close + 3;
    const metadata = parseMetadata(markdown, endOffset, false, addDiagnostic);
    return {
      suggestionKind: "substitution",
      text: markdown.slice(separator + 2, close),
      originalText: markdown.slice(offset + 3, separator),
      replacementText: markdown.slice(separator + 2, close),
      metadata,
      offset,
      markerEndOffset: endOffset,
      endOffset: metadata?.endOffset ?? endOffset,
    };
  }

  return null;
}

function parseWrappedMarker(
  markdown: string,
  offset: number,
  open: string,
  close: string,
): { endOffset: number } | null {
  if (!markdown.startsWith(open, offset)) return null;

  const closeOffset = markdown.indexOf(close, offset + open.length);
  return closeOffset === -1 ? null : { endOffset: closeOffset + close.length };
}

export function parseMetadata(
  markdown: string,
  offset: number,
  allowLegacy: boolean,
  addDiagnostic: (
    severity: RfmDiagnosticSeverity,
    code: string,
    message: string,
    offset: number,
  ) => void,
): Metadata | null {
  if (allowLegacy && markdown.startsWith("{@", offset)) {
    const close = markdown.indexOf("@}", offset + 2);
    if (close === -1) {
      addDiagnostic(
        "error",
        "invalid-metadata-syntax",
        "Legacy metadata is missing closing `@}`.",
        offset,
      );
      return null;
    }

    return {
      attrs: parseLegacyAttributes(markdown.slice(offset + 2, close)),
      kind: "legacy",
      offset,
      endOffset: close + 2,
    };
  }

  if (markdown[offset] !== "{") return null;

  const reference = parseIdReference(markdown, offset);
  if (reference) {
    return reference;
  }

  const parsed = parseCanonicalMetadata(markdown, offset);
  if (parsed) return parsed;

  if (looksLikeMetadata(markdown, offset)) {
    addDiagnostic(
      "error",
      "invalid-metadata-syntax",
      "Metadata must use a compact reference such as `{#c1}` backed by final YAML endmatter, or a valid compatibility attribute block.",
      offset,
    );
  }

  return null;
}

function parseIdReference(markdown: string, offset: number): Metadata | null {
  const match = markdown.slice(offset).match(/^\{#([A-Za-z][A-Za-z0-9_-]*)\}/);
  if (!match) return null;

  return {
    attrs: new Map([["id", match[1] ?? ""]]),
    kind: "reference",
    offset,
    endOffset: offset + match[0].length,
  };
}

export function parseCanonicalMetadata(
  markdown: string,
  offset: number,
): Metadata | null {
  let cursor = offset + 1;
  const attrs = new Map<string, string>();
  let sawAttribute = false;

  while (cursor < markdown.length) {
    cursor = skipSpaces(markdown, cursor);

    if (markdown[cursor] === "}") {
      if (!sawAttribute) return null;
      return {
        attrs,
        kind: "canonical",
        offset,
        endOffset: cursor + 1,
      };
    }

    const nameStart = cursor;
    while (
      cursor < markdown.length &&
      /[A-Za-z0-9_-]/.test(markdown[cursor] ?? "")
    ) {
      cursor += 1;
    }
    const name = markdown.slice(nameStart, cursor);
    if (!attributeNamePattern.test(name) || markdown[cursor] !== "=") {
      return null;
    }
    cursor += 1;

    if (markdown[cursor] !== '"') return null;
    cursor += 1;

    let value = "";
    while (cursor < markdown.length) {
      const character = markdown[cursor];
      if (character === "\\") {
        const next = markdown[cursor + 1];
        if (next === undefined) return null;
        value += next;
        cursor += 2;
        continue;
      }

      if (character === '"') {
        cursor += 1;
        attrs.set(name, value);
        sawAttribute = true;
        break;
      }

      if (character === "\n" || character === "\r") return null;
      value += character;
      cursor += 1;
    }

    if (!attrs.has(name)) return null;
  }

  return null;
}

function parseLegacyAttributes(metadata: string): Map<string, string> {
  const attrs = new Map<string, string>();

  for (const part of metadata.split(";")) {
    const [rawKey, ...valueParts] = part.split(":");
    const key = rawKey?.trim();
    const value = valueParts.join(":").trim();
    if (!key || !value) continue;
    attrs.set(key, value);
  }

  return attrs;
}

function skipSpaces(markdown: string, offset: number): number {
  let cursor = offset;
  while (markdown[cursor] === " " || markdown[cursor] === "\t") {
    cursor += 1;
  }
  return cursor;
}

function looksLikeMetadata(markdown: string, offset: number): boolean {
  const close = markdown.indexOf("}", offset + 1);
  if (close === -1) return false;

  const content = markdown.slice(offset + 1, close);
  return /\b(?:id|by|at|re)\b/.test(content);
}

export function serializeMetadataAttributes(
  attrs: Record<string, string>,
): string {
  return `{${Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeMetadataAttributeValue(value)}"`)
    .join(" ")}}`;
}

function escapeMetadataAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function hydrateMetadataAttrs(
  metadata: Metadata | null,
  endmatter: RfmEndmatter,
  kind: "comment" | "suggestion",
): Map<string, string> {
  const attrs = new Map(metadata?.attrs ?? []);
  if (metadata?.kind !== "reference") return attrs;

  const id = attrs.get("id");
  const entry =
    kind === "comment"
      ? endmatter.comments.get(id ?? "")
      : endmatter.suggestions.get(id ?? "");
  if (!entry) return attrs;

  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === "string") {
      attrs.set(key, value);
    }
  }
  if (id) attrs.set("id", id);
  return attrs;
}

export function parseHighlight(markdown: string, offset: number) {
  if (!markdown.startsWith("{==", offset)) return null;
  const end = markdown.indexOf("==}", offset + 3);
  return end === -1
    ? null
    : { text: markdown.slice(offset + 3, end), endOffset: end + 3 };
}

export type ReviewToken =
  | { kind: "comment"; parsed: ParsedComment; anchorText?: string }
  | { kind: "suggestion"; parsed: ParsedSuggestion };
export type DiagnosticSink = (
  severity: RfmDiagnosticSeverity,
  code: string,
  message: string,
  offset: number,
) => void;
export function scanReview(
  markdown: string,
  endOffset: number,
  diagnostic: DiagnosticSink,
  options: { code?: boolean } = {},
): ReviewToken[] {
  const tokens: ReviewToken[] = [];
  let offset = 0;
  let fence: FenceState | null = null;
  while (offset < endOffset) {
    if (isLineStart(markdown, offset)) {
      const match = matchFence(markdown, offset, fence);
      if (match) {
        fence = fence ? null : match.fence;
        offset = nextLineOffset(markdown, offset);
        continue;
      }
    }
    const codeEnd =
      fence || options.code ? null : matchInlineCodeSpan(markdown, offset);
    if (codeEnd !== null) {
      offset = codeEnd;
      continue;
    }
    if (markdown.startsWith("{==", offset)) {
      const highlight = parseHighlight(markdown, offset);
      if (!highlight) {
        diagnostic(
          "error",
          "unclosed-highlight",
          "Highlight marker is missing closing `==}`.",
          offset,
        );
        offset += 3;
        continue;
      }
      const innerStart = offset + 3;
      for (const inner of scanReview(
        highlight.text,
        highlight.text.length,
        (severity, code, message, position) =>
          diagnostic(severity, code, message, innerStart + position),
        options,
      )) {
        tokens.push({
          ...inner,
          parsed: {
            ...inner.parsed,
            offset: inner.parsed.offset + innerStart,
            markerEndOffset: inner.parsed.markerEndOffset + innerStart,
            endOffset: inner.parsed.endOffset + innerStart,
          },
        } as ReviewToken);
      }
      const anchorText = highlight.text;
      offset = highlight.endOffset;
      while (markdown.startsWith("{>>", offset)) {
        const parsed = parseComment(markdown, offset, diagnostic);
        if (!parsed) break;
        tokens.push({ kind: "comment", parsed, anchorText });
        offset = parsed.endOffset;
      }
      continue;
    }
    if (markdown.startsWith("{>>", offset)) {
      const parsed = parseComment(markdown, offset, diagnostic);
      if (parsed) {
        tokens.push({ kind: "comment", parsed });
        offset = parsed.endOffset;
        continue;
      }
    }
    const parsed = parseSuggestion(markdown, offset, diagnostic);
    if (parsed) {
      tokens.push({ kind: "suggestion", parsed });
      offset = parsed.endOffset;
      continue;
    }
    offset++;
  }
  return tokens;
}
