import type { Editor } from "@tiptap/core";
import { type MarkdownOptions, toHtml } from "./markdown";
import type { StorageBackend } from "./storage";

export async function insertEditorFiles(
  currentEditor: Editor,
  files: File[],
  backend: StorageBackend,
  options: MarkdownOptions,
) {
  const assets = await Promise.all(
    files.map((file) => backend.saveAsset(file)),
  );
  const markdown = assets
    .map((asset, index) => {
      const file = files[index];
      if (asset.mimeType.startsWith("image/")) {
        return `![${file?.name || "Image"}](${asset.markdownPath})`;
      }
      return `[${file?.name || "Attachment"}](${asset.markdownPath})`;
    })
    .join("\n\n");

  currentEditor.chain().focus().insertContent(toHtml(markdown, options)).run();
}
