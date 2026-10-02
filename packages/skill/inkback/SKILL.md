---
name: inkback
description: Open saved Markdown in Inkback for human review and respond to comments and suggested edits.
---

# Inkback

## Review a document

If `inkback_open_review` is available, call it with the absolute document path. Then wait for the Inkback review message in the conversation. Do not call `inkback_watch_review_events` after opening an MCP App. Read feedback with `inkback_get_pending_feedback`; use the current `version` (or review index `fileVersion`) as `expectedVersion` with reply and resolve tools.

Read the current file from disk before you act. Finish review does not approve all suggestions or the implementation of a plan. Act only within the scope that the user already gave you. Use inkback_get_pending_feedback for the item details.

If the MCP App tool is unavailable, use the terminal flow:

1. Save the document as one local `.md` file, preserving unrelated user edits.
2. Run `inkback open "/absolute/path/to/file.md"`. In a source checkout, run `node packages/server/bin/inkback.mjs open "/absolute/path/to/file.md"`. Leave the command running until Finish review. Use `--no-watch` only when intentionally opening without a handoff.
3. After completion, reread the current Markdown from disk. Do not edit a pre-review snapshot.
4. Answer questions and address feedback within the user's existing authorization. Finish review alone does not approve implementing a plan or accepting every suggestion.
5. Preserve unresolved items, IDs, metadata, links, images, frontmatter, and literal code examples. Reopen when useful or requested.

## Read and write feedback

Base markers: comment `{>>text<<}`, insertion `{++text++}`, deletion `{--text--}`, substitution `{~~old~>new~~}`, highlight `{==text==}`. Ignore markers inside code spans and fenced code.

Prefer compact references with final YAML endmatter. Read the latest IDs before allocating a fresh document-local ID. Preserve older inline attribute blocks when present. For replies, keep the existing anchor and add `body`, `by`, the current ISO timestamp `at`, and `re` pointing to the parent comment or suggestion. Document-level comments have no inline anchor and no `re`.

```markdown
{==selected text==}{>>Clarify this.<<}{#c1}

---
comments:
  c1:
    by: user
    at: "2026-10-02T12:00:00.000Z"
  c2:
    body: Added the requested example.
    by: AI
    at: "2026-10-02T12:05:00.000Z"
    re: c1
```

Run `inkback help criticmarkup` for exact syntax. Keep review data in the Markdown file.
