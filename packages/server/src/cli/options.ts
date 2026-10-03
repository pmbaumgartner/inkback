import type {
  CliDependencies,
  KnownCommand,
  OptionFlag,
  ParsedCli,
  ParsedCommandOptions,
  ParsedGlobalFlags,
} from "./types.js";

export const USAGE_ERROR = 2;

export const KNOWN_COMMANDS = [
  "open",
  "start",
  "status",
  "stop",
  "watch",
  "mcp",
  "doctor",
  "help",
  "skill",
  "criticmarkup",
] as const;

export function parseGlobalArgs(args: string[]): ParsedCli {
  const global: ParsedGlobalFlags = {
    help: false,
    json: false,
    noColor: false,
    version: false,
  };
  const rest = [...args];
  const commandParts: string[] = [];

  while (rest.length > 0) {
    const arg = rest.shift();
    if (!arg) break;

    if (arg === "--") {
      commandParts.push(...rest);
      break;
    }

    if (arg === "-h" || arg === "--help") {
      global.help = true;
      continue;
    }

    if (arg === "--version") {
      global.version = true;
      continue;
    }

    if (arg === "--json") {
      global.json = true;
      continue;
    }

    if (arg === "--no-color") {
      global.noColor = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    commandParts.push(arg, ...rest);
    break;
  }

  const [command, ...commandRest] = commandParts;
  return {
    command: command ?? null,
    global,
    rest: commandRest,
  };
}

function takeFlagValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }

  return { value, nextIndex: index + 1 };
}

export const commandFlags: Record<
  "open" | "start" | "status" | "stop" | "watch" | "mcp" | "doctor",
  readonly OptionFlag[]
> = {
  open: [
    "no-open",
    "review-id",
    "print-url",
    "watch",
    "no-watch",
    "replay",
    "timeout",
    "batch-window",
    "port",
    "state-file",
    "state-dir",
  ],
  start: ["port", "state-file", "state-dir"],
  status: ["state-file", "state-dir"],
  stop: ["all", "state-file", "state-dir"],
  watch: ["replay", "timeout", "batch-window", "state-file", "state-dir"],
  mcp: ["state-file", "state-dir", "no-roots"],
  doctor: ["state-file", "state-dir"],
};

export function parseOptions(
  args: string[],
  allowed: readonly OptionFlag[],
): ParsedCommandOptions {
  const parsed: ParsedCommandOptions = {
    all: false,
    batchWindowSeconds: 0.25,
    help: false,
    json: false,
    noOpen: false,
    noWatch: false,
    positionals: [],
    printUrl: false,
    replay: false,
    watch: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      parsed.positionals.push(...args.slice(index + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    const equals = arg.indexOf("=");
    const name = arg.startsWith("--")
      ? arg.slice(2, equals < 0 ? undefined : equals)
      : "";
    const inline = equals < 0 ? undefined : arg.slice(equals + 1);
    if (
      !allowed.includes(name as OptionFlag) ||
      (inline !== undefined &&
        ![
          "timeout",
          "batch-window",
          "port",
          "state-file",
          "state-dir",
        ].includes(name))
    ) {
      if (arg.startsWith("-")) {
        throw new Error(
          `Unknown flag: ${inline === undefined ? arg : `--${name}`}`,
        );
      }
      parsed.positionals.push(arg);
      continue;
    }
    if (name === "all") parsed.all = true;
    else if (name === "no-open") parsed.noOpen = true;
    else if (name === "print-url") {
      parsed.printUrl = true;
      parsed.noOpen = true;
    } else if (name === "watch") parsed.watch = true;
    else if (name === "no-watch") parsed.noWatch = true;
    else if (name === "no-roots") parsed.noRoots = true;
    else if (name === "replay") parsed.replay = true;
    else if (name === "review-id") {
      const value = args[++index];
      if (!value || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) {
        throw new Error("--review-id requires a review session ID");
      }
      parsed.reviewId = value;
    } else {
      const flag = `--${name}`;
      const value = inline ?? takeFlagValue(args, index, flag).value;
      if (inline === undefined) index += 1;
      if (name === "timeout")
        parsed.timeoutSeconds = parsePositiveNumber(value, flag);
      else if (name === "batch-window")
        parsed.batchWindowSeconds = parsePositiveNumber(value, flag);
      else if (name === "port") parsed.port = value;
      else if (name === "state-file") parsed.stateFile = value;
      else if (name === "state-dir") parsed.stateDir = value;
    }
  }
  return parsed;
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

export function applyEnvOverrides(
  deps: CliDependencies,
  options: ParsedCommandOptions,
): CliDependencies {
  return {
    ...deps,
    env: {
      ...deps.env,
      ...(options.port ? { INKBACK_PORT: options.port } : {}),
      ...(options.stateDir ? { INKBACK_STATE_DIR: options.stateDir } : {}),
      ...(options.stateFile ? { INKBACK_STATE_FILE: options.stateFile } : {}),
    },
  };
}

export function isKnownCommand(value: string): value is KnownCommand {
  return (KNOWN_COMMANDS as readonly string[]).includes(value);
}

export function isPathLikeInput(value: string): boolean {
  return (
    value.toLowerCase().endsWith(".md") ||
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
    current[0] = aIndex;
    for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
      current[bIndex] = Math.min(
        previous[bIndex] + 1,
        current[bIndex - 1] + 1,
        previous[bIndex - 1] + (a[aIndex - 1] === b[bIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] ?? 0;
}

export function suggestCommand(command: string): string | null {
  const suggestion = KNOWN_COMMANDS.map((candidate) => ({
    candidate,
    distance: levenshteinDistance(command, candidate),
  })).sort((left, right) => left.distance - right.distance)[0];

  return suggestion && suggestion.distance <= 3 ? suggestion.candidate : null;
}
