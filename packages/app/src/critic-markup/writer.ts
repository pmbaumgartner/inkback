import { serializeMetadataAttributes, updateRfmEndmatter } from "@inkback/rfm";
import { generateHTML, type JSONContent } from "@tiptap/core";

import type TurndownService from "turndown";
import {
  type CriticChangeAttrs,
  type CriticChangeKind,
  createEditorExtensions,
} from "../editor-extensions";

import {
  appendYamlEndmatter,
  createTurndownService,
  normalizeBlockSpacing,
  prependYamlFrontmatter,
} from "../markdown";
import {
  buildCommentThreads,
  type CriticComment,
  flattenCommentThreads,
  parseReviewEndmatter,
  unanchoredCommentSentinel,
} from "./model";
import { blockCommentSnapshot, blockSnapshot } from "./source-blocks";

function serializeMetadata(comment: CriticComment): string {
  const fields = [
    ...Object.entries(comment.metadata ?? {}),
    ["id", comment.id],
    ["by", comment.authorType === "ai" ? "AI" : comment.authorId || "user"],
    ["at", comment.createdAt || new Date().toISOString()],
  ];

  if (comment.parentCommentId) {
    fields.push(["re", comment.parentCommentId]);
  }

  return serializeMetadataAttributes(Object.fromEntries(fields));
}

function serializeChangeMetadata(change: CriticChangeAttrs): string {
  return serializeMetadata({
    id: change.changeId,
    content: "",
    createdAt: change.createdAt,
    authorType: change.authorType,
    authorId: change.authorId,
    metadata: change.metadata,
  });
}

function endmatterEntryForComment(
  comment: CriticComment,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const by = comment.authorType === "ai" ? "AI" : comment.authorId || "user";
  const next: Record<string, unknown> = {
    ...existing,
    by,
    at: comment.createdAt,
  };

  if (comment.scope === "document") {
    next.body = comment.content;
    delete next.re;
  } else if (comment.parentCommentId) {
    next.body = comment.content;
    next.re = comment.parentCommentId;
  } else {
    delete next.body;
    delete next.re;
  }

  return next;
}

function endmatterEntryForChange(
  change: CriticChangeAttrs,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const by = change.authorType === "ai" ? "AI" : change.authorId || "user";

  return {
    ...existing,
    by,
    at: change.createdAt,
  };
}

function serializeReviewEndmatter(
  existingEndmatter: string | null,
  comments: Map<string, CriticComment>,
  changes: Map<string, CriticChangeAttrs>,
): string | null {
  if (!existingEndmatter) return null;

  const parsed = parseReviewEndmatter(existingEndmatter);
  if (parsed.diagnostics.length) return existingEndmatter;
  const commentEntries = new Map<string, Record<string, unknown>>();
  const suggestionEntries = new Map<string, Record<string, unknown>>();

  for (const comment of comments.values()) {
    commentEntries.set(
      comment.id,
      endmatterEntryForComment(comment, parsed.comments.get(comment.id)),
    );
  }

  for (const change of changes.values()) {
    suggestionEntries.set(
      change.changeId,
      endmatterEntryForChange(change, parsed.suggestions.get(change.changeId)),
    );
  }

  const source = `{#rfm}\n${existingEndmatter}`;
  const updated = updateRfmEndmatter(source, commentEntries, suggestionEntries);
  if (updated === source) return existingEndmatter;
  const body = source
    .slice(0, parsed.offset ?? source.length)
    .replace(/\s*$/, "\n");
  return updated.startsWith(body)
    ? updated.slice(body.length).replace(/^\n/, "") || null
    : null;
}

function getOrderedAnchorComments(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
): CriticComment[] {
  const visibleComments = commentIds
    .map((commentId) => comments.get(commentId))
    .filter((comment): comment is CriticComment => Boolean(comment));

  return flattenCommentThreads(buildCommentThreads(visibleComments));
}

