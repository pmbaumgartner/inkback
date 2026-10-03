import type { KnownCommand } from "./types.js";

export function printHelp(log: (message: string) => void) {
  log("Inkback is a local Markdown review app for AI-assisted workflows.");
  log("");
  log("Usage:");
  log("  inkback [flags] <command> [args]");
  log("  inkback <path>");
  log("");
  log("Commands:");
  log("  open <path>        Open a Markdown file and wait for Finish review");
  log("  start              Start or reuse the background server");
  log("  status             Show server status");
  log("  stop               Stop the managed background server");
  log("  watch <path>       Wait for a Finish review event");
  log(
    "  mcp [dir ...]      Start the MCP App server (default writes: working directory)",
  );
  log("  doctor [path]      Diagnose setup or validate Markdown");
  log("  help criticmarkup  Show CriticMarkup examples");
  log("  skill              Locate or install the Inkback agent skill");
  log("  criticmarkup       Show CriticMarkup examples");
  log("");
  log("Flags:");
  log("  -h, --help         Show help");
  log("  --version          Print version");
  log("  --json             Print JSON for supported commands");
  log("  --no-color         Disable color");
  log("");
  log("Examples:");
  log("  inkback open ./draft.md");
  log("  inkback open ./draft.md --print-url");
  log("  inkback open ./draft.md --json");
  log("  inkback open ./draft.md --no-watch");
  log("  inkback watch ./draft.md --json");
  log("  inkback status --json");
  log("");
}

export function printCommandHelp(
  command: KnownCommand,
  log: (message: string) => void,
) {
  if (command === "open") {
    log("Usage:");
    log(
      "  inkback open <path> [--no-open] [--no-watch] [--print-url] [--port <port>]",
    );
    log("");
    log(
      "Opens one Markdown file and waits for Finish review. Starts Inkback if needed.",
    );
    log("");
    log("Flags:");
    log(
      "  --no-open            Start/reuse the server without opening a browser",
    );
    log(
      "  --print-url          Print only the document URL and do not open it",
    );
    log("  --no-watch           Open the file without waiting");
    log(
      "  --review-id <id>     Route this viewer to a session (requires --no-watch)",
    );
    log("  --timeout <seconds>  Maximum watch time; omitted means no timeout");
    log("  --replay             Allow watch to return retained older events");
    log("  --json               Print machine-readable output");
    log("  --port <port>        Preferred server port");
    log("  --state-file <path>  Server state file");
    log("  --state-dir <dir>    Directory containing server.json");
    log("");
    log("Environment variables:");
    log("  INKBACK_NO_OPEN    Set to 1 to suppress browser launch.");
    return;
  }

  if (command === "start") {
    log("Usage:");
    log("  inkback start [--port <port>] [--json]");
    log("");
    log("Starts or reuses the background Inkback server.");
    log("");
    log("Flags:");
    log("  --json               Print machine-readable output");
    log("  --port <port>        Preferred server port");
    log("  --state-file <path>  Server state file");
    log("  --state-dir <dir>    Directory containing server.json");
    return;
  }

  if (command === "status") {
    log("Usage:");
    log("  inkback status [--json]");
    log("");
    log("Shows whether Inkback is running.");
    log("");
    log("Flags:");
    log("  --json               Print machine-readable output");
    log("  --state-file <path>  Server state file");
    log("  --state-dir <dir>    Directory containing server.json");
    return;
  }

  if (command === "stop") {
    log("Usage:");
    log("  inkback stop [--all]");
    log("");
    log("Stops the managed background Inkback server.");
    log("");
    log("Flags:");
    log(
      "  --all                Also stop a confidently detected unmanaged server",
    );
    log("  --state-file <path>  Server state file");
    log("  --state-dir <dir>    Directory containing server.json");
    return;
  }

  if (command === "watch") {
    log("Usage:");
    log("  inkback watch <path> [--json] [--timeout <seconds>]");
    log("");
    log("Waits until Inkback receives Finish review for one Markdown file.");
    log("");
    log("Flags:");
    log("  --json                    Print machine-readable output");
    log(
      "  --timeout <seconds>       Maximum wait time; omitted means no timeout",
    );
    log(
      "  --batch-window <seconds>  Small event batching window, default 0.25",
    );
    log(
      "  --replay                  Return retained older events if available",
    );
    log("  --state-file <path>       Server state file");
    log("  --state-dir <dir>         Directory containing server.json");
    return;
  }

  if (command === "mcp") {
    log("Usage:");
    log("  inkback mcp [dir ...] [--no-roots]");
    log("  Writes default to the working directory, except a filesystem root.");
    log("");
    log("Starts Inkback's stdio MCP App server.");
    return;
  }

  if (command === "doctor") {
    log("Usage:");
    log("  inkback doctor [path] [--json]");
    log("");
    log(
      "Diagnoses local Inkback setup and server state, or validates one Markdown file.",
    );
    log("");
    log("Flags:");
    log("  --json               Print machine-readable output");
    log("  --state-file <path>  Server state file");
    log("  --state-dir <dir>    Directory containing server.json");
    return;
  }

  if (command === "help") {
    printHelp(log);
    return;
  }

  if (command === "skill") {
    log(
      "Usage: inkback skill path | inkback skill install <skill-root>/inkback [--force]",
    );
    log(
      "Installs the packaged Agent Skill at an explicit path. Reload your agent's skills afterward.",
    );
    return;
  }

  printCriticMarkupHelp(log);
}

export function printCriticMarkupHelp(log: (message: string) => void) {
  log("CriticMarkup reference:");
  log("  {>>comment<<}       Comment");
  log("  {++new text++}      Insertion");
  log("  {--old text--}      Deletion");
  log("  {~~old~>new~~}      Substitution");
  log("  {==text==}          Highlight");
  log("");
  log("Examples:");
  log("  The intro {~~is vague~>needs a tighter claim~~}.");
  log("  Add {>>one concrete example here<<} before the conclusion.");
  log("");
  log("When adding new review feedback:");
  log(
    "  Prefer compact references like {>>Comment<<}{#c1} with metadata in final YAML endmatter.",
  );
  log(
    "  Use `c1`, `c2`, etc. for comment ids and `s1`, `s2`, etc. for suggested-change ids.",
  );
  log(
    "  Set `by` to your agent or author label and `at` to the current ISO timestamp.",
  );
  log("");
  log("Anchored comment with id:");
  log("  Review {==this sentence==}{>>Needs a source<<}{#c1}.");
  log("  ---");
  log("  comments:");
  log("    c1:");
  log("      by: AI");
  log('      at: "2026-04-28T12:00:00.000Z"');
  log("");
  log("Suggested changes with ids:");
  log("  Add {++one concrete example++}{#s1}.");
  log("  Replace {~~vague phrasing~>specific wording~~}{#s2}.");
  log("  ---");
  log("  suggestions:");
  log("    s1:");
  log("      by: AI");
  log('      at: "2026-04-28T12:10:00.000Z"');
  log("    s2:");
  log("      by: AI");
  log('      at: "2026-04-28T12:11:00.000Z"');
  log("");
  log("Reply to an existing comment:");
  log("  Store replies in `comments.<id>.body` with `re: <parent-id>`.");
  log("");
  log("Reply guidance:");
  log(
    "  Existing inline attribute metadata is still accepted for compatibility.",
  );
  log(
    "  Comment ids are document-local and usually look like `c1`, `c2`, `c3`.",
  );
  log("");
  log("Code blocks:");
  log("  Review markup in fenced code blocks is included in review feedback.");
}
