import type { JSONContent } from "@tiptap/core";
import type { CriticComment } from "./model";

const sourceAttributes = new Set([
  "originalSource",
  "sourceSnapshot",
  "sourceComments",
  "sourceGroup",
]);
export function blockSnapshot(node: JSONContent): string {
  return JSON.stringify(node, (key, value) =>
    sourceAttributes.has(key) ? undefined : value,
  );
}
export function blockCommentSnapshot(
  node: JSONContent,
  comments: ReadonlyMap<string, CriticComment>,
): string {
  const ids = new Set<string>();
  const visit = (child: JSONContent) => {
    for (const mark of child.marks ?? []) {
      if (mark.type === "commentRef")
        for (const id of mark.attrs?.commentIds ?? []) ids.add(id);
      if (mark.type === "criticChange" && mark.attrs?.changeId)
        ids.add(mark.attrs.changeId);
    }
    child.content?.forEach(visit);
  };
  visit(node);
  let changed = true;
  while (changed) {
    changed = false;
    for (const comment of comments.values()) {
      if (
        comment.parentCommentId &&
        ids.has(comment.parentCommentId) &&
        !ids.has(comment.id)
      ) {
        ids.add(comment.id);
        changed = true;
      }
    }
  }
  return JSON.stringify(
    [...ids]
      .sort()
      .flatMap((id) => (comments.has(id) ? [comments.get(id)] : [])),
  );
}
