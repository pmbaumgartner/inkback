import path from "node:path";
import { createServer } from "./index.js";
import { INKBACK_DEFAULT_PORT } from "./network.js";

interface ParsedArgs {
  port: number;
  projectDir?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let port = INKBACK_DEFAULT_PORT;
  let projectDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--port") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --port");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid port: ${value}`);
      }
      port = parsed;
      index += 1;
      continue;
    }

    if (current === "--project-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --project-dir");
      }
      projectDir = path.resolve(value);
      index += 1;
    }
  }

  return { port, projectDir };
}

try {
  const { port, projectDir } = parseArgs(process.argv.slice(2));
  await createServer(port, projectDir);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to start Inkback.",
  );
  process.exit(1);
}
