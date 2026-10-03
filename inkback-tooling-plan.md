# Inkback tooling: implementation plan

This plan covers the items that are not in `inkback-tooling-fixes.patch`.

- **Base commit:** `0c476d9`.
- **Where I checked:** a Linux sandbox with Node 22 and no browsers.
- **Labels:**
  - **Measured** means that I ran the step and saw the result.
  - **Untested** means that I did not run it.

## Recommended order

| Order | Item | Effort | Status |
|---|---|---|---|
| 0 | Apply and verify the patch | 15 min | Patch measured; browser tests not run |
| 1 | Pin one pnpm version | 15 min | Finding measured; fix untested |
| 2 | Update the CI workflow | 30 min | Untested |
| 3 | Make lint warnings fail the build | 1–2 h | Counts measured |
| 4 | Turn on import sorting | 15 min | Counts measured |
| 5 | Fix the stale AGENTS.md reference | 5 min | Finding measured |
| 6 | Replace the rfm alias with a source export condition | 1–2 h | Untested |
| 7 | Upgrade to Vitest 5 | 30 min | Untested |
| 8 | Try a faster test DOM | 1 h | Cost measured; fix untested |
| 9 | Simplify the published package layout | Half a day | Untested |
| 10 | Spike: Markdown round trip without HTML | 2–3 days | Untested |

---

## Implementation results

