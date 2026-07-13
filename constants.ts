export const THINK_PROVIDERS = [
  "openai-codex",
  "claude-bridge",
  "xai-auth",
] as const;

export type ThinkProvider = (typeof THINK_PROVIDERS)[number];

export const THINK_AGENT_PROVIDER: ThinkProvider = "claude-bridge";
export const THINK_AGENT_MODEL = "claude-opus-4-8";
export const THINK_TOOL_DEFAULT_MODEL =
  `${THINK_AGENT_PROVIDER}/${THINK_AGENT_MODEL}`;

const THINK_MODELS: Record<ThinkProvider, string> = {
  "openai-codex": "gpt-5.6-sol",
  "claude-bridge": "claude-opus-4-8",
  "xai-auth": "grok-4.5",
};

export function thinkModelReference(provider: ThinkProvider): string {
  return `${provider}/${THINK_MODELS[provider]}`;
}

export function thinkProviderFamily(provider: string | undefined): ThinkProvider | undefined {
  const normalized = provider?.toLowerCase() ?? "";
  if (normalized.includes("openai") || normalized.includes("codex")) {
    return "openai-codex";
  }
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "claude-bridge";
  }
  if (normalized.includes("xai") || normalized.includes("grok")) {
    return "xai-auth";
  }
  return undefined;
}

export function getThinkProviderOrder(callerProvider?: string): ThinkProvider[] {
  const callerFamily = thinkProviderFamily(callerProvider);
  if (callerFamily === "openai-codex") {
    return ["claude-bridge", "xai-auth", "openai-codex"];
  }
  if (callerFamily === "claude-bridge") {
    return ["openai-codex", "xai-auth", "claude-bridge"];
  }
  if (callerFamily === "xai-auth") {
    return ["openai-codex", "claude-bridge", "xai-auth"];
  }
  return ["claude-bridge", "xai-auth", "openai-codex"];
}

export function getThinkModelReferences(
  callerProvider: string | undefined,
  count: number,
): string[] {
  const order = getThinkProviderOrder(callerProvider);
  return Array.from(
    { length: count },
    (_, index) => thinkModelReference(order[index % order.length]!),
  );
}

export const PI_THINK_VERSION = "0.1.0";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ThinkAgentThinkingLevel = (typeof THINKING_LEVELS)[number];
