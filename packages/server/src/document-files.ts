import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export const MAX_OVERALL_COMMENT_LENGTH = 4_000;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}

function fileVersionFromContent(
  stats: fs.Stats,
  content: string | Buffer,
): string {
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");
  return `${stats.mtimeMs}:${stats.size}:${contentHash}`;
}

export function fileVersionFromFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  return fileVersionFromContent(stats, content);
}

export function normalizeOverallComment(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function markdownPageFromFile(
  relativePath: string,
  absolutePath: string,
): {
  id: string;
  title: string;
  content: string;
  version: string;
} {
  const content = fs.readFileSync(absolutePath, "utf-8");
  const stats = fs.statSync(absolutePath);
  const fallbackTitle = path.basename(relativePath, ".md");

  return {
    id: pageIdFromRelativePath(relativePath),
    title: titleFromContent(content, fallbackTitle),
    content,
    version: fileVersionFromContent(stats, content),
  };
}

function pageIdFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "").split(path.sep).join("/");
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function nextAssetPath(projectDir: string, filename: string): string {
  const assetsDir = path.join(projectDir, ".inkback-assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const safeName = sanitizeFilename(filename);
  const extensionIndex = safeName.lastIndexOf(".");
  const basename =
    extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : "";

  let counter = 0;
  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const relativePath = `.inkback-assets/${basename}${suffix}${extension}`;
    const absolutePath = path.join(projectDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return relativePath;
    }
    counter += 1;
  }
}

export function readDocument(absPath: string) {
  if (
    !path.isAbsolute(absPath) ||
    path.extname(absPath).toLowerCase() !== ".md"
  )
    throw new Error("An absolute .md path is required.");
  if (!fs.statSync(absPath).isFile())
    throw new Error("Markdown file not found.");
  if (fs.statSync(absPath).size > MAX_DOCUMENT_BYTES)
    throw new Error("Document exceeds the 2 MiB limit.");
  const page = markdownPageFromFile(path.basename(absPath), absPath);
  if (Buffer.byteLength(page.content) > MAX_DOCUMENT_BYTES)
    throw new Error("Document exceeds the 2 MiB limit.");
  return page;
}
export function writeDocument(
  absPath: string,
  content: string,
  expectedVersion?: string,
  relativePath = path.basename(absPath),
  limit = MAX_DOCUMENT_BYTES,
) {
  if (Buffer.byteLength(content) > limit)
    throw new Error("Document exceeds the 2 MiB limit.");
  const current = markdownPageFromFile(relativePath, absPath);
  if (expectedVersion && current.version !== expectedVersion)
    return { status: "conflict" as const, current };
  // Synchronous operations cannot interleave in this process. Separate processes can still race between the version check and write.
  fs.writeFileSync(absPath, content);
  return {
    status: "saved" as const,
    page: markdownPageFromFile(relativePath, absPath),
  };
}
export function updateDocument(
  absPath: string,
  transform: (content: string) => string,
  expectedVersion?: string,
  limit = MAX_DOCUMENT_BYTES,
) {
  const current =
    limit === Infinity
      ? markdownPageFromFile(path.basename(absPath), absPath)
      : readDocument(absPath);
  return writeDocument(
    absPath,
    transform(current.content),
    expectedVersion ?? current.version,
    path.basename(absPath),
    limit,
  );
}
export function readAsset(absPath: string) {
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  const mimeType = types[path.extname(absPath).toLowerCase()];
  if (!mimeType) throw new Error("Only image assets are supported.");
  if (fs.statSync(absPath).size > MAX_ASSET_BYTES)
    throw new Error("Asset exceeds the 5 MiB limit.");
  const data = fs.readFileSync(absPath);
  if (data.length > MAX_ASSET_BYTES)
    throw new Error("Asset exceeds the 5 MiB limit.");
  return { mimeType, dataBase64: data.toString("base64"), bytes: data.length };
}
export function writeAsset(
  documentDir: string,
  filename: string,
  dataBase64: string,
) {
  const data = Buffer.from(dataBase64, "base64");
  if (data.length > MAX_ASSET_BYTES)
    throw new Error("Asset exceeds the 5 MiB limit.");
  const markdownPath = nextAssetPath(documentDir, filename);
  fs.writeFileSync(path.join(documentDir, markdownPath), data);
  return { markdownPath };
}
