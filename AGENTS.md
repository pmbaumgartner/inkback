# Development

- Keep UI primitives in `packages/app/src/components/ui/` in the existing shadcn style.
- Use the checkout CLI (`node packages/server/bin/inkback.mjs`), not a globally installed app, when verifying local changes.
- `pnpm check` covers lint, unit tests, and builds. `pnpm test:smoke` separately exercises browser boundaries.
- Keep the bundled agent skill aligned with supported CLI behavior.
