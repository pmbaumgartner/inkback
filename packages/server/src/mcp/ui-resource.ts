import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
export const REVIEW_UI_URI = "ui://inkback/review.html";
export const REVIEW_HTML_PATH = fileURLToPath(
  new URL("../../../app/dist-mcp-app/mcp-app.html", import.meta.url),
);
export function registerReviewUi(
  server: McpServer,
  htmlPath = REVIEW_HTML_PATH,
) {
  let html: string | undefined;
  registerAppResource(
    server,
    REVIEW_UI_URI,
    REVIEW_UI_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      try {
        html ??= fs.readFileSync(htmlPath, "utf8");
      } catch {
        throw new Error(
          "The Inkback app UI file does not exist. Run pnpm build.",
        );
      }
      return {
        contents: [
          {
            uri: REVIEW_UI_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: { ui: { permissions: { clipboardWrite: {} } } },
          },
        ],
      };
    },
  );
}
