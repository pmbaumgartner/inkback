import { serializeMetadataAttributes, updateRfmEndmatter } from "@inkback/rfm";
import type { CriticChangeAttrs } from "../editor-extensions";
import {
  buildCommentThreads,
  type CriticComment,
  flattenCommentThreads,
  parseReviewEndmatter,
} from "./model";

function serializeMetadata(comment: CriticComment): string {
  const fields = [
    ...Object.entries(comment.metadata ?? {}),
    ["id", comment.id],
    ["by", comment.authorType === "ai" ? "AI" : comment.authorId || "user"],
    ["at", comment.createdAt || new Date().toISOString()],
  ];

  if (comment.parentCommentId) {
    fields.push(["re", comment.parentCommentId]);
  }

  return serializeMetadataAttributes(Object.fromEntries(fields));
}

export function serializeChangeMetadata(change: CriticChangeAttrs): string {
  return serializeMetadata({
    id: change.changeId,
    content: "",
    createdAt: change.createdAt,
    authorType: change.authorType,
    authorId: change.authorId,
    metadata: change.metadata,
  });
}

function endmatterEntryForComment(
  comment: CriticComment,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const by = comment.authorType === "ai" ? "AI" : comment.authorId || "user";
  const next: Record<string, unknown> = {
    ...existing,
    by,
    at: comment.createdAt,
  };

  if (comment.scope === "document") {
    next.body = comment.content;
    delete next.re;
  } else if (comment.parentCommentId) {
    next.body = comment.content;
    next.re = comment.parentCommentId;
  } else {
    delete next.body;
    delete next.re;
  }

  return next;
}

function endmatterEntryForChange(
  change: CriticChangeAttrs,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const by = change.authorType === "ai" ? "AI" : change.authorId || "user";

  return {
    ...existing,
    by,
    at: change.createdAt,
  };
}

export function serializeReviewEndmatter(
  existingEndmatter: string | null,
  comments: Map<string, CriticComment>,
  changes: Map<string, CriticChangeAttrs>,
  opaqueReviewIds: ReadonlySet<string> = new Set(),
): string | null {
  if (!existingEndmatter) return null;

  const parsed = parseReviewEndmatter(existingEndmatter);
  if (parsed.diagnostics.length) return existingEndmatter;
  const commentEntries = new Map<string, Record<string, unknown>>(
    [...parsed.comments].filter(([id]) => opaqueReviewIds.has(id)),
  );
  const suggestionEntries = new Map<string, Record<string, unknown>>(
    [...parsed.suggestions].filter(([id]) => opaqueReviewIds.has(id)),
  );

  for (const comment of comments.values()) {
    commentEntries.set(
      comment.id,
      endmatterEntryForComment(comment, parsed.comments.get(comment.id)),
    );
  }

  for (const change of changes.values()) {
    suggestionEntries.set(
      change.changeId,
      endmatterEntryForChange(change, parsed.suggestions.get(change.changeId)),
    );
  }

  const source = `{#rfm}\n${existingEndmatter}`;
  const updated = updateRfmEndmatter(source, commentEntries, suggestionEntries);
  if (updated === source) return existingEndmatter;
  const body = source
    .slice(0, parsed.offset ?? source.length)
    .replace(/\s*$/, "\n");
  return updated.startsWith(body)
    ? updated.slice(body.length).replace(/^\n/, "") || null
    : null;
}

function getOrderedAnchorComments(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
): CriticComment[] {
  const visibleComments = commentIds
    .map((commentId) => comments.get(commentId))
    .filter((comment): comment is CriticComment => Boolean(comment));

  return flattenCommentThreads(buildCommentThreads(visibleComments));
}

export function serializeCommentBlocks(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
  useEndmatter = false,
): string {
  const orderedComments = useEndmatter
    ? commentIds
        .map((commentId) => comments.get(commentId))
        .filter(
          (comment): comment is CriticComment =>
            comment !== undefined && !comment.parentCommentId,
        )
    : getOrderedAnchorComments(commentIds, comments);
  let result = "";

  for (const comment of orderedComments) {
    result += `{>>${comment.content}<<}${
      useEndmatter ? `{#${comment.id}}` : serializeMetadata(comment)
    }`;
  }

  return result;
}
