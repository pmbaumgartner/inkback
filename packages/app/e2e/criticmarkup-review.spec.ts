import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  openMarkdownFile,
  readProjectFile,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test.describe("CriticMarkup review flows", () => {
  test("renders a comment thread and saves a reply @smoke", async ({
    page,
    projectDir,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "comment.md",
      [
        "# Comment Review",
        "",
        'This paragraph has {==target text==}{>>Needs detail<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"}.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("document-review-rail")).toContainText(
      "Needs detail",
    );

    await page.getByTestId("comment-thread-c1").click();
    await page.getByTestId("comment-rail-c1-action-reply").click();
    await page
      .getByTestId("comment-rail-c2-editor")
      .fill("Added context looks good.");
    await page.getByTestId("comment-rail-c2-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "comment.md"))
      .toContain("Added context looks good.");
    expect(readProjectFile(projectDir, "comment.md")).toContain('re="c1"');
  });

  test("reloads endmatter replies and saves a nested reply @smoke", async ({
    page,
    projectDir,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "endmatter-replies.md",
      `{==target text==}{>>Needs detail<<}{#root}

---
comments:
  root:
    by: user
    at: "2026-04-23T18:00:00.000Z"
  child:
    body: Added the requested detail.
    by: AI
    at: "2026-04-23T18:05:00.000Z"
    re: root
`,
    );

    await openMarkdownFile(page, filePath);
    const rail = page.getByTestId("document-review-rail");
    await expect(rail).toContainText("Added the requested detail.");
    await page.reload();
    await expect(rail).toContainText("Added the requested detail.");

    await page.getByTestId("comment-thread-root").click();
    await page.getByTestId("comment-rail-child-action-reply").click();
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Thanks, that resolves it.");
    await page.getByTestId("comment-rail-c1-action-save").click();
    await expect
      .poll(() => readProjectFile(projectDir, "endmatter-replies.md"))
      .toContain("body: Thanks, that resolves it.");
    expect(readProjectFile(projectDir, "endmatter-replies.md")).toContain(
      "re: child",
    );

    await page.reload();
    await expect(rail).toContainText("Added the requested detail.");
    await expect(rail).toContainText("Thanks, that resolves it.");
  });

  test("creates a new root comment and saves it to disk @smoke", async ({
    page,
    projectDir,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "new-comment.md",
      [
        "# New Comment",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "new-comment.md"))
      .toMatch(
        /\{==target text==\}\{>>Clarify this phrase\.<<\}\{id="c1" by="user" at="[^"]+"\}/,
      );
  });

  test("animates the document layout when the review rail appears and disappears @smoke", async ({
    page,
    projectDir,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "layout-animation.md",
      [
        "# Layout Animation",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").waitFor();

    const addSamplesPromise = sampleReviewLayoutAnimation(
      page,
      "selection-menu-action-comment",
    );
    await page.getByTestId("selection-menu-action-comment").click();
    const addSamples = await addSamplesPromise;

    expect(hasAnimatedReviewLayout(addSamples)).toBe(true);
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await page.getByTestId("comment-rail-c1-action-delete-thread").waitFor();
    const removeSamplesPromise = sampleReviewLayoutAnimation(
      page,
      "comment-rail-c1-action-delete-thread",
    );
    await page.getByTestId("comment-rail-c1-action-delete-thread").click();
    const removeSamples = await removeSamplesPromise;

    expect(hasAnimatedReviewLayout(removeSamples)).toBe(true);
  });

  test("shows tooltips for selection menu formatting actions", async ({
    page,
    projectDir,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "selection-tooltips.md",
      [
        "# Selection Tooltips",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");

    await page.getByTestId("selection-menu-action-bold").hover();
    await expect(page.getByTestId("selection-menu-action-tooltip")).toHaveText(
      "Bold",
    );

    await expect(
      page.getByTestId("selection-menu-action-suggest-insertion"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("selection-menu-action-suggest-deletion"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("selection-menu-action-suggest-replacement"),
    ).toHaveCount(0);

    await page.getByTestId("selection-menu-action-comment").hover();
    await expect(page.getByTestId("selection-menu-action-tooltip")).toHaveCount(
      0,
    );
  });

  test("composes and resolves suggestions on a narrow screen", async ({
    page,
    projectDir,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    const filePath = writeProjectFile(
      projectDir,
      "narrow.md",
      'Text {++suggestion++}{id="s1" by="AI" at="2026-04-23T18:00:00Z"}.\n',
    );
    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("document-review-rail")).toBeVisible();
    await page.getByTestId("comment-rail-s1-action-accept").click();
    await expect
      .poll(() => readProjectFile(projectDir, "narrow.md"))
      .toContain("Text suggestion.");
    await page.getByTestId("rich-text-editor").click({ button: "right" });
    await page
      .getByTestId("editor-context-menu-action-suggest-insertion")
      .click();
    await expect(page.getByTestId("draft-suggestion-editor")).toBeVisible();
    await page
      .getByTestId("draft-suggestion-editor")
      .fill("Narrow screen insertion");
    await page.getByTestId("draft-suggestion-action-apply").click();
    await expect
      .poll(() => readProjectFile(projectDir, "narrow.md"))
      .toContain("Narrow screen insertion");
  });

  test("accepts and rejects suggested changes on disk @smoke", async ({
    page,
    projectDir,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "suggestions.md",
      [
        "# Suggestion Review",
        "",
        'Keep {++clear wording++}{id="s1" by="user" at="2026-04-23T18:00:00.000Z"} here.',
        "",
        'Remove {--drafty --}{id="s2" by="user" at="2026-04-23T18:01:00.000Z"}there.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.locator('[data-critic-change-id="s1"]')).toBeVisible();

    await page.getByTestId("comment-rail-s1-action-accept").click();
    await expect
      .poll(() => readProjectFile(projectDir, "suggestions.md"))
      .toContain("Keep clear wording here.");

    await page.getByTestId("comment-rail-s2-action-reject").click();
    await expect
      .poll(() => readProjectFile(projectDir, "suggestions.md"))
      .toContain("Remove drafty there.");
    expect(readProjectFile(projectDir, "suggestions.md")).not.toContain("{++");
    expect(readProjectFile(projectDir, "suggestions.md")).not.toContain("{--");
  });
});

type ReviewLayoutAnimationSample = {
  shellAnimating: boolean;
  headerAnimating: boolean;
  shellTranslateX: number;
  headerTranslateX: number;
};

async function sampleReviewLayoutAnimation(page: Page, actionTestId: string) {
  return page.evaluate(async (testId) => {
    const readTranslateX = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return 0;
      const transform = getComputedStyle(element).transform;
      if (transform === "none") return 0;
      return new DOMMatrixReadOnly(transform).m41;
    };
    const samples: ReviewLayoutAnimationSample[] = [];
    let start: number | null = null;
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`[data-testid="${testId}"]`)
      )
        start = performance.now();
    };
    document.addEventListener("click", onClick, true);
    // Start the observation window at the action, after Playwright has finished
    // waiting for the button to become actionable.
    const capture = () => {
      if (start === null) return;
      const shell = document.querySelector(
        '[data-testid="document-page-shell"]',
      );
      const header = document.querySelector(
        '[data-testid="document-page-header"]',
      );
      samples.push({
        shellAnimating:
          shell instanceof HTMLElement &&
          shell.classList.contains("review-layout-grid--animating"),
        headerAnimating:
          header instanceof HTMLElement &&
          header.classList.contains("review-layout-grid--animating"),
        shellTranslateX: readTranslateX(shell),
        headerTranslateX: readTranslateX(header),
      });
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
      subtree: true,
    });
    while (start === null || performance.now() - start < 500) {
      capture();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    observer.disconnect();
    document.removeEventListener("click", onClick, true);
    return samples;
  }, actionTestId);
}

function hasAnimatedReviewLayout(samples: ReviewLayoutAnimationSample[]) {
  return samples.some(
    (sample) =>
      sample.shellAnimating &&
      sample.headerAnimating &&
      Math.abs(sample.shellTranslateX) > 1 &&
      Math.abs(sample.headerTranslateX) > 1,
  );
}
