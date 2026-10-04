import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import {
  openMarkdownFile,
  readProjectFile,
  richTextEditor,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test("unsafe source stays inert through a sibling review edit and reload", async ({
  page,
  projectDir,
}) => {
  const unsafe = readFileSync(
    new URL("../test/fixtures/markdown/unsafe-html.md", import.meta.url),
    "utf8",
  );
  const path = writeProjectFile(
    projectDir,
    "unsafe.md",
    `${unsafe}\n\nEditable sibling.\n`,
  );
  await openMarkdownFile(page, path);
  const editor = richTextEditor(page);
  await expect(editor).toBeVisible();
  await expect(
    editor.locator(
      "script, iframe, object, embed, [onerror], a[href^='javascript:']",
    ),
  ).toHaveCount(0);
  await selectRichText(page, "Editable sibling");
  await page.getByTestId("selection-menu-action-comment").click();
  await page
    .getByTestId("comment-rail-c1-editor")
    .fill("Keep unsafe source inert.");
  await page.getByTestId("comment-rail-c1-action-save").click();
  await expect
    .poll(() => readProjectFile(projectDir, "unsafe.md"))
    .toContain("Keep unsafe source inert.");
  expect(readProjectFile(projectDir, "unsafe.md")).toContain(unsafe.trimEnd());
  await page.reload();
  await expect(page.getByTestId("document-review-rail")).toContainText(
    "Keep unsafe source inert.",
  );
  await expect(
    editor.locator(
      "script, iframe, object, embed, [onerror], a[href^='javascript:']",
    ),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
    ),
  ).toBeUndefined();
});

test("reviews table cells without persisting display URLs or losing mixed images", async ({
  page,
  projectDir,
}) => {
  writeProjectFile(projectDir, "other.md", "Other document.\n");
  const mixed = "Before ![alt](./picture.png) after.\n";
  const path = writeProjectFile(
    projectDir,
    "source.md",
    `${mixed}\n| Name | Link |\n| --- | --- |\n| Review cell | [local](./other.md) |\n`,
  );
  await openMarkdownFile(page, path);
  await selectRichText(page, "Review cell");
  await page.getByTestId("selection-menu-action-comment").click();
  await page.getByTestId("comment-rail-c1-editor").fill("Cell review.");
  await page.getByTestId("comment-rail-c1-action-save").click();
  await expect
    .poll(() => readProjectFile(projectDir, "source.md"))
    .toContain("Cell review.");
  const saved = readProjectFile(projectDir, "source.md");
  expect(saved).toContain(mixed.trimEnd());
  expect(saved).toContain("[local](./other.md)");
  expect(saved).not.toContain("/?path=");
  await page.reload();
  await expect(page.getByTestId("document-review-rail")).toContainText(
    "Cell review.",
  );
  await expect(richTextEditor(page).locator("table")).toContainText(
    "Review cell",
  );
});

test("HTML paste tolerates malformed review metadata without executable content", async ({
  page,
  projectDir,
}) => {
  const path = writeProjectFile(projectDir, "paste.md", "Paste here.\n");
  await openMarkdownFile(page, path);
  await selectRichText(page, "here");
  await page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) throw new Error("Expected editor");
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<span data-critic-change-kind="addition" data-critic-change-id="s1" data-critic-change-at="2024" data-critic-change-metadata="{">pasted</span><script>window.__inkbackXss=1</script>',
    );
    editor.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  await expect(richTextEditor(page)).toContainText("pasted");
  await expect
    .poll(() => readProjectFile(projectDir, "paste.md"))
    .toContain("pasted");
  await expect(richTextEditor(page).locator("script, [onerror]")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => (window as Window & { __inkbackXss?: number }).__inkbackXss,
    ),
  ).toBeUndefined();
});
