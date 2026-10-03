import { runOpen, runStart, runStatus } from "./cli/commands.js";
import { createCliDependencies } from "./cli/dependencies.js";
import { runDoctor, runMarkdownDoctor } from "./cli/doctor.js";
import {
  printCommandHelp,
  printCriticMarkupHelp,
  printHelp,
} from "./cli/help.js";
import {
  applyEnvOverrides,
  commandFlags,
  isKnownCommand,
  isPathLikeInput,
  parseGlobalArgs,
  parseOptions,
  suggestCommand,
  USAGE_ERROR,
} from "./cli/options.js";
import { readPackageVersion } from "./cli/output.js";
import { runWatch } from "./cli/server-lifecycle.js";

import { runStop } from "./cli/stop.js";
import type {
  CliDependencies,
  KnownCommand,
  ParsedCli,
  ParsedCommandOptions,
} from "./cli/types.js";
import { installSkill, skillDirectory } from "./skill.js";

export async function runCli(
  args: string[],
  overrides: Partial<CliDependencies> = {},
): Promise<number> {
  let deps = createCliDependencies(overrides);
  let parsed: ParsedCli;

  try {
    parsed = parseGlobalArgs(args);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : "Invalid usage.");
    return USAGE_ERROR;
  }

  if (parsed.global.version) {
    deps.log(readPackageVersion());
    return 0;
  }

  if (!parsed.command) {
    printHelp(deps.log);
    return 0;
  }

  if (parsed.command === "help") {
    const [topic, ...extra] = parsed.rest;
    if (extra.length > 0) {
      deps.error("Usage: inkback help [criticmarkup|command]");
      return USAGE_ERROR;
    }

    if (!topic) {
      printHelp(deps.log);
      return 0;
    }

    if (topic === "criticmarkup") {
      printCriticMarkupHelp(deps.log);
      return 0;
    }

    if (isKnownCommand(topic)) {
      printCommandHelp(topic, deps.log);
      return 0;
    }

    deps.error(`Unknown help topic: ${topic}`);
    return USAGE_ERROR;
  }

  let command = parsed.command;
  let rest = parsed.rest;

  if (!isKnownCommand(command)) {
    if (isPathLikeInput(command)) {
      rest = [command, ...rest];
      command = "open";
    } else {
      const suggestion = suggestCommand(command);
      deps.error(
        `Unknown command: ${command}.${suggestion ? ` Did you mean ${suggestion}?` : ""}`,
      );
      return USAGE_ERROR;
    }
  }

  if (parsed.global.help) {
    printCommandHelp(command as KnownCommand, deps.log);
    return 0;
  }

  if (command === "criticmarkup") {
    printCriticMarkupHelp(deps.log);
    return 0;
  }

  if (command === "skill") {
    if (rest.length === 1 && rest[0] === "path") {
      deps.log(skillDirectory);
      return 0;
    }
    if (
      rest[0] === "install" &&
      rest[1] &&
      (rest.length === 2 || (rest.length === 3 && rest[2] === "--force"))
    ) {
      deps.log(
        `Installed Inkback skill: ${installSkill(rest[1], rest[2] === "--force")}`,
      );
      return 0;
    }
    deps.error(
      "Usage: inkback skill path | inkback skill install <skill-root>/inkback [--force]",
    );
    return USAGE_ERROR;
  }

  let options: ParsedCommandOptions;
  try {
    options = parseOptions(
      rest,
      commandFlags[command as keyof typeof commandFlags],
    );
  } catch (error) {
    deps.error(error instanceof Error ? error.message : "Invalid usage.");
    return USAGE_ERROR;
  }
  if (options.help) {
    printCommandHelp(command as KnownCommand, deps.log);
    return 0;
  }
  deps = applyEnvOverrides(deps, options);
  const json = parsed.global.json || options.json;

  if (command === "start") return runStart(deps, options, json);

  if (command === "status") return runStatus(deps, options, json);

  if (command === "stop") {
    if (options.positionals.length) {
      deps.error("Usage: inkback stop [--all]");
      return USAGE_ERROR;
    }
    return runStop(deps, options.all, json);
  }

  if (command === "watch") {
    if (options.positionals.length !== 1) {
      deps.error("Usage: inkback watch <path> [--json]");
      return USAGE_ERROR;
    }

    return runWatch(deps, options.positionals[0] ?? "", options, json);
  }

  if (command === "mcp") {
    const { startMcpServer } = await import("./mcp/stdio.js");
    await startMcpServer({
      env: deps.env,
      fetchImpl: deps.fetchImpl,
      directories: options.positionals,
      noRoots: options.noRoots,
    });
    return 0;
  }

  if (command === "doctor") {
    if (options.positionals.length > 1) {
      deps.error("Usage: inkback doctor [path] [--json]");
      return USAGE_ERROR;
    }

    if (options.positionals.length === 1) {
      return runMarkdownDoctor(deps, options.positionals[0] ?? "", json);
    }

    return runDoctor(deps, json);
  }

  if (command === "open") return runOpen(deps, options, json);

  return USAGE_ERROR;
}
