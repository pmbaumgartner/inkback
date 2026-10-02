import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import manifest from "../../../../package.json" with { type: "json" };
import { createPathPolicy, type PolicyOptions } from "../path-policy.js";
import { ChangeWatcher } from "../change-watch.js";
import { OpenDocuments } from "../open-documents.js";
import { registerAppTools } from "./app-tools.js";
import { registerModelTools } from "./model-tools.js";
import { registerReviewUi } from "./ui-resource.js";
export interface McpOptions extends PolicyOptions {
  fetchImpl?: typeof fetch;
  noRoots?: boolean;
  htmlPath?: string;
}
export function createInkbackMcpServer(options: McpOptions = {}) {
  const server = new McpServer({ name: "Inkback", version: manifest.version });
  const policy = createPathPolicy(options);
  const changes = new ChangeWatcher();
  const documents = new OpenDocuments();
  const controller = new AbortController();
  const context = {
    policy,
    changes,
    documents,
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl ?? fetch,
    signal: controller.signal,
  };
  registerModelTools(server, context);
  registerAppTools(server, context);
  registerReviewUi(server, options.htmlPath);
  async function refreshRoots() {
    if (options.noRoots || !server.server.getClientCapabilities()?.roots)
      return;
    try {
      const { roots } = await server.server.listRoots();
      policy.setRoots(
        roots.flatMap((root) => {
          try {
            return root.uri.startsWith("file:")
              ? [fileURLToPath(root.uri)]
              : [];
          } catch {
            return [];
          }
        }),
      );
    } catch (error) {
      (options.log ?? ((text: string) => process.stderr.write(`${text}\n`)))(
        `Inkback: unable to load client roots: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  server.server.oninitialized = () => {
    void refreshRoots();
  };
  server.server.setNotificationHandler(
    "notifications/roots/list_changed",
    refreshRoots,
  );
  function dispose() {
    controller.abort();
    changes.close();
  }
  server.server.onclose = dispose;
  return { server, policy, documents, dispose };
}
