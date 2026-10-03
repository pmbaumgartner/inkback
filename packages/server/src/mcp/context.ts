import type { ChangeWatcher } from "../change-watch.js";
import type { OpenDocuments } from "../open-documents.js";
import type { PathPolicy } from "../path-policy.js";
export interface ToolContext {
  policy: PathPolicy;
  changes: ChangeWatcher;
  documents: OpenDocuments;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}
export function requireWritable(context: ToolContext, documentPath: string) {
  const reason = context.policy.notWritableReason(documentPath);
  if (reason) throw new Error(reason);
}
export function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : "Inkback tool failed.",
      },
    ],
  };
}
export function toolResult(
  data: Record<string, unknown>,
  text = JSON.stringify(data),
) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data,
  };
}
