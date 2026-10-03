# Inkback tooling follow-up: package layout and Markdown pipeline

## Executive summary

**Fix 9 is worth doing as a publication-boundary cleanup.** Separate the private workspace from the generated `inkback` release package first. Bundling and flattening the release are a second, optional decision: they require deliberate changes to runtime paths and the detached HTTP server entrypoint. The original half-day estimate understates that combined change.

**Fix 10 merits a two-day spike, not a committed rewrite.** Direct Markdown ↔ TipTap JSON conversion is feasible, but stock `@tiptap/markdown` is not a byte-preserving replacement. Inkback already preserves unchanged source; most of its review model, metadata handling, opaque raw blocks, and source snapshots must remain. The spike must demonstrate simpler *edited-block conversion*, not just passing ordinary Markdown examples.

| Proposal | Recommended next action | Main decision gate |
|---|---|---|
| 9: Publication ownership | Private build workspace plus generated release tree | Clean install and external-package checks pass; root has no runtime dependencies |
| 9: Bundled/flat distribution | Optional follow-up, separate from ownership cleanup | CLI, detached child, assets, skill, versions, and MCPB work from the installed artifact |
| 10: Direct Markdown adapter | Timeboxed prototype on an isolated branch | Preservation/security/review behavior stays intact and total conversion code becomes meaningfully smaller |

No implementation of either proposal was made during this evaluation.

## Scope and evidence

Baseline: commit `0b5f052`, Node 24.13.1, pnpm 12.8.1, macOS. Production source, repository dependencies, and the lockfile were left unchanged. Scratch package installations and probes ran outside the repository.

Labels used below:

- **Verified:** inspected repository source or versioned upstream implementation.
- **Measured:** a local command or experiment was run.
- **Proposed:** a design, estimate, or acceptance criterion—not an established result.

The code graph was used for discovery and call tracing, followed by source reads. Its generation was `2026-10-03T11:38:15Z`; relevant existing files had no recorded coverage issues. That is a best-effort signal, not proof of exhaustive analysis. A guessed extension filename was corrected to `packages/app/src/editor-extensions.ts`.

No release was published. No complete bundler build or adapted Markdown pipeline was implemented. No candidate web/MCP bundle-size or end-to-end performance improvement has been measured. Desktop-host compatibility remains outside these automated checks.

## Fix 9: Published package layout

### Current design

**Verified:** the root `package.json` is both the workspace controller and the published `inkback` package. It declares the executable, release file inventory, and seven runtime dependencies. The server workspace owns most of the same dependencies; rfm owns `yaml`.

```text
Workspace root / published inkback package
├── packages/server/bin/inkback.mjs → server/dist/cli.js
├── packages/server/dist/child.js   ← launched by the CLI
├── packages/rfm/dist              ← file:packages/rfm dependency
├── packages/app/dist              ← browser HTTP assets
├── packages/app/dist-mcp-app       ← MCP App resource
└── packages/skill/inkback          ← installable agent skill
```

Existing strengths should be retained:

- `scripts/test-package.mjs` packs and installs outside the workspace, with install scripts disabled.
- `scripts/build-mcpb.mjs` installs the same npm artifact into a production-dependency stage, then smoke-tests the MCP server before packing the desktop bundle.
- The checkout launcher remains available at `packages/server/bin/inkback.mjs`.
- Explicit release files keep the host-only loopback transport out of distributed packages.

Two details qualify the original rationale:

1. Moving dependency declarations to a publisher does not automatically remove overlap with the development server's manifest. That overlap can be legitimate. A generated release manifest can instead select dependencies from their source owners.
2. `knip.json:3–14` contains six root-scoped dependency ignores and two global ignores, not eight root-scoped ignores. Moving packaging may remove the six root exceptions; it does not establish that every remaining ignore should disappear. Knip currently also reports unrelated unused files/exports/types.

### Options and recommended approach

| Option | Benefit | Cost / limitation |
|---|---|---|
| Keep current layout | No migration risk; existing package smoke passes | Publication remains mixed with workspace management |
| Separate builder and generated release, preserving internal tree | Clear ownership; root runtime dependencies can be removed; minimal runtime changes | Tarball stays nested and retains its internal `file:` dependency |
| Separate builder and bundle private server/rfm into a flat release | Removes vendored rfm package dependency; simpler installed tree | New bundler, multiple entrypoints, path/identity/version changes, more installed-runtime verification |

