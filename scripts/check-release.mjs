import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_SETUP_PROMPT,
  FORK_INSTALL_COMMAND,
} from "../packages/server/setup.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const archive = `roughdraft-${manifest.version}.tgz`;
assert.ok(
  readme.includes(`The current release is \`${manifest.version}\``),
  "README release must match package.json",
);
assert.ok(
  readme.includes(FORK_INSTALL_COMMAND),
  "README install command must match CLI setup",
);
assert.ok(
  AGENT_SETUP_PROMPT.includes(FORK_INSTALL_COMMAND),
  "Agent setup must use the built fork archive",
);
assert.ok(readme.includes(archive), "README must link the current archive");
const releasePins = [
  ...readme.matchAll(
    /releases\/download\/v([^/\s]+)\/roughdraft-([^\s`]+)\.tgz/g,
  ),
];
for (const match of releasePins)
  assert.ok(
    match[1] === manifest.version && match[2] === manifest.version,
    "README contains a stale release pin",
  );
console.log(`Release metadata agrees: ${manifest.version}`);
