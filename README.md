# NAME_PLACEHOLDER

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
node packages/server/bin/name-placeholder.mjs open /absolute/path/to/document.md
```

The open command waits for Finish review. Use `--no-watch` to open without waiting for a review handoff. Run `help` for other CLI commands.

## Verify

```bash
pnpm check
pnpm exec playwright install chromium
pnpm test:smoke
pnpm test:package
```

Browser smoke tests and installed-package verification run separately from `pnpm check`.

## Agent skill

The package includes a portable skill for reviewing Markdown with a coding agent:

```bash
node packages/server/bin/name-placeholder.mjs skill install /path/to/skills/name-placeholder
```

See [`packages/skill/name-placeholder/SKILL.md`](packages/skill/name-placeholder/SKILL.md).

## License and attribution

Derived from [Roughdraft](https://github.com/Lex-Inc/roughdraft), created by Nathan Baschez, under the MIT license. Upstream copyright and license notices must be preserved when redistributing.
