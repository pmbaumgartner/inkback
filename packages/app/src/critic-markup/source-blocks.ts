import type { JSONContent } from "@tiptap/core";
import type { CriticComment } from "./model";

const sourceAttributes = new Set([
  "originalSource",
  "sourceSnapshot",
  "sourceComments",
  "sourceGroup",
]);
function blockSnapshot(node: JSONContent): string {
  return JSON.stringify(node, (key, value) =>
    sourceAttributes.has(key) ? undefined : value,
  );
}
function blockCommentSnapshot(
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

export function attachSourceSnapshots(
  blocks: JSONContent[],
  comments: ReadonlyMap<string, CriticComment>,
): void {
  for (let index = 0; index < blocks.length; ) {
    const first = blocks[index++];
    if (!first) throw new Error("Expected a parsed Markdown block");
    const group: JSONContent[] = [first];
    while (index < blocks.length) {
      const next = blocks[index];
      if (!next || next.attrs?.sourceGroup !== first.attrs?.sourceGroup) break;
      group.push(next);
      index++;
    }
    const grouped = { type: "doc", content: group };
    const snapshot = blockSnapshot(grouped);
    const commentSnapshot = blockCommentSnapshot(grouped, comments);
    for (const node of group)
      node.attrs = {
        ...node.attrs,
        sourceSnapshot: snapshot,
        sourceComments: commentSnapshot,
      };
  }
}

export function saveSourceGroups(
  doc: JSONContent,
  comments: ReadonlyMap<string, CriticComment>,
  serializeGroup: (group: JSONContent) => string,
): string {
  const blocks = [...(doc.content ?? [])];
  if (
    blocks.length > 1 &&
    blocks.at(-1)?.type === "paragraph" &&
    !blocks.at(-1)?.content?.length
  )
    blocks.pop();
  let body = "";
  for (let index = 0; index < blocks.length; ) {
    const previous = blocks[index - 1];
    const block = blocks[index++];
    if (!block) throw new Error("Expected an editor Markdown block");
    const group = [block];
    if (block.attrs?.sourceGroup) {
      while (index < blocks.length) {
        const next = blocks[index];
        if (!next || next.attrs?.sourceGroup !== block.attrs.sourceGroup) break;
        group.push(next);
        index++;
      }
    }
    const grouped = { type: "doc", content: group };
    const source = block.attrs?.originalSource;
    if (
      typeof source === "string" &&
      block.attrs?.sourceSnapshot === blockSnapshot(grouped) &&
      block.attrs?.sourceComments === blockCommentSnapshot(grouped, comments)
    ) {
      body += source;
    } else {
      const markdown = serializeGroup(grouped);
      if (body && !body.endsWith("\n")) body += "\n\n";
      else if (
        body &&
        typeof source !== "string" &&
        previous?.type !== "heading" &&
        !body.endsWith("\n\n")
      )
        body += "\n";
      const separator =
        typeof source === "string" ? source.match(/\s*$/)?.[0] : null;
      body += markdown + (separator || (index < blocks.length ? "\n\n" : "\n"));
    }
  }
  return body;
}
