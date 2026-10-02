# Roughdraft agent setup

Install the built fork release using the command in the current [Roughdraft README](https://github.com/pmbaumgartner/roughdraft#quick-start). Verify `roughdraft --version` and `roughdraft help`.

Install the reusable Roughdraft Agent Skill in a supported skill directory. Do not append workflow instructions to AGENTS.md, CLAUDE.md, GEMINI.md, or another user-level instruction file. Do not create aliases or symlinks between those files.

For Pi, install the extension and bundled skill together:

```bash
pi install git:github.com/pmbaumgartner/pi-roughdraft
```

For another agent, select its documented skill root. For example, when the agent supports project `.agents/skills`:

```bash
roughdraft skill install "$PWD/.agents/skills/roughdraft"
```

For Claude Code's project skill root, use `$PWD/.claude/skills/roughdraft` instead. Use `--force` only when intentionally updating an existing Roughdraft skill. Reload or restart the agent, confirm the `roughdraft` skill is discovered, and read its SKILL.md. `roughdraft skill path` prints the packaged source directory. The package includes the full skill and its environment setup reference, so installation does not depend on fetching a live prompt.

Test with a disposable Markdown document in the workspace. In Pi, ask for `roughdraft_review`; otherwise run `roughdraft open /absolute/path/to/example.md` and leave the command waiting until Finish review. Then reread the saved file and respond to its feedback. A handoff is feedback, not additional implementation authorization.

For source development and managed-runtime workarounds, follow the bundled skill's `references/environment-setup.md`.
