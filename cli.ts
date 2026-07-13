#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PI_THINK_VERSION,
  THINKING_LEVELS,
  THINK_TOOL_DEFAULT_MODEL,
  type ThinkAgentThinkingLevel,
} from "./constants";

const VALID_THINKING = new Set<string>(THINKING_LEVELS);

export interface ThinkCliParams {
  prompt: string;
  model?: string;
  thinking?: ThinkAgentThinkingLevel;
  agents?: number;
  panel?: string;
  agentConfig?: string;
}

export interface ThinkCliOptions extends ThinkCliParams {
  json?: boolean;
}

export interface ThinkCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export type ThinkCliExecute = (
  params: ThinkCliParams,
  options: {
    cwd?: string;
    modelRegistry?: unknown;
    callerProvider?: string;
  },
) => Promise<{
  content: Array<{ type: string; text?: string }>;
  details: { error?: string };
}>;

interface ThinkCliRuntime {
  execute: ThinkCliExecute;
  modelRegistry?: unknown;
}

interface PiRuntimeServices {
  agentDir?: string;
  modelRegistry?: unknown;
  resourceLoader?: {
    getExtensions?: () => {
      extensions?: Array<{ path?: string }>;
    };
  };
}

function usage(): string {
  return `pi-think — run the pi think tool from the command line

Usage:
  pi-think [options] <prompt>
  echo "prompt" | pi-think [options]

Options:
  -p, --prompt <text>       Prompt to send to the critic(s)
  -m, --model <provider/id> Explicit model override (default: smart cross-provider routing; fallback: ${THINK_TOOL_DEFAULT_MODEL})
  -t, --thinking <level>    off|minimal|low|medium|high|xhigh
  -a, --agents <count>      Panel size, clamped by the underlying think tool
      --panel <name|path>    Load .agents/think/<name>.json or an explicit JSON file
      --agent-config <json|path>
                             Inline JSON config or path to { agents: [...] }
      --json                Print the full tool result as JSON
  -h, --help                Show this help
      --version             Show package version
`;
}

function readVersion(): string {
  try {
    const packageJson = require("./package.json") as { version?: string };
    return packageJson.version ?? PI_THINK_VERSION;
  } catch {
    return PI_THINK_VERSION;
  }
}

function expandTildePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return homedir() + path.slice(1);
  return path;
}

function packageExists(dir: string): boolean {
  return existsSync(join(expandTildePath(dir), "package.json"));
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function packageNameFromNpmSource(source: string): string | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice("npm:".length).trim();
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@.+)?$/);
  return match?.[1];
}

function packageNameFromNodeModulesPath(path: string): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  const parts = path.slice(markerIndex + marker.length).split(/[\\/]/);
  const first = parts[0];
  if (!first) return undefined;
  if (first.startsWith("@")) {
    const second = parts[1];
    return second ? `${first}/${second}` : undefined;
  }
  return first;
}

function configuredNpmPackageNames(agentDir: string): string[] {
  const settings = readJsonFile<{
    packages?: Array<string | { source?: string }>;
  }>(join(agentDir, "settings.json"));
  const names = new Set<string>();

  for (const entry of settings?.packages ?? []) {
    const source = typeof entry === "string" ? entry : entry.source;
    if (!source) continue;
    const name = packageNameFromNpmSource(source);
    if (name) names.add(name);
  }

  return [...names];
}

function configuredPackageRootsFromBase(
  baseDir: string,
  loadedNames: Set<string>,
): string[] {
  const roots: string[] = [];
  for (const name of configuredNpmPackageNames(baseDir)) {
    if (loadedNames.has(name)) continue;
    const root = join(baseDir, "npm", "node_modules", name);
    if (packageExists(root)) roots.push(root);
  }
  return roots;
}

function loadedPackageNames(services: PiRuntimeServices): Set<string> {
  const names = new Set<string>();
  for (const extension of services.resourceLoader?.getExtensions?.().extensions ?? []) {
    if (!extension.path) continue;
    const name = packageNameFromNodeModulesPath(extension.path);
    if (name) names.add(name);
  }
  return names;
}

