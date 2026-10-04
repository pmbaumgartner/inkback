import { collectReviewIds, parseMetadata } from "@inkback/rfm";
import type { JSONContent } from "@tiptap/core";
import type { CriticChangeAttrs } from "../editor-extensions";
import { decodeRawMarkdownBlock } from "../markdown";
import type { CriticComment } from "./model";

export function collectOpaqueReviewIds(source: string): string[] {
  const ids = new Set(collectReviewIds(source));
  // Opaque source can contain nested or unsupported review ranges. Reuse the
  // grammar's metadata parser, since the outer scanner may not reach every ID.
  for (let offset = source.indexOf("{"); offset >= 0; ) {
    const metadata = parseMetadata(source, offset, false, () => {});
    const id = metadata?.attrs.get("id");
    if (id) ids.add(id);
    offset = source.indexOf("{", metadata?.endOffset ?? offset + 1);
  }
  return [...ids];
}

function collectCriticChangesFromDoc(
  doc: JSONContent,
): Map<string, CriticChangeAttrs> {
  const changes = new Map<string, CriticChangeAttrs>();
  const visit = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "criticChange") continue;

      const attrs = mark.attrs as Partial<CriticChangeAttrs> | undefined;
      if (
        attrs?.changeId &&
        attrs.kind &&
        attrs.createdAt &&
        attrs.authorType
      ) {
        changes.set(attrs.changeId, {
          kind: attrs.kind,
          changeId: attrs.changeId,
          createdAt: attrs.createdAt,
          authorType: attrs.authorType,
          authorId: attrs.authorId ?? null,
          metadata: attrs.metadata,
        });
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };

  visit(doc);
  return changes;
}

export function collectLiveReview(
  doc: JSONContent,
  comments: ReadonlyMap<string, CriticComment>,
) {
  const changes = collectCriticChangesFromDoc(doc);
  const presentIds = new Set<string>(changes.keys());
  const opaqueReviewIds = new Set<string>();
  const visit = (node: JSONContent) => {
    // Opaque source is still live document content. Its references cannot be
    // inferred from editor marks and must not lose their YAML metadata.
    if (
      node.type === "rawMarkdownBlock" &&
      typeof node.attrs?.rawMarkdown === "string"
    ) {
      for (const id of collectOpaqueReviewIds(
        decodeRawMarkdownBlock(node.attrs.rawMarkdown),
      )) {
        opaqueReviewIds.add(id);
        presentIds.add(id);
      }
    }
    for (const mark of node.marks ?? [])
      if (mark.type === "commentRef")
        for (const id of mark.attrs?.commentIds ?? []) presentIds.add(id);
    node.content?.forEach(visit);
  };
  visit(doc);
  for (const comment of comments.values())
    if (comment.scope === "document") presentIds.add(comment.id);
  let added = true;
  while (added) {
    added = false;
    for (const comment of comments.values())
      if (
        comment.parentCommentId &&
        presentIds.has(comment.parentCommentId) &&
        !presentIds.has(comment.id)
      ) {
        presentIds.add(comment.id);
        added = true;
      }
  }
  const liveComments = new Map(
    [...comments].filter(([id]) => presentIds.has(id)),
  );
  return { changes, liveComments, opaqueReviewIds };
}
