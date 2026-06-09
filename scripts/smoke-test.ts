/**
 * Smoke test: tool registration, model resolution, optional params → init options.
 * Set PI_THINK_LIVE=1 to also run one real ThinkAgent call (needs xai-auth).
 */
import thinkExtension, {
  executeThinkAgent,
  getThinkDefaultModelReference,
  resolveThinkModel,
  THINK_TOOL_DEFAULT_MODEL,
} from "../index.ts";
import { THINK_AGENT_MODEL, THINK_AGENT_PROVIDER } from "../lib/agent.ts";
import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";

let registeredTool: {
  name: string;
  parameters: { properties: Record<string, unknown> };
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: (u: unknown) => void,
    ctx: { cwd: string; modelRegistry?: unknown },
  ) => Promise<unknown>;
} | undefined;

thinkExtension({
  registerTool(tool) {
    registeredTool = tool as typeof registeredTool;
  },
  on() {},
});

if (!registeredTool) {
  console.error("FAIL: think tool not registered");
  process.exit(1);
}

const paramKeys = Object.keys(registeredTool.parameters.properties).sort();
if (paramKeys.join(",") !== "agentConfig,agents,model,panel,prompt,thinking") {
  console.error("FAIL: unexpected param keys", paramKeys);
  process.exit(1);
}

function stubThinkModelRegistry(): ModelRegistry {
  const defaultReference = getThinkDefaultModelReference();
  const [defaultProvider, defaultModel] = defaultReference.split("/", 2);
  const stubs = [
    {
      provider: THINK_AGENT_PROVIDER,
      id: THINK_AGENT_MODEL,
      name: "Grok Composer 2.5 Fast",
      api: "openai-completions",
    },
    {
      provider: defaultProvider || THINK_AGENT_PROVIDER,
      id: defaultModel || THINK_AGENT_MODEL,
      name: defaultModel || THINK_AGENT_MODEL,
      api: "openai-completions",
    },
  ];

  return {
    find(provider: string, modelId: string) {
      return stubs.find((stub) => stub.provider === provider && stub.id === modelId);
    },
    getAll() {
      return stubs;
    },
  } as unknown as ModelRegistry;
}

const agentDir = getAgentDir();
const authStorage = AuthStorage.create(`${agentDir}/auth.json`);
const registryFromDisk = ModelRegistry.create(authStorage);
const modelRegistry =
  registryFromDisk.find(THINK_AGENT_PROVIDER, THINK_AGENT_MODEL) !== undefined
    ? registryFromDisk
    : stubThinkModelRegistry();

const defaultReference = getThinkDefaultModelReference();
const [defaultProvider, defaultModel] = defaultReference.split("/", 2);
const resolved = resolveThinkModel(defaultReference, modelRegistry);
if (
  !resolved ||
  resolved.provider !== defaultProvider ||
  resolved.id !== defaultModel
) {
  console.error("FAIL: resolveThinkModel default", resolved);
  process.exit(1);
}

const initSnapshots: unknown[] = [];
const mocked = await executeThinkAgent(
  {
    prompt:
      'Reply with JSON only: {"bottom_line":"smoke ok","confidence":"high","confidence_rationale":"test","reasoning":[],"risks":[],"alternatives_considered":[],"unknowns":[],"recommended_next_steps":[]}',
  },
  {
    cwd: process.cwd(),
    modelRegistry,
    createAgent: async (opts) => {
      initSnapshots.push({
        thinkingLevel: opts.thinkingLevel,
        modelId: opts.model?.id,
        provider: opts.model?.provider,
      });
      return {
        async run() {
          return {
            text: '{"bottom_line":"smoke ok"}',
            model: defaultReference,
            thinkingLevel: "off",
          };
        },
        dispose() {},
      };
    },
  },
);

const snap = initSnapshots[0] as {
  thinkingLevel?: string;
  modelId?: string;
  provider?: string;
};
if (
  snap?.thinkingLevel !== "off" ||
  snap?.provider !== defaultProvider ||
  snap?.modelId !== defaultModel
) {
  console.error("FAIL: init options (expected thinkingLevel off)", snap);
  process.exit(1);
}

const details = (mocked as unknown as { details: Record<string, unknown> })
  .details;
if (
  details.model !== defaultReference ||
  details.thinkingLevel !== undefined ||
  details.agents !== 1 ||
  !Array.isArray(details.panel) ||
  details.panel.length !== 1
) {
  console.error("FAIL: details", details);
  process.exit(1);
}

console.log("smoke: tool params OK, defaults OK, mocked execute OK");

