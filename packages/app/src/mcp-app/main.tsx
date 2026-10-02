import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  App as McpApp,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import {
  extractInkbackReviewIndex,
  type RfmReviewIndexSummary,
} from "@inkback/rfm";
import manifest from "../../../../package.json";
import { App } from "../App";
import type { DocumentSaveController } from "../DocumentSaveController";
import { TooltipProvider } from "../components/ui/tooltip";
import { Button } from "../components/ui/button";
import { McpAppBackend } from "./McpAppBackend";
import { InlineCard } from "./InlineCard";
import {
  applyHostTheme,
  captureHostLinks,
  setHostBridge,
  showLinkNotice,
} from "./host-bridge";
import "../style.css";
const host = new McpApp(
  { name: "Inkback", version: manifest.version },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: false },
);
setHostBridge(host);
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root was not found.");
captureHostLinks(rootElement);
const root = createRoot(rootElement);
let backend: McpAppBackend | null = null;
let controller: DocumentSaveController | null = null;
let documentPath: string | null = null;
let summary: RfmReviewIndexSummary | null = null;
let context: McpUiHostContext | undefined;
let editorOpen = false;
let cancelled = false;
let bootstrap:
  | {
      backend: McpAppBackend;
      documentPath: string;
      onSaveController: (value: DocumentSaveController | null) => void;
    }
  | undefined;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const onSystemTheme = () => {
  if (!context?.theme) applyHostTheme();
};
darkQuery.addEventListener("change", onSystemTheme);
function Review() {
  const [error, setError] = useState<string | null>(null);
  if (!backend || !summary || !documentPath || !bootstrap)
    return <p className="p-5">Waiting for the document…</p>;
  if (!editorOpen)
    return (
      <>
        <InlineCard
          documentPath={documentPath}
          summary={summary}
          writable={backend.writable}
          onOpen={() => {
            void (async () => {
              try {
                if (context?.availableDisplayModes?.includes("fullscreen"))
                  await host.requestDisplayMode({ mode: "fullscreen" });
                editorOpen = true;
                render();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Could not open the editor.",
                );
              }
            })();
          }}
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <TooltipProvider>
      <div
        className="relative"
        style={
          context?.displayMode !== "fullscreen"
            ? {
                height:
                  context?.containerDimensions &&
                  "height" in context.containerDimensions
                    ? context.containerDimensions.height
                    : 700,
                overflow: "auto",
              }
            : undefined
        }
      >
        <Button
          className="fixed bottom-3 left-3 z-[70]"
          variant="outline"
          onClick={() => {
            void closeEditor();
          }}
        >
          Back to summary
        </Button>
        {!backend.writable && (
          <div
            role="status"
            className="fixed bottom-3 left-44 right-3 z-[70] rounded-lg border bg-background p-3 text-sm"
          >
            Read-only: {backend.notWritableReason}
          </div>
        )}
        <App bootstrap={bootstrap} />
      </div>
    </TooltipProvider>
  );
}
async function flush() {
  if (controller) {
    const result = await controller.flushSave();
    if (result.status !== "saved")
      throw new Error(
        "Save is blocked. Resolve the conflict or retry saving before closing.",
      );
  }
}
async function closeEditor() {
  try {
    await flush();
    const page = controller?.getSnapshot().page;
    if (page) summary = extractInkbackReviewIndex(page.content).summary;
    editorOpen = false;
    render();
    if (context?.displayMode === "fullscreen")
      await host.requestDisplayMode({ mode: "inline" });
  } catch (error) {
    showLinkNotice(error instanceof Error ? error.message : "Could not save.");
  }
}
function render() {
  root.render(<Review />);
}
host.ontoolinput = (params) => {
  const value = params.arguments?.documentPath;
  if (typeof value !== "string" || cancelled) return;
  documentPath = value;
  render();
};
host.ontoolresult = (params) => {
  if (cancelled) return;
  if (params.isError) {
    const message = params.content
      ?.map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    root.render(
      <p role="alert" className="p-5">
        {message || "Could not open the review."}
      </p>,
    );
    return;
  }
  const data = params.structuredContent as
    | {
        documentPath?: string;
        writable?: boolean;
        notWritableReason?: string | null;
        summary?: RfmReviewIndexSummary;
      }
    | undefined;
  if (!data?.documentPath || !data.summary) return;
  backend?.dispose();
  documentPath = data.documentPath;
  summary = data.summary;
  backend = new McpAppBackend(host, documentPath);
  backend.writable = data.writable ?? false;
  backend.notWritableReason = data.notWritableReason ?? null;
  bootstrap = {
    backend,
    documentPath,
    onSaveController: (value) => {
      controller = value;
    },
  };
  render();
};
host.ontoolcancelled = () => {
  cancelled = true;
  backend?.dispose();
  root.render(<p className="p-5">The open request was cancelled.</p>);
};
host.onteardown = async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      flush(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
  } catch (error) {
    console.error("Inkback teardown save:", error);
  } finally {
    clearTimeout(timer);
    backend?.dispose();
    darkQuery.removeEventListener("change", onSystemTheme);
  }
  return {};
};
host.onhostcontextchanged = (next) => {
  const previousMode = context?.displayMode;
  context = { ...context, ...next };
  applyHostTheme(context);
  if (
    previousMode === "fullscreen" &&
    context.displayMode === "inline" &&
    editorOpen
  )
    void closeEditor();
  else render();
};
host.onerror = (error) => {
  console.error("Inkback host bridge:", error);
};
render();
void host
  .connect()
  .then(() => {
    context = host.getHostContext();
    applyHostTheme(context);
    render();
  })
  .catch((error) => {
    root.render(
      <p role="alert">Could not connect to the MCP host: {String(error)}</p>,
    );
  });
