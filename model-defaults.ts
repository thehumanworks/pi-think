import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THINK_TOOL_DEFAULT_MODEL } from "./constants";

interface PiSettingsDefaults {
  defaultProvider?: unknown;
  defaultModel?: unknown;
}

function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi", "agent");
}

function readPiSettingsDefaults(): PiSettingsDefaults | undefined {
  try {
    return JSON.parse(readFileSync(join(piAgentDir(), "settings.json"), "utf8")) as PiSettingsDefaults;
  } catch {
    return undefined;
  }
}

export function getThinkDefaultModelReference(): string {
  const settings = readPiSettingsDefaults();
  const provider = typeof settings?.defaultProvider === "string" ? settings.defaultProvider.trim() : "";
  const model = typeof settings?.defaultModel === "string" ? settings.defaultModel.trim() : "";
  return provider && model ? `${provider}/${model}` : THINK_TOOL_DEFAULT_MODEL;
}
