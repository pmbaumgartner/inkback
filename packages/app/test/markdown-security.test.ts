import { expect, it } from "vitest";
import { criticMarkdownToRenderedHtml } from "../src/critic-markup";
import { toHtml } from "../src/markdown";

const unsafe =
  '<script>window.__inkbackXss = 1</script>\n\n<img src="x" onerror="window.__inkbackXss = 2">\n\n[click](javascript:window.__inkbackXss=3)\n\n<iframe src="https://example.com"></iframe>';
it.each([
  toHtml,
  (content: string) => criticMarkdownToRenderedHtml(content).html,
])("sanitizes scripts and active attributes from rendered Markdown", (render) => {
  const container = document.createElement("div");
  container.innerHTML = render(unsafe);
  expect(
    container.querySelector("script, iframe, [onerror], [href^='javascript:']"),
  ).toBeNull();
  expect(container.textContent).toContain("click");
});
