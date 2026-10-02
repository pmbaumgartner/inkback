import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPathPolicy } from "./path-policy";
let directory: string;
let inside: string;
let outside: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-policy-"));
  inside = path.join(directory, "inside");
  outside = path.join(directory, "outside");
  fs.mkdirSync(inside);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(inside, "draft.md"), "# Draft");
  fs.writeFileSync(path.join(outside, "draft.md"), "# Other");
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
it("checks real paths for files and future assets", () => {
  const policy = createPathPolicy({
    directories: [inside],
    env: {},
    log: () => {},
  });
  fs.symlinkSync(
    path.join(outside, "draft.md"),
    path.join(inside, "escape.md"),
  );
  fs.symlinkSync(path.join(inside, "draft.md"), path.join(outside, "entry.md"));
  expect(policy.isWritable(path.join(inside, "draft.md"))).toBe(true);
  expect(policy.isWritable(path.join(inside, "new.png"))).toBe(true);
  expect(policy.isWritable(path.join(outside, "draft.md"))).toBe(false);
  expect(policy.isWritable(path.join(inside, "escape.md"))).toBe(false);
  expect(policy.isWritable(path.join(outside, "entry.md"))).toBe(true);
});
it("uses the working directory until roots arrive, combining explicit sources", () => {
  const policy = createPathPolicy({ cwd: inside, env: {}, log: () => {} });
  expect(policy.describe()).toEqual([
    { path: fs.realpathSync(inside), source: "working-directory" },
  ]);
  policy.setRoots([outside]);
  expect(policy.isWritable(path.join(inside, "draft.md"))).toBe(false);
  expect(policy.isWritable(path.join(outside, "draft.md"))).toBe(true);
  policy.setRoots([]);
  expect(policy.isWritable(path.join(inside, "draft.md"))).toBe(true);
  const explicit = createPathPolicy({
    directories: [inside],
    env: { INKBACK_ALLOWED_DIRS: outside },
    log: () => {},
  });
  expect(explicit.describe().map((entry) => entry.source)).toEqual([
    "argument",
    "environment",
  ]);
});
it("refuses a filesystem root default and skips missing directories", () => {
  const policy = createPathPolicy({
    cwd: path.parse(directory).root,
    directories: [path.join(directory, "missing")],
    env: {},
    log: () => {},
  });
  expect(policy.isWritable(path.join(inside, "draft.md"))).toBe(false);
  expect(policy.notWritableReason(path.join(inside, "draft.md"))).toMatch(
    /Add a folder/,
  );
});
it("bounds image reads by real document and allowed directories", () => {
  const policy = createPathPolicy({
    directories: [inside],
    env: {},
    log: () => {},
  });
  fs.writeFileSync(path.join(inside, "image.png"), "image");
  fs.writeFileSync(path.join(outside, "image.png"), "image");
  fs.symlinkSync(
    path.join(outside, "image.png"),
    path.join(inside, "escape.png"),
  );
  const document = path.join(inside, "draft.md");
  expect(policy.canReadAsset(document, path.join(inside, "image.png"))).toBe(
    true,
  );
  expect(policy.canReadAsset(document, path.join(inside, "escape.png"))).toBe(
    false,
  );
  expect(policy.canReadAsset(document, document)).toBe(false);
});