function serializeCommentBlocks(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
  useEndmatter = false,
): string {
  const orderedComments = useEndmatter
    ? commentIds
        .map((commentId) => comments.get(commentId))
        .filter(
          (comment): comment is CriticComment =>
            comment !== undefined && !comment.parentCommentId,
        )
    : getOrderedAnchorComments(commentIds, comments);
  let result = "";

  for (const comment of orderedComments) {
    result += `{>>${comment.content}<<}${
      useEndmatter ? `{#${comment.id}}` : serializeMetadata(comment)
    }`;
  }

  return result;
}

function addCriticCommentRule(
  service: TurndownService,
  comments: Map<string, CriticComment>,
  useEndmatter = false,
) {
  service.addRule("criticComment", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      (node as HTMLElement).hasAttribute("data-comment-ids"),
    replacement(content, node) {
      const commentIdsText = (node as HTMLElement).getAttribute(
        "data-comment-ids",
      );

      if (!commentIdsText) return content;

      return serializeCriticCommentElement(
        (element) => service.turndown(element.innerHTML).trim(),
        node as HTMLElement,
        content,
        comments,
        useEndmatter,
      );
    },
  });
}

function serializeCriticCommentElement(
  serializeContent: (element: HTMLElement) => string,
  element: HTMLElement,
  content: string,
  comments: Map<string, CriticComment>,
  useEndmatter: boolean,
) {
  const commentIds = getElementCommentIds(element);
  const children = [...element.childNodes];
  const changeElement = children[0];
  const onlyChange =
    changeElement instanceof HTMLElement &&
    changeElement.hasAttribute("data-critic-change-kind") &&
    (children.length === 1 ||
      (children.length === 2 &&
        isPairedSubstitutionElement(
          children[1] instanceof Element ? children[1] : null,
          "substitution-new",
          changeElement.getAttribute("data-critic-change-id") ?? "",
        ) &&
        changeElement.getAttribute("data-critic-change-kind") ===
          "substitution-old"));
  if (onlyChange && changeElement instanceof HTMLElement) {
    return serializeCriticChangeElement(
      serializeContent,
      changeElement,
      serializeContent(changeElement),
      comments,
      commentIds,
      useEndmatter,
    );
  }

  const commentBlocks = serializeCommentBlocks(
    commentIds,
    comments,
    useEndmatter,
  );
  if (!commentBlocks) return content;
  if (content === unanchoredCommentSentinel) return commentBlocks;
  return `{==${content}==}${commentBlocks}`;
}

function serializeCriticCodeContent(
  element: HTMLElement,
  comments: Map<string, CriticComment>,
  useEndmatter: boolean,
): string {
  const serializeContent = (child: HTMLElement) =>
    serializeCriticCodeContent(child, comments, useEndmatter);

  return [...element.childNodes]
    .map((node) => {
      if (!(node instanceof HTMLElement)) return node.textContent ?? "";
      const content = serializeContent(node);
      if (node.hasAttribute("data-comment-ids")) {
        return serializeCriticCommentElement(
          serializeContent,
          node,
          content,
          comments,
          useEndmatter,
        );
      }
      if (node.hasAttribute("data-critic-change-kind")) {
        return serializeCriticChangeElement(
          serializeContent,
          node,
          content,
          comments,
          [],
          useEndmatter,
        );
      }
      return content;
    })
    .join("");
}

function addCriticCodeBlockRule(
  service: TurndownService,
  comments: Map<string, CriticComment>,
  useEndmatter: boolean,
) {
  service.addRule("criticCodeBlock", {
    filter: (node) => {
      if (node.nodeName !== "PRE") return false;
      const codeElement = (node as HTMLElement).firstElementChild;
      return (
        codeElement?.nodeName === "CODE" &&
        Boolean(
          codeElement.querySelector(
            "span[data-comment-ids], span[data-critic-change-kind]",
          ),
        )
      );
    },
    replacement(_content, node) {
      const codeElement = (node as HTMLElement)
        .firstElementChild as HTMLElement | null;

      if (!codeElement) return "";

      const language =
        [...codeElement.classList]
          .find((className) => className.startsWith("language-"))
          ?.slice("language-".length) ?? "";
      // Prose conversion collapses whitespace and escapes code syntax. Read text
      // nodes verbatim while serializing only the review marks around them.
      const content = serializeCriticCodeContent(
        codeElement,
        comments,
        useEndmatter,
      );
      const fenceLength = Math.max(
        3,
        ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1),
      );
      const fence = "`".repeat(fenceLength);

      return `\n\n${fence}${language}\n${content}\n${fence}\n\n`;
    },
  });
}

