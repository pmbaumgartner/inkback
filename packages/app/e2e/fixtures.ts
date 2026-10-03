import { test as base, expect } from "@playwright/test";
import { createMarkdownProject, removeMarkdownProject } from "./helpers";

export const test = base.extend<{ projectDir: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture arguments.
  projectDir: async ({}, use) => {
    const directory = createMarkdownProject("e2e");
    try {
      await use(directory);
    } finally {
      removeMarkdownProject(directory);
    }
  },
});
export { expect };
