import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { criticMarkdownHasReviewRail } from "./critic-markup";
import type {
  CodeEditorSurfaceProps,
  EditorViewMode,
  PageCardEditorSurfaceProps,
  PageCardProps,
} from "./editor-types";
import { cn } from "./lib/utils";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import { RichTextEditorSurface } from "./RichTextEditorSurface";
import { useReviewLayoutShiftAnimation } from "./useReviewLayoutShiftAnimation";

const CodeEditorSurface = memo(function CodeEditorSurface({
  markdown,
  hasCommentRailSpace,
  interactionMode,
  onMarkdownChange,
}: CodeEditorSurfaceProps) {
  const documentShellClass = cn(
    "document-page-shell review-layout-grid",
    !hasCommentRailSpace &&
      "document-page-shell-no-comments review-layout-grid--centered",
  );
  const documentMainClass =
    "document-page-main w-full min-w-0 review-layout-main max-w-[46.5rem]";
  const contentInsetClass = "pb-24";
  const reviewRailClass =
    "document-comment-rail pointer-events-none invisible review-layout-rail hidden min-[1100px]:block";
  const documentShellRef =
    useReviewLayoutShiftAnimation<HTMLDivElement>(hasCommentRailSpace);

  return (
    <div className="cursor-text bg-transparent" data-testid="page-card-code">
      <div
        ref={documentShellRef}
        data-testid="document-page-shell"
        className={documentShellClass}
      >
        <div className={documentMainClass}>
          <div className={contentInsetClass}>
            <div
              className="min-h-[calc(70vh+4rem)] rounded-[0.75rem] border border-[#E9E9E8] dark:border-slate-800 bg-white dark:bg-card py-10 pr-6 pl-5 shadow-[0_18px_44px_rgba(57,47,38,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.35)] sm:py-14 sm:pr-10 sm:pl-8"
              data-testid="document-content-card"
            >
              <MarkdownCodeEditor
                testId="markdown-code-editor"
                value={markdown}
                onChange={onMarkdownChange}
                readOnly={interactionMode === "viewing"}
                autoFocus
              />
            </div>
          </div>
        </div>
        {hasCommentRailSpace ? (
          <div
            data-testid="document-review-rail"
            className={reviewRailClass}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
});

const PageCardEditorSurface = memo(function PageCardEditorSurface({
  page,
  activeDocumentPath,
  selected,
  focusRequestKey,
  editorViewMode,
  interactionMode,
  backend,
  onEditorReady,
  onCommentRailPresenceChange,
  saveController,
}: PageCardEditorSurfaceProps) {
  const previousEditorViewModeRef = useRef<EditorViewMode>(editorViewMode);
  const [markdown, setMarkdown] = useState(page.content);
  const [richTextSourceMarkdown, setRichTextSourceMarkdown] = useState(
    page.content,
  );
  const [richTextSourceVersion, setRichTextSourceVersion] = useState(0);

  const lastPageContentRef = useRef(page.content);
  const handleMarkdownChange = useCallback(
    (nextMarkdown: string) => {
      lastPageContentRef.current = nextMarkdown;
      setMarkdown(nextMarkdown);
      saveController.edit(nextMarkdown);
    },
    [saveController],
  );

  useEffect(() => {
    if (lastPageContentRef.current === page.content) return;
    lastPageContentRef.current = page.content;
    setMarkdown(page.content);
    setRichTextSourceMarkdown(page.content);
    setRichTextSourceVersion((current) => current + 1);
  }, [page.content]);

  useEffect(() => {
    const previousEditorViewMode = previousEditorViewModeRef.current;
    previousEditorViewModeRef.current = editorViewMode;

    if (previousEditorViewMode !== "code" || editorViewMode !== "rich-text") {
      return;
    }

    setRichTextSourceMarkdown(markdown);
    setRichTextSourceVersion((current) => current + 1);
  }, [editorViewMode, markdown]);

  const hasCommentRailSpace = useMemo(
    () => criticMarkdownHasReviewRail(markdown),
    [markdown],
  );

  useEffect(() => {
    if (editorViewMode !== "code") return;
    onCommentRailPresenceChange?.(hasCommentRailSpace);
  }, [editorViewMode, hasCommentRailSpace, onCommentRailPresenceChange]);

  if (editorViewMode === "code") {
    return (
      <CodeEditorSurface
        markdown={markdown}
        hasCommentRailSpace={hasCommentRailSpace}
        interactionMode={interactionMode}
        onMarkdownChange={handleMarkdownChange}
      />
    );
  }

  return (
    <RichTextEditorSurface
      key={`${page.id}:${richTextSourceVersion}:${richTextSourceMarkdown}`}
      page={page}
      activeDocumentPath={activeDocumentPath}
      selected={selected}
      focusRequestKey={focusRequestKey}
      sourceMarkdown={richTextSourceMarkdown}
      onMarkdownChange={handleMarkdownChange}
      interactionMode={interactionMode}
      onCommentRailPresenceChange={onCommentRailPresenceChange}
      backend={backend}
      onEditorReady={onEditorReady}
    />
  );
});

export function PageCard({
  page,
  activeDocumentPath = null,
  selected = false,
  focusRequestKey = null,
  editorViewMode = "rich-text",
  interactionMode = "editing",
  backend,
  onEditorReady,
  onCommentRailPresenceChange,
  saveController,
}: PageCardProps) {
  return (
    <div className="w-full">
      <PageCardEditorSurface
        page={page}
        activeDocumentPath={activeDocumentPath}
        selected={selected}
        focusRequestKey={focusRequestKey}
        editorViewMode={editorViewMode}
        interactionMode={interactionMode}
        backend={backend}
        onEditorReady={onEditorReady}
        onCommentRailPresenceChange={onCommentRailPresenceChange}
        saveController={saveController}
      />
    </div>
  );
}