**Recommendation: choose the middle option first.** It solves the publication-boundary problem without simultaneously changing how every runtime resource is located. Keeping the internal tree is a deliberate scope choice, not a compatibility shim. If a flat tarball is itself the goal, choose the bundled option with its additional work explicitly budgeted.

#### Clean-checkout-safe structure

Track a private build workspace; generate the actual published package beneath its ignored `dist` directory:

```text
Git-tracked:
  packages/cli/package.json       # private; e.g. @inkback/cli-build
  packages/cli/build-release.mjs  # staging and release-manifest generation

Generated, ignored:
  packages/cli/dist/
    package.json                 # name: inkback; publishable
    LICENSE
    README.md
    packages/server/bin/inkback.mjs
    packages/server/dist/...
    packages/server/defaults.mjs
    packages/rfm/package.json
    packages/rfm/dist/...
    packages/app/dist/...
    packages/app/dist-mcp-app/...
    packages/skill/inkback/...
```

Only the **generated** release manifest should declare `@inkback/rfm: file:packages/rfm`. That directory exists after staging and before packing. Genuine source-workspace relationships use `workspace:*`; do not put dependencies on generated directories in the tracked build manifest.

**Measured:** pnpm 12.8.1 installation failed when a tracked publisher manifest referenced a nonexistent staged `file:packages/rfm` directory. Using the source rfm workspace instead made installation succeed. This is why simply moving today's root manifest into `packages/cli` is insufficient.

Keep the private root's version as the initial single version authority: current checkout CLI and MCP code already read it. Generate the release manifest's version from that authority. Do not introduce independently maintained release versions.

#### What a bundled alternative entails

A flat generated release could instead contain:

```text
bin/inkback.mjs
 dist/cli.js
 dist/child.js
 dist/<shared chunks>
 assets/web/...
 assets/mcp-app/mcp-app.html
 skill/inkback/...
 package.json
 LICENSE
 README.md
```

At least **CLI and child** entries are necessary. `cli/dependencies.ts:61–90` launches `../child.js` by runtime filename, detached and with the document directory as its working directory. It is not an ordinary import that a single CLI-entry bundle will automatically discover.

Bundle private server/rfm code; keep `express`, `yaml`, `zod`, and the production MCP packages `@modelcontextprotocol/{core,server,ext-apps}` external. Do not pull in host-only `@modelcontextprotocol/{node,express}`, client test helpers, or the loopback test transport.

Tsdown externalizes manifest dependencies by default. Explicitly include private workspace code and explicitly set runtime externals; declaring rfm as a dependency and accepting default bundler behavior can leave it unbundled. Select and verify the bundler version/API during implementation rather than assuming a configuration shape here.

### Implementation steps and risks

**Proposed ownership cleanup:**

1. Make the root private; optionally rename it to `inkback-workspace`. Keep developer scripts and the version authority, but remove root publication `bin`, `files`, and runtime dependencies.
2. Add the private build workspace and one staging script. Select release dependencies explicitly from the source manifests; reject conflicting versions rather than blindly merging them.
3. Clean the generated release directory before staging. Copy only release inputs, including the complete skill and upstream license. Do not copy tests, test-support, or node_modules.
4. Generate the publishable manifest after all staged `file:` targets exist.
5. Run staging after the existing rfm/app/server builds. Pack with **cwd `packages/cli/dist`**, never the private root or builder workspace.
6. Update `scripts/test-package.mjs:33–37` and `scripts/build-mcpb.mjs:24–28` to pack that directory. Keep MCPB's install-and-smoke flow.
7. Register the staging entry in Knip and remove root exceptions whose declarations actually disappeared. Do not treat zero ignores as an architectural requirement.
8. Update release instructions and retain the checkout CLI path used for local verification.

**Additional work for bundling:** replace assumptions that module-relative directory depth identifies the installation. These are concrete change sites, not an exhaustive future bundle-impact list:

