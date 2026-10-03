import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildLocationForLinkedMarkdownDocument } from "./app-navigation";
import { criticMarkdownToEditorState } from "./critic-markup";
import {
  type CriticComment,
  createCriticComment,
  getCommentDescendantIds,
} from "./critic-markup/model";
import { editorStateToCriticMarkdown } from "./critic-markup/writer";
import {
  type CriticChangeRailItem,
  DocumentReviewRail,
} from "./DocumentReviewRail";
import { getPreferredCommentId, parseCommentIds } from "./document-comments";
import { EditorContextMenu } from "./EditorContextMenu";
import { insertEditorFiles } from "./editor-assets";
import {
  commentHighlightPluginKey,
  createEditorExtensions,
  criticChangeHighlightPluginKey,
  externalContentSync,
} from "./editor-extensions";
import {
  addCommentIdsToAnchor,
  addCommentIdsToCriticChange,
  areCommentIdListsEqual,
  findCommentAnchorElement,
  findCommentRange,
  getCriticChangeRange,
  getDocumentCriticChangeRailItems,
  getPreferredCriticChangeId,
  getSelectionCommentIds,
  getSelectionCriticChangeIds,
  resolveAnchoredCommentId,
  shouldDismissCommentThread,
} from "./editor-review";
import type {
  DocumentInteractionMode,
  DraftSuggestionState,
  RichTextEditorSurfaceProps,
} from "./editor-types";
import { cn } from "./lib/utils";
import { SuggestionEditing } from "./suggestion-editing";
import { useCommentAnchorLayout } from "./useCommentAnchorLayout";
import { useReviewLayoutShiftAnimation } from "./useReviewLayoutShiftAnimation";

