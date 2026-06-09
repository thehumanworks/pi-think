export const THINK_AGENT_PROVIDER = "xai-auth";
export const THINK_AGENT_MODEL = "grok-composer-2.5-fast";
export const THINK_TOOL_DEFAULT_MODEL = `${THINK_AGENT_PROVIDER}/${THINK_AGENT_MODEL}`;
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