| Consumer under `packages/server/` | Current assumption / consequence |
|---|---|
| `bin/inkback.mjs:3` | Imports `../dist/cli.js` |
| `src/cli/dependencies.ts:65–67` | Child entry is `../child.js` relative to the dependencies module |
| `src/cli/paths.ts:4–16` | Four-level ancestor is the installation/checkout root and dev-state location |
| `src/cli/output.ts:4–16` | That root's manifest supplies the version; failure silently returns `0.0.0` |
| `src/index.ts:32–34` | Sibling app distribution supplies HTTP assets; ancestor supplies server identity |
| `src/skill.ts:5–7` | Skill is a sibling package directory |
| `src/mcp/ui-resource.ts:9–11` | MCP HTML is in the sibling app package |
| `src/mcp/server.ts:3,16` | Static ancestor-manifest import supplies MCP version |
| `src/network.ts:1`, `src/dev.ts:7–10` | Defaults and checkout/sandbox locations remain meaningful in development |

CLI and child must agree on installation identity. Server reuse and development-frontend matching depend on it (`src/cli/server-lifecycle.ts:257–421`). Wrong offsets can select an unrelated ancestor directory or manifest, not just cause a visible missing-file error.

A bundled layout must also update **both** `server.entry_point` and `server.mcp_config.args` in `mcpb/manifest.json:13–19`. Keeping the mirrored layout avoids those path changes.

**Measured package-manager behavior, in scratch projects:** npm 11.8.0 packing retained `workspace:*`; pnpm 12.8.1 packing rewrote it to a workspace version but did not embed the private dependency. An internal staged `file:` dependency installed and ran outside its workspace. `pnpm deploy` also produced a runnable isolated tree, but that is an installed deployment tree—not automatically a publishable npm tarball containing its node_modules. Neither `workspace:*` nor `deploy` is a drop-in replacement for the current release strategy.

Preserve the complete MIT copyright and permission notice in `LICENSE`, including Nathan Baschez/Roughdraft attribution. Copy it into the generated package; it will not be inherited from an ancestor directory. Contributor metadata may be additive. Dependency/font notice review is separate from deciding whether to bundle server code.

### Verification and decision gates

Run the ordinary repository checks, then verify the *installed release*, not just workspace source:

- Fresh checkout: frozen installation succeeds before build/staging output exists.
- Stage and inspect the tarball's declared runtime closure, both UI assets, portable skill, and license; host-only transport stays excluded.
- Install outside the workspace with lifecycle scripts disabled; run existing package smoke.
- Assert the **exact expected** CLI and MCP initialization versions. The existing CLI version regex accepts `0.0.0`, so it would miss a broken version path.
- Exercise installed CLI `start/status/stop`, detached-child survival, server reuse, and HTTP asset serving with isolated state/ports and guaranteed process cleanup. Existing package smoke tests MCP, not that child-process launch path.
- Check checkout dev-frontend matching and separation from another installed server's identity.
- Build MCPB from the same tarball, test its staged entrypoint, and inspect the archive. Desktop-host verification remains manual.

**Estimates, not measured:** publication separation **0.5–1.5 engineering days**; the bundled alternative **2–4 days total**, including path changes and installed-child tests. Host verification scheduling is additional.

## Fix 10: Direct Markdown round trips

### Current design

**Verified:** “Markdown → HTML → TipTap → HTML → Markdown” omits an important existing preservation layer:

1. Normalize line endings and split YAML frontmatter/rfm endmatter.
2. Lex source into marked blocks and recognize review syntax with shared rfm parsing.
3. Sanitize rendered blocks and convert them to TipTap JSON.
4. Store original source, group identity, document snapshots, and comment snapshots.
5. On save, reuse source for unchanged groups. Only changed groups go through HTML/Turndown serialization.
6. Update review endmatter, reattach frontmatter, and restore line endings.

See `packages/app/src/critic-markup/index.ts:660–764`, `writer.ts:513–618`, and `source-blocks.ts:1–49`.

**Measured baseline:** all eight Markdown fixtures round-trip byte-for-byte. All eight retain their original bytes when an appended, unrelated paragraph is edited. The 11 rich-text-preservation tests and two rendered-Markdown security cases pass.

