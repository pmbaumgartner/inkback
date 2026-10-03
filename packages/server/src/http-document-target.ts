import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
export function ensureProjectPath(
  projectDir: string,
  relativePath: string,
): string | null {
  const normalized = relativePath.replace(/^\.?\//, "");
  const absolute = path.resolve(projectDir, normalized);
  const relative = path.relative(projectDir, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolute;
}

export function pageFilePathFromId(
  projectDir: string,
  id: string,
): string | null {
  return ensureProjectPath(projectDir, `${id}.md`);
}

export function isExistingDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function requestedProjectPath(req: Request): string | null {
  const queryPath =
    typeof req.query.projectPath === "string"
      ? req.query.projectPath.trim()
      : "";
  const bodyPath =
    typeof req.body?.projectPath === "string"
      ? req.body.projectPath.trim()
      : "";
  const nextPath = queryPath || bodyPath;
  return nextPath.length > 0 ? nextPath : null;
}

export function projectDirFromRequest(
  req: Request,
  res: Response,
  options?: { mustExist?: boolean },
): string | null {
  const nextProjectPath = requestedProjectPath(req);
  if (!nextProjectPath) {
    res.status(400).json({ error: "projectPath is required" });
    return null;
  }

  const resolvedProjectDir = path.resolve(nextProjectPath);
  const mustExist = options?.mustExist ?? true;

  if (mustExist && !isExistingDirectory(resolvedProjectDir)) {
    res.status(404).json({ error: "Project directory not found" });
    return null;
  }

  return resolvedProjectDir;
}

export function markdownPathFromRequest(
  req: Request,
  res: Response,
  options?: { queryPathOnly?: boolean },
): { relativePath: string; absolutePath: string; projectDir: string } | null {
  const projectDir = projectDirFromRequest(req, res);
  if (!projectDir) return null;

  const relativePath =
    typeof req.query.path === "string"
      ? req.query.path
      : !options?.queryPathOnly && typeof req.body?.path === "string"
        ? req.body.path
        : "";
  const absolutePath = ensureProjectPath(projectDir, relativePath);

  if (!absolutePath?.toLowerCase().endsWith(".md")) {
    res.status(404).json({ error: "Markdown file not found" });
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    res.status(404).json({ error: "Markdown file not found" });
    return null;
  }

  return { relativePath, absolutePath, projectDir };
}
