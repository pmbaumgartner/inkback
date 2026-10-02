# Release notes

## Unreleased — MCP App

- Review local Markdown directly inside an MCP Apps conversation. The editor supports inline/fullscreen display, local images, host theme changes, version conflicts, and an exact Finish review message preview with a copy fallback.
- Add `inkback_open_review` and six app-only tools. `inkback_get_open_documents` now lists reviews opened by the server. Read tools return file versions for guarded model edits.
- Ship a Claude Desktop MCPB bundle and configuration examples for VS Code Copilot and Goose. The bundle requires Node 24 or newer; desktop runtime compatibility remains a manual release gate.
- Replace the hand-written protocol loop with the pinned official SDK. MCP stdio now uses newline-delimited JSON exclusively. Content-Length framing is removed. The SDK negotiates protocol versions.
- Restrict writes to configured directories and client roots. With neither, the process working directory is writable unless it is a filesystem root. Reads may still access other Markdown files, which the embedded editor displays read-only.
- Require Node 24 for development and CI. Documents in the MCP flow are limited to 2 MiB; image assets to 5 MiB.
- Sanitize rendered Markdown to prevent scripts, event-handler attributes, unsafe links, and embedded frames from executing in either editor entry.

File version checks and synchronous writes prevent interleaving within one process. Separate CLI and MCP processes can still race between the version check and write.