function getElementChangeAttrs(element: HTMLElement): CriticChangeAttrs | null {
  const kind = element.getAttribute("data-critic-change-kind");
  const changeId = element.getAttribute("data-critic-change-id");
  const createdAt = element.getAttribute("data-critic-change-at");

  if (
    kind !== "addition" &&
    kind !== "deletion" &&
    kind !== "substitution-old" &&
    kind !== "substitution-new"
  ) {
    return null;
  }

  if (!changeId || !createdAt) return null;

  const rawBy = element.getAttribute("data-critic-change-by") || "user";
  const authorType = rawBy.toUpperCase() === "AI" ? "ai" : "user";

  return {
    kind,
    changeId,
    createdAt,
    authorType,
    authorId: authorType === "ai" ? null : rawBy,
    metadata: JSON.parse(
      element.getAttribute("data-critic-change-metadata") || "{}",
    ),
  };
}

function isPairedSubstitutionElement(
  element: Element | null,
  kind: CriticChangeKind,
  changeId: string,
) {
  return (
    element instanceof HTMLElement &&
    element.getAttribute("data-critic-change-kind") === kind &&
    element.getAttribute("data-critic-change-id") === changeId
  );
}

function getElementCommentIds(element: HTMLElement): string[] {
  const commentIdsText = element.getAttribute("data-comment-ids");
  if (!commentIdsText) return [];

  try {
    const parsed = JSON.parse(commentIdsText) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function getChangeCommentBlocks(
  element: HTMLElement,
  comments: Map<string, CriticComment>,
  extraCommentIds: string[] = [],
  useEndmatter = false,
) {
  return serializeCommentBlocks(
    [...new Set([...getElementCommentIds(element), ...extraCommentIds])],
    comments,
    useEndmatter,
  );
}

function serializeCriticChangeElement(
  serializeContent: (element: HTMLElement) => string,
  element: HTMLElement,
  content: string,
  comments: Map<string, CriticComment>,
  extraCommentIds: string[] = [],
  useEndmatter = false,
) {
  const change = getElementChangeAttrs(element);

  if (!change) return content;

  const commentBlocks = getChangeCommentBlocks(
    element,
    comments,
    extraCommentIds,
    useEndmatter,
  );
  const metadata = useEndmatter
    ? `{#${change.changeId}}`
    : serializeChangeMetadata(change);

  if (change.kind === "addition") {
    return `{++${content}++}${metadata}${commentBlocks}`;
  }

  if (change.kind === "deletion") {
    return `{--${content}--}${metadata}${commentBlocks}`;
  }

  if (change.kind === "substitution-new") {
    return isPairedSubstitutionElement(
      element.previousElementSibling,
      "substitution-old",
      change.changeId,
    )
      ? ""
      : `{++${content}++}${
          useEndmatter
            ? `{#${change.changeId}}`
            : serializeChangeMetadata({
                ...change,
                kind: "addition",
              })
        }${commentBlocks}`;
  }

  const nextElement = element.nextElementSibling;

  if (
    nextElement instanceof HTMLElement &&
    isPairedSubstitutionElement(
      nextElement,
      "substitution-new",
      change.changeId,
    )
  ) {
    const replacement = serializeContent(nextElement);
    return `{~~${content}~>${replacement}~~}${metadata}${commentBlocks}`;
  }

  return `{--${content}--}${
    useEndmatter
      ? `{#${change.changeId}}`
      : serializeChangeMetadata({
          ...change,
          kind: "deletion",
        })
  }${commentBlocks}`;
}

function addCriticChangeRule(
  service: TurndownService,
  comments: Map<string, CriticComment>,
  useEndmatter = false,
) {
  service.addRule("criticChange", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      (node as HTMLElement).hasAttribute("data-critic-change-kind"),
    replacement(content, node) {
      const element = node as HTMLElement;
      return serializeCriticChangeElement(
        (child) => service.turndown(child.innerHTML).trim(),
        element,
        content,
        comments,
        [],
        useEndmatter,
      );
    },
  });
}

function collectCriticChangesFromDoc(
  doc: JSONContent,
): Map<string, CriticChangeAttrs> {
  const changes = new Map<string, CriticChangeAttrs>();
  const visit = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "criticChange") continue;

      const attrs = mark.attrs as Partial<CriticChangeAttrs> | undefined;
      if (
        attrs?.changeId &&
        attrs.kind &&
        attrs.createdAt &&
        attrs.authorType
      ) {
        changes.set(attrs.changeId, {
          kind: attrs.kind,
          changeId: attrs.changeId,
          createdAt: attrs.createdAt,
          authorType: attrs.authorType,
          authorId: attrs.authorId ?? null,
          metadata: attrs.metadata,
        });
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };

  visit(doc);
  return changes;
}

export function editorStateToCriticMarkdown(
  doc: JSONContent,
  comments: Map<string, CriticComment>,
  options?: {
    frontmatter?: string | null;
    endmatter?: string | null;
    lineEnding?: "\n" | "\r\n";
  },
): string {
  const service = createTurndownService();
  const frontmatter =
    options?.frontmatter ??
    (doc as JSONContent & { yamlFrontmatter?: string }).yamlFrontmatter ??
    null;
  const sourceEndmatter =
    options?.endmatter ??
    (doc as JSONContent & { yamlEndmatter?: string }).yamlEndmatter ??
    null;
  const changes = collectCriticChangesFromDoc(doc);
  const presentIds = new Set<string>(changes.keys());
  const visit = (node: JSONContent) => {
    for (const mark of node.marks ?? [])
      if (mark.type === "commentRef")
        for (const id of mark.attrs?.commentIds ?? []) presentIds.add(id);
    node.content?.forEach(visit);
  };
  visit(doc);
  for (const comment of comments.values())
    if (comment.scope === "document") presentIds.add(comment.id);
  let added = true;
  while (added) {
    added = false;
    for (const comment of comments.values())
      if (
        comment.parentCommentId &&
        presentIds.has(comment.parentCommentId) &&
        !presentIds.has(comment.id)
      ) {
        presentIds.add(comment.id);
        added = true;
      }
  }
  comments = new Map([...comments].filter(([id]) => presentIds.has(id)));
  const useEndmatter = Boolean(sourceEndmatter);
  addCriticCommentRule(service, comments, useEndmatter);
  addCriticChangeRule(service, comments, useEndmatter);
  addCriticCodeBlockRule(service, comments, useEndmatter);
  const endmatter = serializeReviewEndmatter(
    sourceEndmatter,
    comments,
    changes,
  );
  const blocks = [...(doc.content ?? [])];
  if (
    blocks.length > 1 &&
    blocks.at(-1)?.type === "paragraph" &&
    !blocks.at(-1)?.content?.length
  )
    blocks.pop();
  let body = "";
  for (let index = 0; index < blocks.length; ) {
    const previous = blocks[index - 1];
    const block = blocks[index++];
    if (!block) throw new Error("Expected an editor Markdown block");
    const group = [block];
    if (block.attrs?.sourceGroup) {
      while (index < blocks.length) {
        const next = blocks[index];
        if (!next || next.attrs?.sourceGroup !== block.attrs.sourceGroup) break;
        group.push(next);
        index++;
      }
    }
    const grouped = { type: "doc", content: group };
    const source = block.attrs?.originalSource;
    if (
      typeof source === "string" &&
      block.attrs?.sourceSnapshot === blockSnapshot(grouped) &&
      block.attrs?.sourceComments === blockCommentSnapshot(grouped, comments)
    ) {
      body += source;
    } else {
      const html = generateHTML(grouped, extensions);
      const markdown = normalizeBlockSpacing(service.turndown(html).trim());
      if (body && !body.endsWith("\n")) body += "\n\n";
      else if (
        body &&
        typeof source !== "string" &&
        previous?.type !== "heading" &&
        !body.endsWith("\n\n")
      )
        body += "\n";
      const separator =
        typeof source === "string" ? source.match(/\s*$/)?.[0] : null;
      body += markdown + (separator || (index < blocks.length ? "\n\n" : "\n"));
    }
  }
  const output = appendYamlEndmatter(
    prependYamlFrontmatter(body, frontmatter),
    endmatter,
  );
  const lineEnding =
    options?.lineEnding ??
    (doc as JSONContent & { lineEnding?: "\n" | "\r\n" }).lineEnding;
  return lineEnding === "\r\n" ? output.replace(/\r?\n/g, "\r\n") : output;
}

const extensions = createEditorExtensions("");
