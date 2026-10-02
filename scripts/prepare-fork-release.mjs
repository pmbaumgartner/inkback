import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = new URL("../package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+-pmbaumgartner\.\d+$/.test(version ?? "")) {
  throw new Error(
    "Usage: node scripts/prepare-fork-release.mjs <major.minor.patch-pmbaumgartner.revision>",
  );
}
const previous = manifest.version;
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const readmePath = new URL("../README.md", import.meta.url);
writeFileSync(
  readmePath,
  readFileSync(readmePath, "utf8").replaceAll(previous, version),
);
console.log(
  `Prepared Roughdraft ${version}. Run pnpm check, pnpm test:smoke, and pnpm test:package before tagging.`,
);