| Fixture | No-op bytes preserved | Unrelated edit preserves fixture |
|---|---|---|
| `criticmarkup-basic.md` | Yes | Yes |
| `criticmarkup-code-fences.md` | Yes | Yes |
| `frontmatter-table-yaml.md` | Yes | Yes |
| `headerless-table.md` | Yes | Yes |
| `links-and-images.md` | Yes | Yes |
| `mixed-roundtrip.md` | Yes | Yes |
| `tables-and-task-lists.md` | Yes | Yes |
| `unsafe-html.md` | Yes | Yes |

This does not establish full editability: headerless HTML tables and unsafe HTML are opaque `rawMarkdownBlock` nodes. Keeping unsafe source on disk is distinct from executing it in the editor.

**Verified maintenance signal:** `9c5330d` introduced source snapshots and preservation tests; `0c476d9` made further reference/serialization fixes. These justify a focused spike, not a presumption that a rewrite is cheaper. The public issues API returned an empty list during this evaluation; no broader issue history was established.

### Candidate capabilities and gaps

#### Correct the version assumption first

The original plan says Tiptap resolves to 3.31.4. **This checkout actually resolves core, PM, React, StarterKit, and CodeBlock to 3.22.4**, confirmed in the lockfile and installed manifests. `@tiptap/markdown` is not installed in the repository.

Both Markdown package versions exist, but each requires its **exact matching core/PM peers**. Both depend on marked `^17.0.1`; Inkback directly uses marked `^15.0.0`.

Start the spike with **`@tiptap/markdown@3.22.4`**, aligned with the current editor. Evaluate 3.31.4 only as a separate, coordinated Tiptap upgrade if its changes show value. Do not combine a version upgrade with a conversion rewrite by accident.

#### What the manager genuinely provides

`MarkdownManager` supports standalone `parse(string)` → JSON and `serialize(JSONContent)` → Markdown; an `Editor` instance is unnecessary. Extensions can provide `markdownTokenName`, `markdownTokenizer`, `parseMarkdown`, and `renderMarkdown` hooks. A custom addition tokenizer parsed nested bold text and retained a review-mark ID in a typechecked 3.22.4 probe.

Ordinary node/mark support comes from registered extensions, not from the manager alone. Tables, tasks, images, and Inkback's custom marks/nodes need their corresponding support.

**Measured stock baseline:** using the correctly typed 3.22.4 module API and ordinary public extensions, **0/8 fixtures were byte-identical** after parse/serialize. This is not a full adapted-pipeline comparison: it deliberately omits source snapshots, YAML envelopes, raw-block policy, and review adapters. Some differences are merely a missing final newline; others include frontmatter interpreted as ordinary Markdown, canonicalized tables/links, escaped raw HTML, and altered review text. It shows why a stock serializer cannot replace the preservation layer.

Further exploratory 3.31.4 runtime probes and source inspection found fixed three-backtick serialization, HTML-dependent results, whitespace movement across review-mark boundaries, and HTML output for overlapping marks. These are design constraints, not proof that a fully adapted candidate would fail.

| Requirement | Needed Inkback integration |
|---|---|
| Preserve untouched bytes, spacing, escapes, CRLF | Retain source groups and document/comment snapshots; reuse original source before invoking a serializer |
| Frontmatter and rfm endmatter | Keep YAML envelopes outside ordinary Markdown parsing; reuse rfm update/hydration behavior |
| Comments, replies, IDs, authors, resolution/custom metadata | Reuse rfm grammar/model; implement review token/mark adapters and per-document state |
| Paired substitutions | Group sibling/range content by change ID; independent old/new mark wrappers are insufficient |
| Reviewed fenced code | Custom code parser and serializer; preserve literal whitespace, review boundaries, and sufficiently long fences |
| Unsupported/raw content | Retain opaque raw nodes with exact source; intercept unsafe/unsupported HTML before schema parsing |
| Local links/images, titles, autolinks, remote-image policy | Preserve original source URLs separately from resolved display URLs and port policy checks |
| Security | Retain safe rendering/clipboard/paste boundaries; validate URL attributes in any direct-JSON path |