export const RichTextEditorSurface = memo(function RichTextEditorSurface({
  page,
  activeDocumentPath,
  selected,
  focusRequestKey,
  sourceMarkdown,
  onMarkdownChange,
  interactionMode,
  backend,
  onEditorReady,
  onCommentRailPresenceChange,
}: RichTextEditorSurfaceProps) {
  const [wideReviewRail, setWideReviewRail] = useState(
    () => window.matchMedia?.("(min-width: 1100px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1100px)");
    if (!media) return;
    const update = () => setWideReviewRail(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const editorRef = useRef<Editor | null>(null);
  const criticChangeFrameRef = useRef<number | null>(null);
  const interactionModeRef = useRef<DocumentInteractionMode>(interactionMode);
  const commentsRef = useRef<Map<string, CriticComment>>(new Map());
  const suppressNextMarkdownUpdateRef = useRef(false);
  const lastFocusRequestKeyRef = useRef<string | null>(null);
  const selectedCommentIdRef = useRef<string | null>(null);
  const selectedChangeIdRef = useRef<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null,
  );
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [hoveredChangeId, setHoveredChangeId] = useState<string | null>(null);
  const [criticChanges, setCriticChanges] = useState<CriticChangeRailItem[]>(
    [],
  );
  const [draftSuggestion, setDraftSuggestion] =
    useState<DraftSuggestionState | null>(null);
  const [pendingFocusCommentId, setPendingFocusCommentId] = useState<
    string | null
  >(null);
  const [newCommentDraftIds, setNewCommentDraftIds] = useState<string[]>([]);

  const resolveFileUrl = useCallback(
    (path: string) => backend.resolveFileUrl(path),
    [backend],
  );
  const resolveLinkUrl = useCallback(
    (path: string) =>
      buildLocationForLinkedMarkdownDocument({
        projectPath: backend.info.projectPath,
        currentDocumentPath: activeDocumentPath,
        href: path,
      }),
    [activeDocumentPath, backend],
  );

  const parsedContent = useMemo(
    () =>
      criticMarkdownToEditorState(sourceMarkdown, {
        blockRemoteImages: backend.info.kind === "mcp-app",
        resolveFileUrl,
        resolveLinkUrl,
      }),
    [backend, resolveFileUrl, resolveLinkUrl, sourceMarkdown],
  );
  const [comments, setComments] = useState<Map<string, CriticComment>>(
    () => parsedContent.comments,
  );
  const frontmatterRef = useRef<string | null>(parsedContent.frontmatter);
  const endmatterRef = useRef<string | null>(parsedContent.endmatter);
  const lineEndingRef = useRef(parsedContent.lineEnding);

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  const emitMarkdownChange = useCallback(
    (doc?: JSONContent, nextComments?: Map<string, CriticComment>) => {
      const currentEditor = editorRef.current;
      const currentDoc = doc ?? currentEditor?.getJSON();
      if (!currentDoc) return;

      onMarkdownChange(
        editorStateToCriticMarkdown(
          currentDoc,
          nextComments ?? commentsRef.current,
          {
            frontmatter: frontmatterRef.current,
            endmatter: endmatterRef.current,
            lineEnding: lineEndingRef.current,
          },
        ),
      );
    },
    [onMarkdownChange],
  );

  const insertFiles = useCallback(
    async (files: File[]) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || files.length === 0) return;

      await insertEditorFiles(currentEditor, files, backend, {
        resolveFileUrl,
        resolveLinkUrl,
      });
    },
    [backend, resolveFileUrl, resolveLinkUrl],
  );

  const refreshCriticChanges = useCallback(() => {
    if (criticChangeFrameRef.current != null) {
      cancelAnimationFrame(criticChangeFrameRef.current);
    }

    criticChangeFrameRef.current = requestAnimationFrame(() => {
      criticChangeFrameRef.current = null;
      setCriticChanges(
        getDocumentCriticChangeRailItems(
          editorRef.current,
          commentsRef.current,
        ),
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      if (criticChangeFrameRef.current != null) {
        cancelAnimationFrame(criticChangeFrameRef.current);
      }
    };
  }, []);

  const editor = useEditor(
    {
      extensions: [
        ...createEditorExtensions("Start writing..."),
        SuggestionEditing.configure({
          isSuggesting: () => interactionModeRef.current === "suggesting",
        }),
      ],
      content: parsedContent.doc,
      editable: interactionMode !== "viewing",
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: "tiptap min-h-[70vh]",
        },
        handleDrop: (_view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (suppressNextMarkdownUpdateRef.current) {
          suppressNextMarkdownUpdateRef.current = false;
          return;
        }

        emitMarkdownChange(currentEditor.getJSON());
        refreshCriticChanges();
      },
    },
    [page.id],
  );

  editorRef.current = editor;
  selectedCommentIdRef.current = selectedCommentId;
  selectedChangeIdRef.current = selectedChangeId;

  useEffect(() => {
    editor?.setEditable(interactionMode !== "viewing", false);
  }, [editor, interactionMode]);

  const activeCommentIds =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        getSelectionCommentIds(currentEditor),
      equalityFn: areCommentIdListsEqual,
    }) ?? [];
  const activeChangeIds =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        getSelectionCriticChangeIds(currentEditor),
      equalityFn: areCommentIdListsEqual,
    }) ?? [];

  const { commentGroups, contentHeight, measureLayout } =
    useCommentAnchorLayout(editor, comments.size > 0);

  useEffect(() => {
    onEditorReady?.(editor);

    return () => {
      onEditorReady?.(null);
    };
  }, [editor, onEditorReady]);

  useEffect(() => {
    setSelectedCommentId((current) =>
      getPreferredCommentId(activeCommentIds, current),
    );
  }, [activeCommentIds]);

  useEffect(() => {
    setSelectedChangeId((current) =>
      getPreferredCriticChangeId(activeChangeIds, current),
    );
  }, [activeChangeIds]);

  useEffect(() => {
    if (!editor) return;

    frontmatterRef.current = parsedContent.frontmatter;
    endmatterRef.current = parsedContent.endmatter;
    lineEndingRef.current = parsedContent.lineEnding;
    commentsRef.current = parsedContent.comments;
    setComments(parsedContent.comments);
    setSelectedCommentId(null);
    setHoveredCommentId(null);
    setSelectedChangeId(null);
    setHoveredChangeId(null);
    setDraftSuggestion(null);
    setPendingFocusCommentId(null);

    // Compare editor content, not source metadata kept in the refs above.
    const { type, attrs, content } = parsedContent.doc;
    const nextDoc = { type, attrs, content };
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(nextDoc)) {
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta(externalContentSync, true);
          return true;
        })
        .setContent(nextDoc, { emitUpdate: false })
        .run();
    }

    refreshCriticChanges();
  }, [editor, parsedContent, refreshCriticChanges]);

  useEffect(() => {
    if (!editor || !selected || !focusRequestKey) return;
    if (lastFocusRequestKeyRef.current === focusRequestKey) return;
    lastFocusRequestKeyRef.current = focusRequestKey;

    requestAnimationFrame(() => {
      editor.chain().focus("end").run();
    });
  }, [editor, focusRequestKey, selected]);

  useEffect(() => {
    if (selectedCommentId && !comments.has(selectedCommentId)) {
      setSelectedCommentId(null);
    }

    if (hoveredCommentId && !comments.has(hoveredCommentId)) {
      setHoveredCommentId(null);
    }
    refreshCriticChanges();
  }, [comments, hoveredCommentId, refreshCriticChanges, selectedCommentId]);

  useEffect(() => {
    if (!editor) return;

    const effectiveHoveredCommentId = selectedCommentId
      ? hoveredCommentId
      : null;

    editor.view.dispatch(
      editor.state.tr.setMeta(commentHighlightPluginKey, {
        selectedCommentId,
        hoveredCommentId: effectiveHoveredCommentId,
      }),
    );
  }, [editor, hoveredCommentId, selectedCommentId]);

  useEffect(() => {
    if (!editor) return;

    const effectiveHoveredChangeId = selectedChangeId ? hoveredChangeId : null;

    editor.view.dispatch(
      editor.state.tr.setMeta(criticChangeHighlightPluginKey, {
        selectedChangeId,
        hoveredChangeId: effectiveHoveredChangeId,
      }),
    );
  }, [editor, hoveredChangeId, selectedChangeId]);

  useEffect(() => {
    if (!editor) return;

    const anchorElements = editor.view.dom.querySelectorAll<HTMLElement>(
      ".comment-anchor[data-comment-ids]",
    );
    const cleanupCallbacks: Array<() => void> = [];

    for (const anchor of anchorElements) {
      const commentIds = parseCommentIds(anchor.dataset.commentIds);
      if (commentIds.length === 0) continue;

      const handleMouseEnter = () => {
        const nextCommentId = getPreferredCommentId(
          commentIds,
          selectedCommentIdRef.current,
        );
        if (nextCommentId) {
          setHoveredCommentId(nextCommentId);
        }
      };

      const handleMouseLeave = () => {
        setHoveredCommentId((current) =>
          current && commentIds.includes(current) ? null : current,
        );
      };

      const handleClick = () => {
        const nextCommentId = getPreferredCommentId(
          commentIds,
          selectedCommentIdRef.current,
        );
        if (nextCommentId) {
          setSelectedCommentId(nextCommentId);
        }
      };

      anchor.addEventListener("mouseenter", handleMouseEnter);
      anchor.addEventListener("mouseleave", handleMouseLeave);
      anchor.addEventListener("click", handleClick);
      cleanupCallbacks.push(() => {
        anchor.removeEventListener("mouseenter", handleMouseEnter);
        anchor.removeEventListener("mouseleave", handleMouseLeave);
        anchor.removeEventListener("click", handleClick);
      });
    }

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const changeElements = editor.view.dom.querySelectorAll<HTMLElement>(
      ".critic-change[data-critic-change-id]",
    );
    const cleanupCallbacks: Array<() => void> = [];

    for (const element of changeElements) {
      const changeId = element.dataset.criticChangeId;
      if (!changeId) continue;

      const handleMouseEnter = () => {
        setHoveredChangeId(changeId);
      };

      const handleMouseLeave = () => {
        setHoveredChangeId((current) =>
          current === changeId ? null : current,
        );
      };

      const handleClick = () => {
        setSelectedChangeId(changeId);
      };

      element.addEventListener("mouseenter", handleMouseEnter);
      element.addEventListener("mouseleave", handleMouseLeave);
      element.addEventListener("click", handleClick);
      cleanupCallbacks.push(() => {
        element.removeEventListener("mouseenter", handleMouseEnter);
        element.removeEventListener("mouseleave", handleMouseLeave);
        element.removeEventListener("click", handleClick);
      });
    }

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    };
  }, [editor]);

  useEffect(() => {
    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!selectedCommentIdRef.current && !selectedChangeIdRef.current) return;
      if (!shouldDismissCommentThread(event.target)) return;

      setSelectedCommentId(null);
      setHoveredCommentId(null);
      setSelectedChangeId(null);
      setHoveredChangeId(null);
      setPendingFocusCommentId(null);
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
    };
  }, []);

  const handleAddComment = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.state.selection.empty) return;

    const existingIds = getSelectionCommentIds(currentEditor);
    const comment = createCriticComment(undefined, {
      existingComments: [
        ...commentsRef.current.values(),
        ...(editorRef.current?.state.doc.attrs.reviewIds ?? []).map(
          (id: string) => ({ id }),
        ),
      ],
    });
    const nextComments = new Map(commentsRef.current);
    nextComments.set(comment.id, comment);
    commentsRef.current = nextComments;
    setComments(nextComments);
    setNewCommentDraftIds((current) =>
      current.includes(comment.id) ? current : [...current, comment.id],
    );

    suppressNextMarkdownUpdateRef.current = true;
    currentEditor
      .chain()
      .focus()
      .setCommentRef({ commentIds: [...existingIds, comment.id] })
      .run();
    if (suppressNextMarkdownUpdateRef.current) {
      suppressNextMarkdownUpdateRef.current = false;
    }

    setSelectedCommentId(comment.id);
    setPendingFocusCommentId(comment.id);
    requestAnimationFrame(() => {
      measureLayout();
    });
  }, [measureLayout]);

  const handleSuggestDeletion = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.state.selection.empty) return;

    currentEditor.chain().focus().suggestDelete("selection").run();
    emitMarkdownChange(currentEditor.getJSON());
    refreshCriticChanges();
  }, [emitMarkdownChange, refreshCriticChanges]);

  const handleSuggestReplacement = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.state.selection.empty) return;

    const { from, to } = currentEditor.state.selection;
    setDraftSuggestion({
      type: "replacement",
      from,
      to,
      sourceText: currentEditor.state.doc.textBetween(from, to, "\n"),
      text: "",
    });
  }, []);

  const applyDraftSuggestion = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !draftSuggestion) return;

    const nextText = draftSuggestion.text;
    if (!nextText) {
      setDraftSuggestion(null);
      return;
    }

    currentEditor
      .chain()
      .focus()
      .suggestText(nextText, {
        from: draftSuggestion.from,
        to: draftSuggestion.to,
      })
      .run();
    setDraftSuggestion(null);
    emitMarkdownChange(currentEditor.getJSON());
    refreshCriticChanges();
  }, [draftSuggestion, emitMarkdownChange, refreshCriticChanges]);

  const handleSuggestInsertion = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    const { from } = currentEditor.state.selection;
    const before = currentEditor.state.doc.textBetween(
      Math.max(1, from - 24),
      from,
      " ",
    );
    const after = currentEditor.state.doc.textBetween(
      from,
      Math.min(currentEditor.state.doc.content.size, from + 24),
      " ",
    );

    setDraftSuggestion({
      type: "insertion",
      from,
      to: from,
      sourceText: `${before}▮${after}`.trim(),
      text: "",
    });
  }, []);

  const updateComment = useCallback(
    (commentId: string, updater: (comment: CriticComment) => CriticComment) => {
      const existingComment = commentsRef.current.get(commentId);
      if (!editorRef.current?.isEditable || !existingComment) return;

      const nextComments = new Map(commentsRef.current);
      nextComments.set(commentId, updater(existingComment));
      commentsRef.current = nextComments;
      setComments(nextComments);
      setNewCommentDraftIds((current) =>
        current.filter((currentCommentId) => currentCommentId !== commentId),
      );
      emitMarkdownChange(undefined, nextComments);
    },
    [emitMarkdownChange],
  );

  const replyToComment = useCallback(
    (commentId: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const anchorCommentId = resolveAnchoredCommentId(
        currentEditor,
        commentId,
        commentsRef.current,
      );
      if (!anchorCommentId) return;

      const comment = createCriticComment(
        {
          parentCommentId: commentId,
        },
        {
          existingComments: [
            ...commentsRef.current.values(),
            ...(editorRef.current?.state.doc.attrs.reviewIds ?? []).map(
              (id: string) => ({ id }),
            ),
          ],
        },
      );
      suppressNextMarkdownUpdateRef.current = true;
      const nextAnchorCommentIds = addCommentIdsToAnchor(
        currentEditor,
        anchorCommentId,
        [comment.id],
      );
      if (suppressNextMarkdownUpdateRef.current) {
        suppressNextMarkdownUpdateRef.current = false;
      }
      if (!nextAnchorCommentIds) return;

      const nextComments = new Map(commentsRef.current);
      nextComments.set(comment.id, comment);
      commentsRef.current = nextComments;
      setComments(nextComments);
      setSelectedCommentId(comment.id);
      setHoveredCommentId(null);
      setPendingFocusCommentId(comment.id);
      requestAnimationFrame(() => {
        measureLayout();
      });
    },
    [measureLayout],
  );

  const removeSuggestionComments = useCallback(
    (changeId: string, currentEditor: Editor) => {
      const directCommentIds = [...commentsRef.current.values()]
        .filter((comment) => comment.parentCommentId === changeId)
        .map((comment) => comment.id);
      const commentIdsToDelete = [
        ...directCommentIds,
        ...directCommentIds.flatMap((commentId) =>
          getCommentDescendantIds(commentId, commentsRef.current),
        ),
      ];

      if (commentIdsToDelete.length === 0) return commentsRef.current;

      const chain = currentEditor.chain().focus();
      for (const id of commentIdsToDelete) {
        chain.removeCommentId(id);
      }
      chain.run();

      return commentsRef.current;
    },
    [],
  );

  const acceptSuggestion = useCallback(
    (changeId: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      currentEditor.chain().focus().acceptCriticChange(changeId).run();
      removeSuggestionComments(changeId, currentEditor);
      setSelectedChangeId((current) => (current === changeId ? null : current));
      setHoveredChangeId((current) => (current === changeId ? null : current));
      emitMarkdownChange(currentEditor.getJSON(), commentsRef.current);
      refreshCriticChanges();
    },
    [emitMarkdownChange, refreshCriticChanges, removeSuggestionComments],
  );

  const rejectSuggestion = useCallback(
    (changeId: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      currentEditor.chain().focus().rejectCriticChange(changeId).run();
      removeSuggestionComments(changeId, currentEditor);
      setSelectedChangeId((current) => (current === changeId ? null : current));
      setHoveredChangeId((current) => (current === changeId ? null : current));
      emitMarkdownChange(currentEditor.getJSON(), commentsRef.current);
      refreshCriticChanges();
    },
    [emitMarkdownChange, refreshCriticChanges, removeSuggestionComments],
  );

  const replyToSuggestion = useCallback(
    (changeId: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const comment = createCriticComment(
        {
          parentCommentId: changeId,
        },
        {
          existingComments: [
            ...commentsRef.current.values(),
            ...(editorRef.current?.state.doc.attrs.reviewIds ?? []).map(
              (id: string) => ({ id }),
            ),
          ],
        },
      );
      suppressNextMarkdownUpdateRef.current = true;
      const didAddCommentId = addCommentIdsToCriticChange(
        currentEditor,
        changeId,
        [comment.id],
      );
      if (suppressNextMarkdownUpdateRef.current) {
        suppressNextMarkdownUpdateRef.current = false;
      }
      if (!didAddCommentId) {
        return;
      }

      const nextComments = new Map(commentsRef.current);
      nextComments.set(comment.id, comment);
      commentsRef.current = nextComments;
      setComments(nextComments);
      setSelectedChangeId(changeId);
      setSelectedCommentId(comment.id);
      setHoveredCommentId(null);
      setPendingFocusCommentId(comment.id);
      refreshCriticChanges();
      requestAnimationFrame(() => {
        measureLayout();
      });
    },
    [measureLayout, refreshCriticChanges],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const descendantIds = getCommentDescendantIds(
        commentId,
        commentsRef.current,
      );
      const commentIdsToDelete = [commentId, ...descendantIds];
      const deletedIds = new Set(commentIdsToDelete);
      const chain = currentEditor.chain().focus();
      for (const id of commentIdsToDelete) {
        chain.removeCommentId(id);
      }
      chain.run();
      setSelectedCommentId((current) =>
        current && deletedIds.has(current) ? null : current,
      );
      setHoveredCommentId((current) =>
        current && deletedIds.has(current) ? null : current,
      );
      setPendingFocusCommentId((current) =>
        current && deletedIds.has(current) ? null : current,
      );
      setNewCommentDraftIds((current) =>
        current.filter((commentId) => !deletedIds.has(commentId)),
      );
      emitMarkdownChange(currentEditor.getJSON(), commentsRef.current);
      requestAnimationFrame(() => {
        measureLayout();
      });
    },
    [emitMarkdownChange, measureLayout],
  );

  const selectComment = useCallback((commentId: string) => {
    setSelectedCommentId(commentId);
  }, []);

  const selectSuggestion = useCallback((changeId: string) => {
    setSelectedChangeId(changeId);
    setSelectedCommentId(null);
  }, []);

  const focusComment = useCallback((commentId: string) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    setSelectedCommentId(commentId);

    const range = findCommentRange(currentEditor, commentId);
    if (range) {
      currentEditor.commands.focus(undefined, { scrollIntoView: false });
      currentEditor.view.dispatch(
        currentEditor.state.tr.setSelection(
          TextSelection.create(currentEditor.state.doc, range.from, range.to),
        ),
      );
      return;
    }

    if (!findCommentAnchorElement(currentEditor, commentId)) return;

    currentEditor.commands.focus(undefined, { scrollIntoView: false });
  }, []);

  const focusSuggestion = useCallback((changeId: string) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    setSelectedChangeId(changeId);
    setSelectedCommentId(null);

    const range = getCriticChangeRange(currentEditor, changeId);
    if (!range) return;

    currentEditor.commands.focus(undefined, { scrollIntoView: false });
    currentEditor.view.dispatch(
      currentEditor.state.tr.setSelection(
        TextSelection.create(currentEditor.state.doc, range.from, range.to),
      ),
    );
  }, []);

  const documentCommentIds =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) => {
        const ids = new Set<string>();
        currentEditor?.state.doc.descendants((node) => {
          for (const mark of node.marks)
            if (mark.type.name === "commentRef")
              for (const id of mark.attrs.commentIds ?? []) ids.add(id);
        });
        return [...ids];
      },
      equalityFn: areCommentIdListsEqual,
    }) ?? [];
  const hasReviewRail =
    documentCommentIds.some((id) => comments.has(id)) ||
    criticChanges.length > 0 ||
    !!draftSuggestion;
  useEffect(() => {
    onCommentRailPresenceChange?.(hasReviewRail);
  }, [hasReviewRail, onCommentRailPresenceChange]);

  const documentShellRef =
    useReviewLayoutShiftAnimation<HTMLDivElement>(hasReviewRail);
  const contentCardClass =
    "rounded-[0.75rem] border border-[#E9E9E8] dark:border-slate-800 bg-white dark:bg-card shadow-[0_18px_44px_rgba(57,47,38,0.08)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.35)]";
  const documentShellClass = cn(
    "document-page-shell review-layout-grid",
    !hasReviewRail &&
      "document-page-shell-no-comments review-layout-grid--centered",
  );
  const documentMainClass =
    "document-page-main w-full min-w-0 review-layout-main max-w-[46.5rem]";
  const contentInsetClass = "pb-24";
  const reviewRailClass = "document-comment-rail review-layout-rail";

  return (
    <div
      className="cursor-text bg-transparent"
      data-testid="page-card-rich-text"
    >
      <div
        ref={documentShellRef}
        data-testid="document-page-shell"
        className={documentShellClass}
      >
        <div className={documentMainClass}>
          <div className={contentInsetClass}>
            <div
              data-testid="document-content-card"
              className={cn(contentCardClass, "px-10 py-10 sm:px-14 sm:py-14")}
            >
              <EditorContextMenu
                editor={editor}
                readOnly={interactionMode === "viewing"}
                backend={backend}
                resolveLinkUrl={resolveLinkUrl}
                onAddComment={
                  interactionMode === "viewing" ? undefined : handleAddComment
                }
                onSuggestDeletion={
                  interactionMode === "viewing"
                    ? undefined
                    : handleSuggestDeletion
                }
                onSuggestReplacement={
                  interactionMode === "viewing"
                    ? undefined
                    : handleSuggestReplacement
                }
                onSuggestInsertion={
                  interactionMode === "viewing"
                    ? undefined
                    : handleSuggestInsertion
                }
              >
                <div data-testid="rich-text-editor">
                  <EditorContent editor={editor} />
                </div>
              </EditorContextMenu>
            </div>
          </div>
        </div>
        <div
          className="contents"
          inert={backend.writable === false ? true : undefined}
        >
          <DocumentReviewRail
            className={reviewRailClass}
            layout={wideReviewRail ? "anchored" : "flow"}
            testId="document-review-rail"
            commentGroups={commentGroups}
            comments={comments}
            suggestions={criticChanges}
            selectedCommentId={selectedCommentId}
            hoveredCommentId={hoveredCommentId}
            selectedChangeId={selectedChangeId}
            hoveredChangeId={hoveredChangeId}
            contentHeight={contentHeight}
            onDeleteComment={deleteComment}
            onUpdateComment={(commentId, nextContent) => {
              updateComment(commentId, (current) => ({
                ...current,
                content: nextContent,
              }));
            }}
            onReplyComment={replyToComment}
            onSelectComment={selectComment}
            onFocusComment={focusComment}
            onHoverComment={setHoveredCommentId}
            onAcceptSuggestion={acceptSuggestion}
            onRejectSuggestion={rejectSuggestion}
            onReplySuggestion={replyToSuggestion}
            onSelectSuggestion={selectSuggestion}
            onFocusSuggestion={focusSuggestion}
            onHoverSuggestion={setHoveredChangeId}
            pendingFocusCommentId={pendingFocusCommentId}
            newCommentDraftIds={newCommentDraftIds}
            onAutoFocusComment={(commentId) => {
              setPendingFocusCommentId((current) =>
                current === commentId ? null : current,
              );
            }}
            draftSuggestion={draftSuggestion}
            onDraftSuggestionTextChange={(text) => {
              setDraftSuggestion((current) =>
                current ? { ...current, text } : current,
              );
            }}
            onApplyDraftSuggestion={applyDraftSuggestion}
            onCancelDraftSuggestion={() => setDraftSuggestion(null)}
            editor={editor}
          />
        </div>
      </div>
    </div>
  );
});
