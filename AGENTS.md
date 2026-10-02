# Development

- Keep UI primitives in `packages/app/src/components/ui/` in the existing shadcn style.
- Use the checkout CLI (`node packages/server/bin/inkback.mjs`), not a globally installed app, when verifying local changes.
- `pnpm check` covers lint, unit tests, and builds. `pnpm test:smoke` separately exercises browser boundaries.
- Keep the bundled agent skill aligned with supported CLI behavior.

- The MCP App build and 3 MB size check run in `pnpm build`; the loopback HTTP transport in `packages/server/test-support/` is for host tests only and must not ship.
- Record host verification in `.planning/inkback-mcp-app-plan.md` (S11.6 and S11.8); automated checks do not establish desktop-host compatibility.
