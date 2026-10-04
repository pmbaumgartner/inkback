import { hydrateMetadataAttrs, type Metadata } from "@inkback/rfm";
import {
  type CriticComment,
  createCommentWithContext,
  type ParsedEndmatter,
} from "./model";

function commentPartialFromEndmatterEntry(
  id: string,
  entry?: Record<string, unknown>,
  options?: { includeParent?: boolean },
): Partial<Omit<CriticComment, "content">> {
  const author = typeof entry?.by === "string" ? entry.by : "user";
  const includeParent = options?.includeParent ?? true;

  return {
    id,
    metadata: Object.fromEntries(
      Object.entries(entry ?? {}).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    ),
    createdAt:
      typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId:
      includeParent && typeof entry?.re === "string" ? entry.re : null,
  };
}

export function commentMetadata(
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
    metadata: Object.fromEntries(fields),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType:
      author.toUpperCase() === "AI" ? ("ai" as const) : ("user" as const),
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId:
      metadata?.kind === "reference" ? null : (fields.get("re") ?? null),
  };
}

export function addEndmatterFeedback(
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
