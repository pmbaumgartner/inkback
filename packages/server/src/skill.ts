import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const skillDirectory = fileURLToPath(
  new URL("../../skill/inkback/", import.meta.url),
);

export function installSkill(destination: string, force = false): string {
  const target = path.resolve(destination);
  if (path.basename(target) !== "inkback")
    throw new Error("Choose a skill directory ending in /inkback.");
  if (fs.existsSync(target) && !force)
    throw new Error(
      "Skill directory already exists. Use --force to update it.",
    );
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
    throw new Error("Choose a skill directory, not a symlink.");
  fs.cpSync(skillDirectory, target, { recursive: true, force });
  return target;
}
