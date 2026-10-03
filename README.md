# Inkback

A local Markdown editor and review app. Open a file, leave comments and suggested edits, and save review data in the Markdown itself.

## Develop

Use Node.js 24 and pnpm 10.

```bash
pnpm install
pnpm dev
```

The development command starts the frontend and API and prints the browser URL.

## Build and run

```bash
pnpm build
node packages/server/bin/inkback.mjs open /absolute/path/to/document.md
```

The open command waits for Finish review. Use `--no-watch` to open without waiting for a review handoff. Run `help` for other CLI commands.

The browser server listens on loopback addresses and accepts local Host and Origin hostnames. Filesystem access is limited to the initial project directory and `INKBACK_ALLOWED_DIRS` (separated by the platform path delimiter); without either, it uses the working directory. Restart the server with the required allowed directories when opening files elsewhere. The project picker can list directories without granting access to their files.

## Verify

```bash
pnpm check
pnpm exec playwright install chromium
pnpm test:smoke
pnpm test:package
```

Browser smoke tests and installed-package verification run separately from `pnpm check`.

## Use as an MCP App

Build the checkout with Node 24, then configure an MCP Apps host to run:

```bash
node /absolute/path/to/inkback/packages/server/bin/inkback.mjs mcp /absolute/path/to/docs
```

Ask the model to open a Markdown file with `inkback_open_review`. The conversation shows a summary card. Click **Open review**, add comments or suggestions, then **Finish review**. Add an optional overall comment, click **Preview message**, review the exact text, and click **Send to conversation**. If the host refuses delivery, copy the message into the conversation. Finish review does not authorize accepting every suggestion or implementing a plan.

Writes are limited to real paths within allowed directories; symlinks cannot escape them. Directory arguments, `INKBACK_ALLOWED_DIRS` (separated by the platform path delimiter), and client roots are combined. With none, the working directory is writable, except a filesystem root such as `/`. Client roots replace that default when they arrive. Use `--no-roots` to ignore client roots. Other Markdown files open read-only; their overall comments go into the message without changing the file. Markdown documents are limited to 2 MiB and local images to 5 MiB. Remote images and navigation to other files are unavailable in this view.

### Claude Desktop

```bash
pnpm build:mcpb
```

Install `dist/inkback-<version>.mcpb` through Claude Desktop's extension settings and choose **Allowed Directories**. The bundle requires a host Node runtime of 24 or newer.

Claude Desktop may place **Send to conversation** text in its message composer. Press Claude's **Send** button to submit it. If its sandbox blocks copying, Inkback shows **Copy is not available in this host**.

Alternatively, add this checkout configuration to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "inkback": {
      "command": "node",
      "args": ["/absolute/path/to/inkback/packages/server/bin/inkback.mjs", "mcp", "/absolute/path/to/docs"]
    }
  }
}
```

### VS Code Copilot and Goose

For VS Code, use `.vscode/mcp.json`:

```json
{
  "servers": {
    "inkback": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/inkback/packages/server/bin/inkback.mjs", "mcp", "/absolute/path/to/docs"]
    }
  }
}
```

For Goose, add a stdio extension with the same command and arguments. Each host needs MCP Apps support to display the editor. `inkback doctor` reports the bundled UI and configured writable directories; client roots are visible only in the running MCP server's stderr.

### MCP verification

`pnpm check` builds both editor entries and checks the UI size. `pnpm test:smoke` also tests the production MCP App with the official `ext-apps` 2.0.3 basic-host sandbox. On its first run, the test harness downloads that pinned example into the temporary directory and installs its build dependencies. It uses loopback ports 4320, 8080, and 8081. `pnpm test:package` checks the installed stdio server and UI outside the workspace; `pnpm build:mcpb` verifies the staged server before packing it.

Desktop-host verification and remaining release gates are recorded in [the implementation plan](.planning/inkback-mcp-app-plan.md). The browser CLI flow remains available alongside the MCP App. See [release notes](CHANGELOG.md) for protocol and write-policy changes.

## Agent skill

The package includes a portable skill for reviewing Markdown with a coding agent:

```bash
node packages/server/bin/inkback.mjs skill install /path/to/skills/inkback
```

See [`packages/skill/inkback/SKILL.md`](packages/skill/inkback/SKILL.md).

## License and attribution

Derived from [Roughdraft](https://github.com/Lex-Inc/roughdraft), created by Nathan Baschez, under the MIT license. Upstream copyright and license notices must be preserved when redistributing.
