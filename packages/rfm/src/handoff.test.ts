import fs from "node:fs";
import { expect, it } from "vitest";
import { buildReviewHandoffMessage, REVIEW_AUTHORIZATION } from "./handoff";
import { extractInkbackReviewIndex } from "./index";
it("caps handoff IDs and includes the user's comment and authorization boundary", () => {
  const markdown = Array.from(
    { length: 53 },
    (_, index) => `{>>Question ${index}<<}{#c${index + 1}}`,
  ).join("\n\n");
  const message = buildReviewHandoffMessage({
    documentPath: "/docs/draft.md",
    index: extractInkbackReviewIndex(markdown),
    overallComment: "Prioritize the evidence.",
  });
  expect(message).toContain(
    "Unresolved items: 53 (53 comments, 0 suggestions).",
  );
  expect(message).toContain("c50 and 3 more");
  expect(message).toContain('Overall comment: "Prioritize the evidence."');
  expect(message).toContain(REVIEW_AUTHORIZATION);
  expect(
    fs.readFileSync(
      new URL("../../skill/inkback/SKILL.md", import.meta.url),
      "utf8",
    ),
  ).toContain(REVIEW_AUTHORIZATION);
});
it("renders the pending suggestion summary without an overall comment", () => {
  const message = buildReviewHandoffMessage({
    documentPath: "/docs/draft.md",
    index: extractInkbackReviewIndex("{++New text++}{#s1}"),
  });
  expect(message).toContain(
    "Unresolved items: 1 (0 comments, 1 suggestions). IDs: s1.",
  );
});