**Code is a particularly important gap.** Stock CodeBlock parses its body into one literal text node; custom inline tokenizers do not automatically run inside it. Inkback already permits `commentRef criticChange` marks in code (`editor-extensions.ts:732–734`), but schema permission alone does not parse review syntax. Generic mark serialization moves surrounding whitespace outside delimiters; reviewed-code tests require that whitespace to remain inside the changed range. The current reviewed-code writer also chooses a fence longer than embedded backtick runs (`writer.ts:269–310`).

**Substitutions are not two independent Markdown marks.** One `{~~old~>new~~}` must join both sides and emit shared metadata/comments once, including partially edited ranges. The candidate's generic mark-wrapper mechanism does not supply ordinary sibling context for that job; use content-level grouping/custom serialization.

#### “Without HTML” needs a precise boundary

The plausible target is **no generated-HTML intermediary for supported Markdown/editor conversions**, not “no HTML anywhere.”

- Embedded HTML defaults to DOM-backed `generateJSON` when a DOM is available. Without it, recognized HTML becomes literal text. A probe of `<em>x</em>` produced italic Markdown with jsdom but escaped HTML without a DOM.
- A custom block-HTML handler can preserve an HTML comment as an opaque node. Inline HTML has a dedicated parsing branch, so block hooks alone do not establish DOM-independent handling.
- Serialization may emit HTML to reopen overlapping marks. A bold/italic overlap produced an `<em>` segment.
- Inkback still needs rendered HTML for rich clipboard export (`DocumentWorkspace.tsx:118–171`), Markdown insertion (`EditorContextMenu.tsx:632`, `editor-assets.ts:24`), and the editor DOM itself.

Do not delete DOMPurify or assume direct JSON makes URLs/raw HTML safe. Preserve the current raw-block behavior; separately verify any inline-HTML handling and clipboard/paste rendering. Passing no-op preservation tests alone cannot establish safety.

#### Parser-instance isolation is a real integration task

The supported constructor type is `marked?: typeof marked`, the callable module API—not a `new Marked()` object. In 3.22.4, tokenizer registration mutates that module's configuration.

**Measured:** after configuring a custom review tokenizer, another manager sharing the module but lacking the corresponding parse handler lost the review delimiters. Use one immutable extension configuration and controlled parser/module isolation; do not create differently configured managers against shared mutable defaults. A callable isolated adapter would be additional integration work, not an assumed library feature. A runtime experiment with `new Marked()` working in 3.31.4 does not establish type-supported usage.

### Spike design and decision gates

**Proposed two-day experiment:**

1. **Establish the baseline and version boundary.** Reproduce the eight no-op/unrelated-edit cases and existing review/security tests. Use aligned 3.22.4 first. Avoid changing the test DOM or editor version concurrently.
2. **Prototype only the conversion adapter.** Keep the existing return shape (`doc`, comments, frontmatter, endmatter, line ending) and the source-reuse save decision. Use standalone manager APIs rather than forcing editor storage into persistence code.
3. **Use shared review grammar.** Reuse `scanReview`, metadata/reference hydration, ID allocation, and existing comment/endmatter models. Implement custom reviewed-code parsing and sibling-aware substitution serialization. Keep document-scoped review state and parser isolation explicit.
4. **Exercise the hard paths early.** Edit reviewed code and table cells; update an anchored comment/reply; accept/reject a substitution; preserve raw blocks; retain YAML extras and reference definitions; test local/remote URL policies. Do not spend the whole spike polishing ordinary headings.
5. **Measure the actual change.** Compare adapted outputs and review semantics, parse/serialize timings, total conversion code retained/removed/new, reachable dependencies, web build size, and MCP HTML raw/gzip size. Code moved into extension hooks still counts as code—not a deletion.
6. **Stop with a go/no-go result.** If hooks require more integration machinery than they remove, keep the current pipeline and simplify specific rule hotspots instead. A bespoke adapter using the existing marked/rfm stack is another option, but needs its own demonstrated simplicity—not an automatic fallback rewrite.

Run at least:

