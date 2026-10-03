import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const destination = path.join(root, "packages/cli/dist");
const read = (relative) =>
  JSON.parse(readFileSync(path.join(root, relative), "utf8"));
const workspace = read("package.json");
const server = read("packages/server/package.json");
const rfm = read("packages/rfm/package.json");
const dependencies = {};
for (const owner of [server, rfm]) {
  for (const [name, version] of Object.entries(owner.dependencies ?? {})) {
    if (name === "@inkback/rfm") continue;
    if (dependencies[name] && dependencies[name] !== version)
      throw new Error(
        `Conflicting runtime dependency ${name}: ${dependencies[name]} vs ${version}`,
      );
    dependencies[name] = version;
  }
}
// Do not leave a partial or stale release behind when an input is missing.
rmSync(destination, { recursive: true, force: true });
for (const input of [
  "packages/server/bin",
  "packages/server/dist",
  "packages/server/defaults.mjs",
  "packages/server/defaults.d.mts",
  "packages/rfm/dist",
  "packages/rfm/package.json",
  "packages/app/dist",
  "packages/app/dist-mcp-app",
  "packages/skill/inkback",
  "LICENSE",
  "README.md",
]) {
  const target = path.join(destination, input);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(root, input), target, { recursive: true });
}
writeFileSync(
  path.join(destination, "package.json"),
  `${JSON.stringify(
    {
      name: workspace.name,
      version: workspace.version,
      description: workspace.description,
      license: workspace.license,
      author: workspace.author,
      engines: workspace.engines,
      bin: { inkback: "./packages/server/bin/inkback.mjs" },
      dependencies: { ...dependencies, "@inkback/rfm": "file:packages/rfm" },
    },
    null,
    2,
  )}\n`,
);