export function configuredFallbackPackageRoots(
  agentDir: string,
  loadedNames = new Set<string>(),
  cwd?: string,
): string[] {
  const roots = configuredPackageRootsFromBase(agentDir, loadedNames);
  if (cwd) {
    roots.push(
      ...configuredPackageRootsFromBase(join(cwd, ".pi"), loadedNames),
    );
  }
  return [...new Set(roots)];
}

function providerFromModelReference(
  modelReference: string | undefined,
  defaultModelReference: string,
): string | undefined {
  const reference = (modelReference ?? defaultModelReference).trim();
  const slashIndex = reference.indexOf("/");
  if (slashIndex === -1) return defaultModelReference.split("/")[0];
  const provider = reference.slice(0, slashIndex).trim();
  return provider || undefined;
}

function registryHasProvider(
  modelRegistry: unknown,
  provider: string | undefined,
): boolean {
  if (!provider) return true;
  const getAll = (modelRegistry as { getAll?: () => Array<{ provider?: string }> } | undefined)
    ?.getAll;
  if (typeof getAll !== "function") return false;
  const normalizedProvider = provider.toLowerCase();
  return getAll.call(modelRegistry).some(
    (model) => model.provider?.toLowerCase() === normalizedProvider,
  );
}

function findPiSdkPackageDir(startDir: string): string | undefined {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidate = join(
      dir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    if (packageExists(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return undefined;
}

function currentSourceDir(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return undefined;
  }
}

export function configurePiSdkPackageDir(cwd: string): void {
  const configuredPackageDir = process.env.PI_PACKAGE_DIR;
  if (configuredPackageDir && packageExists(configuredPackageDir)) {
    return;
  }

  const homeExtensionDir = join(
    homedir(),
    ".pi",
    "agent",
    "extensions",
    "pi-think",
  );
  const searchRoots = [
    cwd,
    process.cwd(),
    currentSourceDir(),
    homeExtensionDir,
  ].filter((dir): dir is string => !!dir);

  for (const root of searchRoots) {
    const candidate = findPiSdkPackageDir(root);
    if (candidate) {
      process.env.PI_PACKAGE_DIR = candidate;
      return;
    }
  }
}

async function defaultThinkCliRuntime(
  cwd: string,
  params: ThinkCliParams,
): Promise<ThinkCliRuntime> {
  configurePiSdkPackageDir(cwd);
  const [{ executeThinkAgent, getThinkDefaultModelReference }, piSdk] = await Promise.all([
    import("./index"),
    import("@earendil-works/pi-coding-agent"),
  ]);
  let services = (await piSdk.createAgentSessionServices({ cwd })) as PiRuntimeServices;
  const provider = providerFromModelReference(
    params.model,
    getThinkDefaultModelReference(),
  );

  if (
    params.panel !== undefined ||
    params.agentConfig !== undefined ||
    !registryHasProvider(services.modelRegistry, provider)
  ) {
    const fallbackRoots = configuredFallbackPackageRoots(
      services.agentDir ?? join(homedir(), ".pi", "agent"),
      loadedPackageNames(services),
      cwd,
    );
    if (fallbackRoots.length > 0) {
      services = (await piSdk.createAgentSessionServices({
        cwd,
        resourceLoaderOptions: {
          additionalExtensionPaths: fallbackRoots,
        },
      })) as PiRuntimeServices;
    }
  }

  return {
    execute: executeThinkAgent as ThinkCliExecute,
    modelRegistry: services.modelRegistry,
  };
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
      options.thinking = value as ThinkAgentThinkingLevel;
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

    if (arg === "--panel") {
      const value = readValue(arg);
      if (value === undefined) return { kind: "error", message: `${arg} requires a value` };
      options.panel = value;
      continue;
    }

    if (arg === "--agent-config") {
      const value = readValue(arg);
      if (value === undefined) return { kind: "error", message: `${arg} requires a value` };
      options.agentConfig = value;
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
  const params: ThinkCliParams = { ...rest, prompt };
  const cwd = deps.cwd ?? process.cwd();
  const runtime = deps.execute
    ? { execute: deps.execute }
    : await defaultThinkCliRuntime(cwd, params);
  const result = await runtime.execute(params, {
    cwd,
    modelRegistry: runtime.modelRegistry,
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