```sh
pnpm check
pnpm --filter @inkback/app exec vitest run \
  test/rich-text-round-trip.test.ts test/markdown-security.test.ts \
  test/critic-markup.test.ts test/critic-markup-code.test.ts \
  test/page-card.test.tsx test/workspace-status.test.tsx
pnpm test:smoke
```

The eight-fixture probe should compare exact bytes, then change one unrelated paragraph and check the original source again. Keep that measurement separate from schema/editability and review-semantics assertions.

**Proceed only if:**

- All eight baseline fixtures remain byte-identical for no-op and unrelated edits; unsupported blocks are not dropped or executed.
- Current comments/replies/suggestions, code whitespace, IDs/metadata, YAML envelopes, and reference behavior stay correct after real edits.
- Existing browser and sanitization guarantees pass, with focused direct-JSON URL/raw-content checks where that new path creates a boundary.
- Parser configurations cannot silently contaminate one another.
- No measured bundle-size regression is accepted without explaining its cause and benefit.
- Total custom conversion code is meaningfully smaller, not merely relocated.

A **two-day spike** is reasonable. A production migration is not established as a two-day job; **roughly 1–2 engineering weeks** is a provisional planning allowance if the spike passes, subject to the review/code/HTML results. If adopted, replace parsing and serialization in separately verifiable commits, then delete superseded implementation/dependencies that are genuinely no longer needed. Do not leave a permanent dual-pipeline compatibility layer.

## Recommended sequence

### Approved publication decision

Peter explicitly selected option 1: separate the private workspace from a
generated publishable release while preserving the existing nested installed
tree. This prioritizes clear publication ownership and limits runtime-path risk;
the nested tree and staged internal rfm dependency are accepted tradeoffs.
Bundling/flattening remains deferred and parked, not authorized.

The private root remains the single version authority; the generated manifest
inherits that version. Implementation and verification cover the npm artifact
and MCPB built from it, including external installation and release resources.
No npm publication is authorized. Desktop-host compatibility remains a separate
manual finding, not an implication of automated package/MCPB checks.
The Markdown spike/adoption track remains independent.

### Publication separation outcome

Implemented the approved mirrored release boundary. The private root retains
version authority and developer scripts; `packages/cli/build-release.mjs` cleans
and stages the publishable tree under `packages/cli/dist`, selecting runtime
dependencies from server/rfm owners and rejecting conflicting declarations.
Package smoke and MCPB staging now pack that generated tree. Installed CLI and
MCP initialization are checked against the exact root-authority version.

Changed implementation paths: `package.json`, `pnpm-lock.yaml`,
`packages/cli/package.json`, `packages/cli/build-release.mjs`,
`scripts/test-package.mjs`, `scripts/build-mcpb.mjs`,
`scripts/mcp-package-smoke.mjs`, `knip.json`, and `README.md`.

Verification on macOS passed: `pnpm check`, `pnpm test:smoke` (17 tests),
`pnpm test:package`, `pnpm build:mcpb`, and `git diff --check`. A frozen install
also passed in an isolated copy without generated output. The parent review
independently reran package smoke and the checkout CLI version command
(`node packages/server/bin/inkback.mjs --version`, reporting `0.1.0`).
The npm dry-run inventory contains 95 files, including both app entries, the
detached child, skill, and license; host test-support is excluded. The MCPB
inventory contains 1,684 files and no host test-support/loopback files; some
upstream zod tests remain in its third-party installed dependency.

Installed detached-child lifecycle/reuse/identity coverage remains the next
task (`inkback#sp3j`). Desktop-host compatibility remains unverified.
No package was published.

1. Decide whether fix 9's goal is publication ownership or also a flat installed tree. Prefer the smaller ownership cleanup first.
2. Implement and externally verify that release boundary independently of Markdown changes.
3. Run the aligned-version, two-day Markdown spike and record the measurements above.
4. Make a separate adoption decision. Preserve the current pipeline if the candidate does not clearly reduce complexity while meeting current guarantees.

The two proposals do not depend on one another. Separating them keeps packaging failures distinguishable from document-conversion regressions.

## References

### Repository evidence