// Panel orchestration with a stubbed agent factory: 3 distinct lenses run in
// parallel, each given its own system prompt, and all outputs are aggregated.
const panelSystemPrompts: string[] = [];
const panelResult = await executeThinkAgent(
  { prompt: "should we shard the database?", agents: 3 },
  {
    cwd: process.cwd(),
    modelRegistry,
    createAgent: async (opts) => {
      panelSystemPrompts.push(opts.systemPrompt ?? "");
      const seat = panelSystemPrompts.length;
      return {
        async run() {
          return {
            text: `{"lens":"seat ${seat}","bottom_line":"ok"}`,
            model: defaultReference,
            thinkingLevel: "off",
          };
        },
        dispose() {},
      };
    },
  },
);

const panelDetails = (
  panelResult as unknown as { details: Record<string, unknown> }
).details;
const panelText =
  (panelResult as unknown as { content: { text: string }[] }).content[0]
    ?.text ?? "";
const distinctPrompts = new Set(panelSystemPrompts);
if (
  panelSystemPrompts.length !== 3 ||
  distinctPrompts.size !== 3 ||
  panelDetails.agents !== 3 ||
  !Array.isArray(panelDetails.panel) ||
  panelDetails.panel.length !== 3 ||
  !panelText.includes("Think panel — 3 of 3 expert critics") ||
  !panelText.includes("Correctness & Logic")
) {
  console.error("FAIL: panel orchestration", {
    prompts: panelSystemPrompts.length,
    distinct: distinctPrompts.size,
    details: panelDetails,
  });
  process.exit(1);
}

console.log("smoke: panel orchestration OK (3 distinct lenses, aggregated)");

const structuredPrompts: string[] = [];
const structuredResult = await executeThinkAgent(
  {
    prompt: "structured?",
    agentConfig: {
      agents: [
        { name: "Friendly", appendSystemPrompt: "Be friendly.", effort: "low" },
        { name: "Strict", systemPrompt: "You are strict.", effort: "medium" },
      ],
    },
  },
  {
    cwd: process.cwd(),
    modelRegistry,
    createAgent: async (opts) => {
      structuredPrompts.push(opts.systemPrompt ?? "");
      const seat = structuredPrompts.length;
      return {
        async run() {
          return {
            text: `structured-${seat}`,
            model: defaultReference,
            thinkingLevel: opts.thinkingLevel ?? "off",
          };
        },
        dispose() {},
      };
    },
  },
);
const structuredDetails = (
  structuredResult as unknown as { details: Record<string, unknown> }
).details;
const structuredText =
  (structuredResult as unknown as { content: { text: string }[] }).content[0]
    ?.text ?? "";
if (
  structuredDetails.agents !== 2 ||
  structuredDetails.thinkingLevel !== "mixed" ||
  !structuredText.includes("1 · Friendly") ||
  !structuredText.includes("2 · Strict") ||
  !structuredPrompts[0]?.includes("Be friendly.") ||
  structuredPrompts[1] !== "You are strict."
) {
  console.error("FAIL: structured panel config", {
    structuredDetails,
    structuredText,
    structuredPrompts,
  });
  process.exit(1);
}

console.log("smoke: structured agent config OK (aliases, prompts, effort)");

if (process.env.PI_THINK_LIVE === "1") {
  const liveRegistry =
    registryFromDisk.find(THINK_AGENT_PROVIDER, THINK_AGENT_MODEL) !== undefined
      ? registryFromDisk
      : undefined;
  if (!liveRegistry) {
    console.error(
      "live SKIP: xai-auth/grok-composer-2.5-fast not in ModelRegistry (configure models/auth)",
    );
    process.exit(0);
  }
  console.log("live: running a real 2-critic panel (may take 30–120s)...");
  const live = await executeThinkAgent(
    {
      prompt:
        "Decision: I plan to store user session tokens in localStorage in a single-page web app so they survive refreshes. Is this the right call? What am I missing?",
      model: THINK_TOOL_DEFAULT_MODEL,
      agents: 2,
    },
    { cwd: process.cwd(), modelRegistry: liveRegistry },
  );
  const liveDetails = (
    live as unknown as {
      details: { error?: string; agents?: number; panel?: unknown[] };
    }
  ).details;
  if (liveDetails.error) {
    console.error("live FAIL:", liveDetails.error);
    process.exit(1);
  }
  const text =
    (live as unknown as { content: { text: string }[] }).content[0]?.text ?? "";
  const panelCount = Array.isArray(liveDetails.panel)
    ? liveDetails.panel.length
    : 0;
  if (
    liveDetails.agents !== 2 ||
    panelCount !== 2 ||
    !text.includes("Think panel")
  ) {
    console.error("live FAIL: panel shape", {
      agents: liveDetails.agents,
      panelCount,
      head: text.slice(0, 120),
    });
    process.exit(1);
  }
  console.log(
    `live OK: 2-critic panel returned ${panelCount} critiques, ${text.length} bytes`,
  );
} else {
  console.log("(skip live; set PI_THINK_LIVE=1 to hit real API)");
}
