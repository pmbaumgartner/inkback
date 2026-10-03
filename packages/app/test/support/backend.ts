import type { StorageBackend } from "../../src/storage";

export function createBackend(
  overrides: Partial<StorageBackend> = {},
): StorageBackend {
  return {
    info: { kind: "local-storage", label: "Test backend", detail: "In-memory" },
    canManageProjects: false,
    async getMarkdownFile(relativePath) {
      return { id: relativePath, title: relativePath, content: "" };
    },
    async saveMarkdownFile() {
      return undefined;
    },
    async saveAsset(file) {
      return {
        markdownPath: file.name,
        previewUrl: `file://${file.name}`,
        mimeType: file.type || "application/octet-stream",
      };
    },
    resolveFileUrl(path) {
      return `file://${path}`;
    },
    async openProject() {},
    ...overrides,
  };
}