- `package.json`, `packages/server/package.json`, `packages/rfm/package.json`, `knip.json`: source/runtime/publication ownership.
- `scripts/test-package.mjs`, `scripts/mcp-package-smoke.mjs`, `scripts/build-mcpb.mjs`, `mcpb/manifest.json`: installed artifact and MCPB verification.
- `packages/server/src/cli/{dependencies,paths,output,server-lifecycle}.ts`, `src/{index,child,skill,network,dev}.ts`, `src/mcp/{server,ui-resource}.ts`: executable/resource/version/identity assumptions.
- `packages/app/src/markdown.ts`, `src/critic-markup/{index,writer,model,source-blocks}.ts`, `src/editor-extensions.ts`: conversion, source preservation, review state, and schema.
- `packages/app/test/fixtures/markdown/`, `test/{rich-text-round-trip,markdown-security,critic-markup,critic-markup-code}.test.ts`: observed current behavior.
- `pnpm-lock.yaml:245–289`: resolved Tiptap versions; `LICENSE`: upstream MIT notice.

### Upstream sources

- [pnpm workspace publication](https://pnpm.io/workspaces) and [deployment](https://pnpm.io/cli/deploy).
- [Tsdown dependency handling](https://tsdown.dev/options/dependencies).
- [Tiptap Markdown overview and limitations](https://tiptap.dev/docs/editor/markdown).
- [MarkdownManager API](https://tiptap.dev/docs/editor/markdown/api/markdown-manager).
- [Custom tokenizers](https://tiptap.dev/docs/editor/markdown/advanced-usage/custom-tokenizer) and [extension integration](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension).
- Versioned manager source: [3.22.4](https://unpkg.com/@tiptap/markdown@3.22.4/src/MarkdownManager.ts), [3.31.4](https://unpkg.com/@tiptap/markdown@3.31.4/src/MarkdownManager.ts).
- Versioned package manifests: [3.22.4](https://unpkg.com/@tiptap/markdown@3.22.4/package.json), [3.31.4](https://unpkg.com/@tiptap/markdown@3.31.4/package.json).
- [3.31.4 CodeBlock implementation](https://unpkg.com/@tiptap/extension-code-block@3.31.4/src/code-block.ts).

The versioned sources take precedence over changing latest-version documentation. Scratch results are diagnostic evidence, not a tested implementation plan or a production compatibility guarantee.

### Installed release verification (sp3j, 2026-10-03)

Changed paths: `scripts/test-package.mjs` and this outcome document; no
production runtime code changed. Parent review reran package smoke, the
injected-failure path, lint, and all 119 server tests. The first full server run
had an HTTP parse error in the unrelated review-receipt retry test; that test
passed in a focused rerun and the subsequent full 119-test run passed.
Existing CLI tests cover full-dev frontend selection with a mocked proxy;
the new external-install checks exercise preview-web matching, not a real
development proxy. Cleanup now requires the confirmed owned PID to exit,
escalating to SIGKILL if necessary, as well as verifying HTTP shutdown.

On macOS (darwin, Node 24), `pnpm test:package` passed against an npm-packed, externally installed release. The harness now checks detached child survival after CLI exit, HTTP status root/PID, HTML and every referenced built JS/CSS asset, same-install reuse, foreign-install status and stop rejection on the same preferred port, installed frontend identity matching/rejection and checkout frontend matching, and owned-process stop in normal and injected-failure paths. Exact CLI/MCP versions, skill/license, and MCP UI checks remain in the installed harness. `pnpm typecheck`, `pnpm lint`, and `pnpm test:smoke` passed (17 Chromium smoke tests). `pnpm build:mcpb` passed manifest validation and MCP smoke; archive inspection confirmed `manifest.json`, `LICENSE`, installed license, both HTML assets, `packages/server/bin/inkback.mjs`, and `packages/server/dist/child.js` inside the MCPB (5.9 MB, 1,684 files). A reversible `INKBACK_TEST_INJECT_FAILURE=after-start pnpm test:package` run failed intentionally and left no child from that run. Checkout foreign-frontend rejection and full-dev proxy/status matching were not exercised (rejecting a foreign frontend through `open` would start another checkout server). No desktop-host manual launch, non-macOS runtime check, or marketplace publication was performed; desktop host transport compatibility remains unverified.
