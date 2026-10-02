import type { RfmReviewIndex } from "./index.js";
export const REVIEW_AUTHORIZATION =
  "Read the current file from disk before you act. Finish review does not approve all suggestions or the implementation of a plan. Act only within the scope that the user already gave you. Use inkback_get_pending_feedback for the item details.";
export function buildReviewHandoffMessage({
  documentPath,
  index,
  overallComment,
}: {
  documentPath: string;
  index: RfmReviewIndex;
  overallComment?: string;
}) {
  const items = index.items.filter(
    (item) => item.status !== "resolved" && item.kind !== "reply",
  );
  const comments = items.filter((item) => item.kind === "comment").length;
  const suggestions = items.filter((item) => item.kind === "suggestion").length;
  const ids = items.map((item) => item.id).filter(Boolean);
  const idText =
    ids.slice(0, 50).join(", ") +
    (ids.length > 50 ? ` and ${ids.length - 50} more` : "");
  return `Inkback review finished: ${documentPath}\nUnresolved items: ${items.length} (${comments} comments, ${suggestions} suggestions).${idText ? ` IDs: ${idText}.` : ""}${overallComment?.trim() ? `\nOverall comment: ${JSON.stringify(overallComment.trim())}` : ""}\n\n${REVIEW_AUTHORIZATION}`;
}
