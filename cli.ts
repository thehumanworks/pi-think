#!/usr/bin/env bun
import { executeThinkAgent, THINK_TOOL_DEFAULT_MODEL, type ThinkParams } from "./index";

const VALID_THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

export interface ThinkCliOptions extends ThinkParams {
  json?: boolean;
}

export interface ThinkCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export type ThinkCliExecute = typeof executeThinkAgent;

function usage(): string {
  return `pi-think — run the pi think tool from the command line

Usage:
  pi-think [options] <prompt>
  echo "prompt" | pi-think [options]

Options:
  -p, --prompt <text>       Prompt to send to the critic(s)
  -m, --model <provider/id> Model for the sub-agent(s) (default: ${THINK_TOOL_DEFAULT_MODEL})
  -t, --thinking <level>    off|minimal|low|medium|high|xhigh
  -a, --agents <count>      Panel size, clamped by the underlying think tool
      --json                Print the full tool result as JSON
  -h, --help                Show this help
      --version             Show package version
`;
}

function readVersion(): string {
  try {
    const packageJson = require("./package.json") as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function readStdinIfAvailable(stdin: Pick<typeof Bun.stdin, "text">): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  return (await stdin.text()).trim();
}

export function parseThinkCliArgs(argv: string[]):
  | { kind: "run"; options: Partial<ThinkCliOptions>; promptParts: string[] }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string } {
  const options: Partial<ThinkCliOptions> = {};
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      promptParts.push(...argv.slice(i + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      return { kind: "help" };
    }

    if (arg === "--version") {
      return { kind: "version" };
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const readValue = (flag: string): string | undefined => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        return undefined;
      }
      i += 1;
      return value;
    };

    if (arg === "-p" || arg === "--prompt") {
      const value = readValue(arg);
      if (value === undefined) return { kind: "error", message: `${arg} requires a value` };
      options.prompt = value;
      continue;
    }

    if (arg === "-m" || arg === "--model") {
      const value = readValue(arg);
      if (value === undefined) return { kind: "error", message: `${arg} requires a value` };
      options.model = value;
      continue;
    }

    if (arg === "-t" || arg === "--thinking") {
      const value = readValue(arg);
      if (value === undefined) return { kind: "error", message: `${arg} requires a value` };
      if (!VALID_THINKING.has(value)) {
        return { kind: "error", message: `invalid thinking level: ${value}` };
      }
      options.thinking = value as ThinkParams["thinking"];
      continue;
    }

    if (arg === "-a" || arg === "--agents") {
      const value = readValue(arg);
      if (value === undefined) return { kind: "error", message: `${arg} requires a value` };
      const agents = Number(value);
      if (!Number.isFinite(agents)) {
        return { kind: "error", message: `invalid agents count: ${value}` };
      }
      options.agents = agents;
      continue;
    }

    if (arg.startsWith("-")) {
      return { kind: "error", message: `unknown option: ${arg}` };
    }

    promptParts.push(arg);
  }

  return { kind: "run", options, promptParts };
}

export async function runThinkCli(
  argv = process.argv.slice(2),
  deps: {
    execute?: ThinkCliExecute;
    stdin?: Pick<typeof Bun.stdin, "text">;
    cwd?: string;
  } = {},
): Promise<ThinkCliResult> {
  const parsed = parseThinkCliArgs(argv);

  if (parsed.kind === "help") {
    return { exitCode: 0, stdout: usage() };
  }

  if (parsed.kind === "version") {
    return { exitCode: 0, stdout: `${readVersion()}\n` };
  }

  if (parsed.kind === "error") {
    return { exitCode: 2, stderr: `${parsed.message}\n\n${usage()}` };
  }

  const stdinPrompt = await readStdinIfAvailable(deps.stdin ?? Bun.stdin);
  const argPrompt = parsed.options.prompt ?? parsed.promptParts.join(" ").trim();
  const prompt = argPrompt || stdinPrompt;

  if (!prompt) {
    return { exitCode: 2, stderr: `missing prompt\n\n${usage()}` };
  }

  const { json, ...rest } = parsed.options;
  const params: ThinkParams = { ...rest, prompt };
  const result = await (deps.execute ?? executeThinkAgent)(params, {
    cwd: deps.cwd ?? process.cwd(),
  });

  if (json) {
    return { exitCode: result.details.error ? 1 : 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
  }

  const first = result.content[0];
  const text = first && "text" in first ? first.text : "";
  return { exitCode: result.details.error ? 1 : 0, stdout: `${text}\n` };
}

if (import.meta.main) {
  const result = await runThinkCli();
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
