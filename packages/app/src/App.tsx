import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  useState,
} from "react";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getPathLeaf,
  getRequestedPathState,
  joinPath,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { DocumentSaveController } from "./DocumentSaveController";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { detectBackend } from "./detect-backend";
import type { DocumentSaveState } from "./PageCard";
import type { CompleteReviewOptions, StorageBackend } from "./storage";

export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused";

export function shouldWarnBeforeUnload({
  activeDocumentPath,
  isDirty,
  saveState,
  diskChangeState,
}: {
  activeDocumentPath: string | null;
  isDirty: boolean;
  saveState: DocumentSaveState;
  diskChangeState: DocumentDiskChangeState;
}) {
  return (
    !!activeDocumentPath &&
    (isDirty ||
      saveState === "saving" ||
      saveState === "unsaved" ||
      saveState === "error" ||
      diskChangeState !== "clean")
  );
}

export function Homepage({ message }: { message: ReactNode }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#FCFCFC] px-6 text-slate-950 dark:bg-background dark:text-slate-50"
      data-testid="homepage"
    >
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Inkback</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">{message}</p>
      </div>
    </main>
  );
}

export function App({
  bootstrap,
}: {
  bootstrap?: {
    backend: StorageBackend;
    documentPath: string;
    onSaveController?: (controller: DocumentSaveController | null) => void;
  };
} = {}) {
  const initialRequestedPathState = bootstrap
    ? {
        rawPath: bootstrap.documentPath,
        documentPath: bootstrap.backend.info.detail,
        projectPath: null,
      }
    : getRequestedPathState();
  const [requestedPathState] = useState(initialRequestedPathState);
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    initialRequestedPathState.documentPath,
  );
  const [saveController, setSaveController] =
    useState<DocumentSaveController | null>(null);
  const snapshot = useSyncExternalStore(
    saveController?.subscribe ?? (() => () => {}),
    saveController?.getSnapshot ?? (() => null),
  );
  const documentPage = snapshot?.page ?? null;
  const documentDiskChangeState = snapshot?.diskState ?? "clean";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [documentEditorViewMode, setDocumentEditorViewMode] = useState(() =>
    bootstrap
      ? "rich-text"
      : getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const backendRef = useRef<StorageBackend | null>(null);
  const saveControllerRef = useRef<DocumentSaveController | null>(null);
  backendRef.current = backend;

  const loadDocument = useCallback(
    async (
      nextBackend: StorageBackend,
      relativePath: string,
      isCancelled: () => boolean,
    ) => {
      const nextDocument = await nextBackend.getMarkdownFile(relativePath);
      if (isCancelled()) return;
      saveControllerRef.current?.dispose();
      const controller = new DocumentSaveController(
        relativePath,
        nextDocument,
        nextBackend,
      );
      saveControllerRef.current = controller;
      setSaveController(controller);
      bootstrap?.onSaveController?.(controller);
      setActiveDocumentPath(relativePath);
    },
    [bootstrap],
  );

  useEffect(() => {
    if (bootstrap) return;
    const sourceUrl = new URL("/api/open-requests", window.location.origin);
    if (requestedPathState.rawPath) {
      sourceUrl.searchParams.set("path", requestedPathState.rawPath);
    }

    const source = new EventSource(`${sourceUrl.pathname}${sourceUrl.search}`);
    const handleOpenRequest = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          url?: unknown;
        };
        if (typeof payload.url !== "string" || !payload.url.trim()) return;

        const nextUrl = new URL(payload.url, window.location.origin);
        window.focus();
        if (nextUrl.href !== window.location.href) {
          window.location.assign(nextUrl.href);
        }
      } catch (error) {
        console.error("Failed to handle Inkback open request:", error);
      }
    };

    source.addEventListener("open-request", handleOpenRequest);

    return () => {
      source.removeEventListener("open-request", handleOpenRequest);
      source.close();
    };
  }, [bootstrap, requestedPathState.rawPath]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const detectedBackend = bootstrap?.backend ?? (await detectBackend());
        if (cancelled) return;

        setBackend(detectedBackend);

        if (bootstrap || detectedBackend.info.kind === "remote") {
          const documentPath = detectedBackend.info.detail || "remote.md";
          await loadDocument(detectedBackend, documentPath, () => cancelled);
          if (cancelled) return;
          setLoading(false);
          return;
        }

        if (!requestedPathState.rawPath) {
          setActiveDocumentPath(null);
          setLoading(false);
          return;
        }

        syncRequestedPathInUrl(requestedPathState.rawPath);

        if (
          !requestedPathState.projectPath ||
          !requestedPathState.documentPath
        ) {
          setActiveDocumentPath(null);
          setLoadError("Inkback now opens one .md file at a time.");
          setLoading(false);
          return;
        }

        if (detectedBackend.canManageProjects) {
          await detectedBackend.openProject(requestedPathState.projectPath);
        }

        if (cancelled) return;

        await loadDocument(
          detectedBackend,
          requestedPathState.documentPath,
          () => cancelled,
        );
        if (cancelled) return;

        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to open markdown file:", error);
        setActiveDocumentPath(null);
        setLoadError("Could not open that markdown file.");
        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      saveControllerRef.current?.dispose();
      saveControllerRef.current = null;
      bootstrap?.onSaveController?.(null);
    };
  }, [
    bootstrap,
    loadDocument,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : null;

    document.title = workspaceTitlePath ?? "Inkback";
  }, [activeDocumentPath, backend, requestedPathState.rawPath]);

  useEffect(() => {
    if (bootstrap) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldWarnBeforeUnload({
          activeDocumentPath: saveControllerRef.current?.path ?? null,
          isDirty: saveControllerRef.current?.getSnapshot().dirty ?? false,
          saveState: saveControllerRef.current?.getSnapshot().status ?? "saved",
          diskChangeState:
            saveControllerRef.current?.getSnapshot().diskState ?? "clean",
        })
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [bootstrap]);

  const handleReloadDocumentFromDisk = useCallback(async () => {
    await saveControllerRef.current?.reload();
  }, []);

  const handleKeepEditingWithoutAutosave = useCallback(() => {
    saveControllerRef.current?.setDiskState("paused");
  }, []);

  const handleOverwriteDocumentOnDisk = useCallback(async () => {
    await saveControllerRef.current?.overwrite();
  }, []);

  const handlePrepareReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      const controller = saveControllerRef.current;
      const currentBackend = backendRef.current;
      if (!controller || !currentBackend?.prepareReview)
        throw new Error("Review is not ready.");
      const result = await controller.flushSave();
      if (result.status !== "saved")
        throw new Error("Save is blocked. Resolve it before finishing.");
      return currentBackend.prepareReview(options);
    },
    [],
  );

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      const controller = saveControllerRef.current;
      const currentBackend = backendRef.current;
      if (!controller || !currentBackend) return { delivered: false };
      const result = await controller.flushSave();
      if (result.status !== "saved")
        throw result.status === "error"
          ? result.error
          : new Error("Document save is blocked");
      if (saveControllerRef.current !== controller) return { delivered: false };
      return currentBackend.completeReview
        ? currentBackend.completeReview(controller.path, options)
        : { delivered: false };
    },
    [],
  );

  useEffect(() => {
    if (!backend?.watchMarkdownFile || !activeDocumentPath) return;

    const controller = saveController;
    if (!controller) return;
    const stopWatching = backend.watchMarkdownFile(
      activeDocumentPath,
      (event) => {
        void controller.onDiskEvent(event);
      },
    );
    return () => stopWatching();
  }, [activeDocumentPath, backend, saveController]);

  const handleDocumentEditorViewModeChange = useCallback(
    (nextMode: DocumentEditorViewMode) => {
      setDocumentEditorViewMode((current) => {
        if (nextMode === current) return current;
        if (!bootstrap)
          window.history.replaceState(
            null,
            "",
            buildLocationForDocumentEditorViewMode(nextMode),
          );
        return nextMode;
      });
    },
    [bootstrap],
  );

  if (loading) {
    return (
      <div
        className="h-screen bg-[#FCFCFC] dark:bg-background"
        aria-hidden="true"
      />
    );
  }

  if (!requestedPathState.rawPath || loadError) {
    return (
      <Homepage
        message={loadError ?? "Open a local Markdown file to begin reviewing."}
      />
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const documentFilenameLabel =
    getPathLeaf(documentAbsolutePath ?? activeDocumentPath) ?? "Untitled.md";

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      <DocumentWorkspace
        documentPage={documentPage}
        activeDocumentPath={activeDocumentPath}
        documentCopyPath={documentAbsolutePath}
        documentFilenameLabel={documentFilenameLabel}
        documentEditorViewMode={documentEditorViewMode}
        onDocumentEditorViewModeChange={handleDocumentEditorViewModeChange}
        saveController={saveController}
        documentDiskChangeState={documentDiskChangeState}
        onReloadDocumentFromDisk={handleReloadDocumentFromDisk}
        onKeepEditingWithoutAutosave={handleKeepEditingWithoutAutosave}
        onOverwriteDocumentOnDisk={handleOverwriteDocumentOnDisk}
        onCompleteReview={handleCompleteReview}
        onPrepareReview={
          backend?.prepareReview ? handlePrepareReview : undefined
        }
        backend={backend}
      />
    </main>
  );
}
