import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test("preserves multiline code when saving and reloading a comment @smoke", async ({
  page,
}) => {
  const projectDir = createMarkdownProject("code-comment");
  const code = [
    "",
    "def f():",
    "    value = 12345",
    "\treturn value  ",
    "",
    "",
    "# Keep the blank lines",
    "",
    "print(f())",
    "",
    "",
  ].join("\n");
  const input = `\`\`\`python\n${code}\n\`\`\`\n`;
  const filePath = writeProjectFile(projectDir, "code.md", input);

  try {
    await openMarkdownFile(page, filePath, "rich-text");
    await selectRichText(page, "12345");
    await page.getByTestId("selection-menu-action-comment").click();
    await page.getByTestId("comment-rail-c1-editor").fill("Use two");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "code.md"))
      .toContain("{>>Use two<<}");
    const saved = readProjectFile(projectDir, "code.md");
    const annotation =
      /\{==12345==\}\{>>Use two<<\}\{id="c1" by="user" at="[^"]+"\}/;
    expect(saved).toMatch(annotation);
    expect(saved.replace(annotation, "12345")).toBe(input);

    await page.reload();
    await expect(page.getByTestId("document-review-rail")).toContainText(
      "Use two",
    );
    expect(await richTextEditor(page).textContent()).toBe(code);
  } finally {
    removeMarkdownProject(projectDir);
  }
});
