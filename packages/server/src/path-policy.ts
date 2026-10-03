import fs from "node:fs";
import path from "node:path";

export interface PolicyOptions {
  directories?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  log?: (message: string) => void;
}
type Source = "argument" | "environment" | "root" | "working-directory";
function isInside(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
export function createPathPolicy(options: PolicyOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const log =
    options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const arguments_ = options.directories ?? [];
  const environment =
    (options.env ?? process.env).INKBACK_ALLOWED_DIRS?.split(
      path.delimiter,
    ).filter(Boolean) ?? [];
  let roots: string[] = [];
  let entries: Array<{ path: string; source: Source }> = [];
  function load(dirs: string[], source: Source) {
    return dirs.flatMap((dir) => {
      try {
        const real = fs.realpathSync(path.resolve(dir));
        if (!fs.statSync(real).isDirectory())
          throw new Error("not a directory");
        return [{ path: real, source }];
      } catch {
        log(`Inkback: skipping unavailable allowed directory: ${dir}`);
        return [];
      }
    });
  }
  function refresh() {
    entries = [
      ...load(arguments_, "argument"),
      ...load(environment, "environment"),
      ...load(roots, "root"),
    ];
    if (!entries.length) {
      const defaults = load([cwd], "working-directory");
      entries = defaults.filter(
        (entry) => path.parse(entry.path).root !== entry.path,
      );
    }
    log(
      `Inkback writable directories: ${entries.map((entry) => `${entry.path} (${entry.source})`).join(", ") || "none"}`,
    );
  }
  function realTarget(target: string): string {
    try {
      return fs.realpathSync(target);
    } catch {
      // A dangling symlink is not a new path in its parent directory.
      try {
        if (fs.lstatSync(target).isSymbolicLink())
          throw new Error("Dangling symlink");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const parent = path.dirname(target);
      if (parent === target) throw new Error("Unavailable filesystem root");
      return path.join(realTarget(parent), path.basename(target));
    }
  }

  function isWritable(target: string): boolean {
    try {
      return entries.some((entry) => isInside(entry.path, realTarget(target)));
    } catch {
      return false;
    }
  }
  refresh();
  return {
    isWritable,
    notWritableReason(target: string): string | null {
      if (isWritable(target)) return null;
      if (!entries.length)
        return `Inkback cannot write files. The working directory is ${cwd}, and the client sent no usable roots. Add a folder as an argument to inkback mcp.`;
      if (entries.every((entry) => entry.source === "working-directory"))
        return `Inkback cannot write ${target}. Inkback can write only in ${entries[0].path} (the working directory). Start inkback mcp in the folder that contains the file, or add the folder as an argument.`;
      return `Inkback cannot write ${target}. It is outside the allowed directories. Add ${path.dirname(target)} to Allowed Directories in the Inkback extension settings, or pass it to inkback mcp, then open the file again.`;
    },
    canReadAsset(documentPath: string, assetPath: string): boolean {
      if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(assetPath)) return false;
      try {
        const asset = fs.realpathSync(assetPath);
        return (
          isInside(path.dirname(fs.realpathSync(documentPath)), asset) ||
          entries.some((entry) => isInside(entry.path, asset))
        );
      } catch {
        return false;
      }
    },
    setRoots(dirs: string[]) {
      roots = dirs;
      refresh();
    },
    describe() {
      return entries.map((entry) => ({ ...entry }));
    },
  };
}
export type PathPolicy = ReturnType<typeof createPathPolicy>;