- Applied the supplied patch without discarding the existing working-tree edits.
- Items 1–7 implemented: pnpm 12.8.1 is pinned, CI actions use Node 24
  (`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `action-setup@v6`),
  the runner is Ubuntu 24.04, lint warnings fail, imports are organized,
  stale host-verification links are removed, rfm uses a custom source condition,
  and Vitest/coverage are upgraded to 5.0.3.
- The condition is named `inkback-source`, not `source`: the generic name
  selected third-party EventSource source exports and broke typechecking and
  Node execution. The namespaced condition avoids that collision.
- Item 8 measured on Node 24.13.1/macOS with four app workers: jsdom passed
  259 tests in 5.88 s; happy-dom took 3.80 s but failed 19 tests in seven
  files, including Markdown preservation and sanitization. Kept jsdom and
  removed the trial dependency.
- Verified after deleting package build output: typechecking, unit tests, and
  both dev modes work without `dist`; Vite serves rfm source directly.
- Final verification passed: `pnpm check`, `pnpm test:coverage`,
  `pnpm test:smoke` (17 tests), `pnpm test:package`, and the checkout CLI
  version command. Frozen installation leaves the lockfile byte-identical;
  esbuild postinstall ran with only `allowBuilds` configured.
- Import sorting is included with the tooling changes rather than a separate
  formatting-only commit; no blame-ignore entry was added. Optional CI splitting/caching was skipped.
  GitHub CI and desktop-host compatibility still require external verification.
- Items 9 and 10 were explicitly excluded.

---

## 0. Apply and verify the patch

The patch has three commits. Each commit is separate, so you can drop one.

1. Apply the patch on `main`:
   ```sh
   git checkout -b tooling-fixes 0c476d9
   git am inkback-tooling-fixes.patch
   ```
   `git am` keeps the commits, with "Claude" as the author. To make your own commits, use `git apply` instead.
2. Delete the old build output, so it cannot hide failures:
   ```sh
   git clean -xfd -e node_modules
   pnpm install --frozen-lockfile
   ```
3. Run the checks:
   ```sh
   pnpm check
   pnpm exec playwright install chromium
   pnpm test:smoke
   pnpm test:package
   ```
4. Push the branch and make sure that CI is green.

This is what I verified for each commit:

| Commit | Verified | Not verified |
|---|---|---|
| 1. Clean-checkout tests and dev | All 38 test files pass with no `dist`. `pnpm dev` starts from a clean state. | Node 24 |
| 2. Type-check tests | `pnpm check` passes from a clean state. rfm and server build output is byte-identical. | Node 24 |
| 3. TypeScript 7 and Vite 8 | `pnpm check` passes from a clean state (123 s became 75 s). | Playwright smoke tests, `test:package`, Node 24 |

If commit 3 breaks the browser tests, drop only that commit:
```sh
git rebase -i 0c476d9   # change "pick" to "drop" on the commit for TypeScript 7 and Vite 8
```

**Two warnings about the patch:**
- **Lockfile tool.** I changed the lockfile with pnpm 12.8.1, because only that version reproduced the existing lockfile with no extra changes (see item 1).
- **Biome extension fix.** I added `.js` extensions to the test imports with Biome's `useImportExtensions` fix. The same fix also broke three source files: `dev.ts`, `network.ts`, and `mcp/server.ts`. It wrote `../defaults.mjs.js`, for example. I reverted those three files. Do not turn this rule on for the whole repo. The new `typecheck` step already catches missing extensions.

---

## 1. Pin one pnpm version

**Problem (measured):** the repo names three different pnpm versions.
- The README says "pnpm 10", and CI pins pnpm 10.11.0.
- The lockfile comes from pnpm 12. Only pnpm 12.8.1 rewrites it with no extra changes.
- pnpm 10.11.0 re-resolves peer dependencies. In one case, it changed the `zod` peer of `@modelcontextprotocol/ext-apps` in the app from 4.3.6 to 3.25.76.
- CI passes today only because `--frozen-lockfile` does not re-resolve.

**Steps:**
1. Choose a version. I recommend pnpm 12.8.1, because it matches the lockfile. If you must stay on pnpm 10, regenerate the lockfile and examine the peer changes, especially `zod`.
2. Add the field to the root `package.json`:
   ```json
   "packageManager": "pnpm@12.8.1"
   ```
3. In `.github/workflows/ci.yml`, remove `with: version: 10.11.0` from `pnpm/action-setup`. The action then reads `packageManager`. If you keep two version sources, they can conflict.
4. Change the README from "pnpm 10" to the version that you chose.
5. `pnpm-workspace.yaml` has both `allowBuilds` and `onlyBuiltDependencies`/`ignoredBuiltDependencies` for the same packages. Find out which key your pinned version reads, and remove the other key.
   - To check: remove one key, run `pnpm install`, and make sure that the esbuild postinstall still runs.
   - In pnpm 10 and later, you can also run `pnpm ignored-builds`.
6. Optional: run `corepack enable`, so that each local `pnpm` command uses the pinned version.

**Done when:** CI and local installs use the same pnpm version, and `pnpm install` makes no changes to the lockfile.

---

## 2. Update the CI workflow

**Problem (measured, from the annotations on CI run #5):**
- Four actions target the Node 20 runtime, which GitHub deprecated: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, and `pnpm/action-setup@v4`.
- `ubuntu-latest` moves to Ubuntu 26 from October 19, 2026.

**Steps:**
1. On the release page of each of the four actions, find the newest major version that targets Node 24. Update each `uses:` line.
2. Choose the runner behavior:
   - To control when the change happens, pin `runs-on: ubuntu-24.04`. Move to Ubuntu 26 in a separate change.
   - Or keep `ubuntu-latest`, and look at the first run after October 19. `playwright install --with-deps` installs system packages, so a new OS can break it.
3. Optional (untested): split the job into parallel jobs, `check` and `browser`, for faster feedback. Also cache `~/.cache/ms-playwright`, with a key on the Playwright version. A green run takes about 2.5 minutes now, so this gain is small. Do this step last.

**Done when:** the annotations about Node 20 and the runner label are gone.

---

## 3. Make lint warnings fail the build

**Problem (measured):** `pnpm lint` reports 22 `noNonNullAssertion` warnings and 2 `useTemplate` infos, and it still exits with code 0.

This is where the warnings are:

| File | Warnings |
|---|---|
| `packages/app/src/critic-markup/index.ts` | 10 |
| `packages/app/src/critic-markup/writer.ts` | 2 |
| `packages/app/test/rich-text-round-trip.test.ts` | 4 (plus 2 infos) |
| `packages/app/test/critic-markup.test.ts` | 3 |
| `packages/server/src/local-api-security.test.ts` | 2 |
| `packages/app/test/page-card.test.tsx` | 1 |

12 of the 22 warnings are in source files. If you turn the rule off only for tests, 12 warnings stay.

**Steps:**
1. In the two source files, replace each `!` with a real check: an early return, or a thrown error with a clear message. These are parser files, so a false assumption there can cause a silent wrong result.
2. Choose a rule for the tests:
   - Fix the 10 test warnings.
   - Or turn the rule off for test files with an override in `biome.json`:
     ```json
     "overrides": [
       {
         "includes": ["**/*.test.ts", "**/*.test.tsx", "**/e2e/**"],
         "linter": { "rules": { "style": { "noNonNullAssertion": "off" } } }
       }
     ]
     ```
3. When the count is zero, add `--error-on-warnings` to the `lint` script. New warnings then fail CI.

**Done when:** `pnpm lint` reports no warnings, and a new warning fails CI.

---

## 4. Turn on import sorting

**Problem (measured):** the `lint` scripts pass `--assist-enabled=false`, which turns off Biome's import organizer. With it on, 33 files fail. For example, `packages/rfm/src/index.ts` has an import at line 904.

You may have turned this off on purpose to avoid churn. Skip this item if that reason still applies.

**Steps:**
1. Remove `--assist-enabled=false` from the `lint` and `lint:fix` scripts.
2. Run `pnpm exec biome check --write .` once.
3. Put this change in a separate commit, with no other changes.
4. Add that commit's hash to a `.git-blame-ignore-revs` file, so `git blame` skips it.

**Done when:** `pnpm lint` passes with assist on.

---

## 5. Fix the stale AGENTS.md reference

**Problem (measured):** AGENTS.md tells agents to record host checks in an untracked implementation plan. That file is not in the repo, so agents in a fresh clone or in CI cannot find it.

**Steps:** do one of these:
- Commit the file.
- Change the line so it points to where the record is kept now.
- Remove the line.

Do not add the new `typecheck` or clean-checkout steps to AGENTS.md. Agents can find the commands in `package.json`, and CI now enforces them.

---

## 6. Replace the rfm alias with a source export condition (untested)

**Why:** after the patch, three methods find `@inkback/rfm`:
- an alias in each Vitest config;
- a prebuild in `dev`, `dev:web`, and `typecheck`;
- `dist` at build time.

During `pnpm dev`, a change to rfm source has no effect until you build rfm again. One custom export condition can replace the aliases and prebuilds.

**Steps:**
1. In `packages/rfm/package.json`, add a `source` condition before the others:
   ```json
   "exports": {
     ".": {
       "source": "./src/index.ts",
       "types": "./dist/index.d.ts",
       "import": "./dist/index.js"
     }
   }
   ```
2. Turn on the condition in each tool:
   - **TypeScript:** add `"customConditions": ["source"]` to the full `tsconfig.json` of the app and the server. Set `"customConditions": []` in `packages/server/tsconfig.build.json`. Otherwise rfm source enters the server build and breaks `rootDir`.
   - **Vite and Vitest:** add `source` to `resolve.conditions` in the app configs. Also add it to the server-side resolve conditions for the server Vitest config. In Vite 6 and later, a value that you set replaces the default list, so include the defaults too. Check the current Vite documentation for the exact setting names.
   - **tsx:** change the server `dev` script to `tsx watch --conditions=source src/dev.ts`.
3. Remove the two Vitest aliases and the three `pnpm --filter @inkback/rfm build &&` prefixes.
4. Verify:
   - Delete all `dist` folders, then run `pnpm check`, `pnpm dev`, and `pnpm test:package`.
   - Make sure that the published package does not use the `source` condition. Node ignores conditions that it does not know, but `src/` is not in `files`, so a consumer that sets `source` would fail.

**Done when:** no tool needs `rfm/dist` except the build, and changes to rfm source appear in `pnpm dev` with no rebuild.

---

## 7. Upgrade to Vitest 5 (untested)

Vitest 5.0.3 is out. Its peer range includes Vite 8.

1. Do this only after the patch is merged and CI is green.
2. Change `vitest` and `@vitest/coverage-v8` to `^5` in every package.
3. Read the Vitest 5 migration guide. Look for changes to `environment`, coverage options, and `resolve.alias`.
4. Run `pnpm check` and `pnpm test:coverage`.

---

## 8. Try a faster test DOM (cost measured, fix untested)

**Problem (measured):** jsdom setup takes about 19 s of the 45 s app test run.

**Steps:**
1. Add `happy-dom` as a dev dependency of the app.
2. Run the app tests with the new environment, and record the time and the failures:
   ```sh
   pnpm --filter @inkback/app exec vitest run --environment happy-dom
   ```
3. Decide with this rule:
   - Change only if all tests pass, or if each failure is a test problem and not a missing DOM feature.
   - Change only if the run is at least about 30% faster.
4. ProseMirror uses selection and layout APIs. If happy-dom does not support them well, keep jsdom. You can also try Vitest browser mode for the editor tests only.

---

## 9. Simplify the published package layout (untested)

**Problem (measured):** the root package is both the workspace root and the published package. Because of this:
- it repeats the server dependencies;
- it uses `file:packages/rfm`, while the other packages use `workspace:*`;
- `knip.json` needs eight ignore entries.

**Steps:**
1. Make a published package folder, for example `packages/cli`.
2. Bundle the server and rfm into one `dist` with a bundler such as tsdown. Keep `express`, the MCP SDK, `yaml`, and `zod` as external runtime dependencies.
3. Move `bin`, `files`, and the runtime dependencies to that package. Make the root private.
4. Remove the root runtime dependencies and the Knip ignore entries that you no longer need.
5. Verify with `pnpm test:package` and `pnpm build:mcpb`. The `test:package` script installs the package outside the workspace, so it is a good safety net here.

Keep the upstream copyright and license notice in the new package. The root `package.json` lists "Nathan Baschez" as `author`. Decide whether to add yourself and keep him as the upstream author.

**Done when:** the root package has no runtime dependencies, Knip needs no workspace ignore entries, and `test:package` passes.

---

## 10. Spike: Markdown round trip without HTML (untested)

**Current path:** Markdown → marked → HTML → TipTap → HTML → Turndown → Markdown.
- The code has many custom Turndown rules.
- It also has a step that hides unsupported blocks as encoded raw `div` elements.
- The two most recent commit messages describe round-trip and data-preservation fixes, so this cost may recur.

**Option:** `@tiptap/markdown` (version 3.31.4, the same as the current TipTap). As I understand it, it converts marked tokens directly to TipTap content and back, with no HTML step. I did not test it with CriticMarkup or the rfm endmatter.

**Steps:**
1. **Decide whether to spike.** Count the commits and issues from the last two months that fix round-trip bugs. If the count is low, stop here.
2. **Timebox: 2 days, on a branch.**
   - Load the existing fixtures in `packages/app/test/fixtures/markdown/` through `@tiptap/markdown`.
   - Use custom tokenizers for CriticMarkup.
   - Run `rich-text-round-trip.test.ts` and `markdown-security.test.ts` against the new path.
3. **Measure:**
   - the number of fixtures that round-trip byte for byte, before and after;
   - the lines of conversion code that you can delete;
   - the bundle size of the web build and the MCP app build.
4. **Proceed only if** all security tests pass, no fixture gets worse, and the custom conversion code becomes clearly smaller.
5. **If you proceed:** change one direction at a time (parse first, then serialize), behind the existing fixtures.

**Done when:** you have the measurements and a decision.
