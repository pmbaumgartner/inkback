import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  readDocument,
  updateDocument,
  writeDocument,
} from "./document-files.js";

let directory: string;
let document: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "inkback-docs-"));
  document = path.join(directory, "draft.md");
  fs.writeFileSync(document, "# Draft\n");
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
it("versions content and preserves a newer file on stale writes", () => {
  const first = readDocument(document);
  const saved = updateDocument(
    document,
    (content) => `${content}\nNew text`,
    first.version,
  );
  expect(saved.status).toBe("saved");
  const current = readDocument(document);
  expect(current.version).not.toBe(first.version);
  expect(writeDocument(document, "Stale text", first.version)).toEqual({
    status: "conflict",
    current,
  });
  expect(readDocument(document).content).toBe("# Draft\n\nNew text");
});
it("bounds document reads and writes", () => {
  expect(() =>
    writeDocument(document, "x".repeat(MAX_DOCUMENT_BYTES + 1)),
  ).toThrow(/2 MiB/);
  fs.writeFileSync(document, "x".repeat(MAX_DOCUMENT_BYTES + 1));
  expect(() => readDocument(document)).toThrow(/2 MiB/);
});
