import { getModel, getModels, type Model } from "@earendil-works/pi-ai";
import {
  type AgentToolResult,
  type ExtensionAPI,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { THINK_TOOL_DEFAULT_MODEL } from "./constants";
import {
  assignThinkLenses,
  buildThinkSystemPrompt,
  MAX_THINK_AGENTS,
  ThinkAgent,
  THINK_AGENT_MODEL,
  THINK_AGENT_PROVIDER,
  type ThinkAgentInitOptions,
  type ThinkAgentRunResult,
  type ThinkLens,
} from "./lib/agent";
export { THINK_TOOL_DEFAULT_MODEL } from "./constants";

const ThinkThinkingLevelSchema = Type.Union(
  [
    Type.Literal("off"),
    Type.Literal("minimal"),
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
    Type.Literal("xhigh"),
  ],
  {
    description:
      "Reasoning effort per critic. Match to difficulty: off/minimal=sanity check, low=simple decision, medium=default tradeoffs, high=hard/expensive-to-unwind, xhigh=hardest highest-stakes. Higher = slower + costlier.",
  },
);

const THINKING_DEEPLY_AWARENESS_PROMPT = `## Thinking Deeply

You have access to a \`think\` tool that delegates a self-contained prompt to a
panel of one or more contained reasoning sub-agents through the Pi SDK. Each
sub-agent is an **adversarial critic**: its job is to find the flaw in your
plan, not to agree with you. Use \`think\` to **gain confidence before
high-stakes decisions or high-blast-radius execution** — not as a replacement
for your own judgment, and not as a ritual.

Calling \`think\` on every action is itself a failure mode: it produces
checklist fatigue, you start skimming the output, and the safety value
collapses. Be selective.

### When to call \`think\`

Call it when the cost of being wrong is materially higher than the cost of an
extra ~10–90s of latency:

- **Design decisions with real tradeoffs** — schema, abstraction boundaries,
  library choice, API shape, concurrency model.
- **High-blast-radius execution** — destructive file ops (\`rm -rf\`, mass
  deletes), data/schema migrations, force pushes, history rewrites, deployment
  commands, dependency/lockfile changes, anything that writes to external
  systems or shared state.
- **Stuck debugging** — two or more failed attempts on the same bug, or
  symptoms that don't fit your current mental model.
- **Ambiguous requirements** — before you write code against an interpretation,
  pressure-test the interpretation.
- **Long execution arcs** — before committing to a multi-step plan that's
  expensive to unwind, get a quick critique of the plan itself.
- **Pattern-matching catches** — if you're about to act mostly because "this
  looks like X", stop and have \`think\` check whether it really is X.

**Ambiguity fallback.** If you cannot confidently classify the blast radius of
what you're about to do, or external side effects are in play, default to
calling \`think\`. Under-classifying is the dangerous direction.

### When NOT to call \`think\`

Skip it for:

- Mechanical, well-specified, low-risk work — renames, formatting, obvious
  fixes, single-file edits with clear intent, contained-scope refactors you
  can fully unwind.
- Cases where you already have direct evidence and high confidence — extra
  reasoning is just delay.
- Validation-seeking. If you only want to be told you're right, don't call.
  \`think\` is most valuable when you genuinely want it to find the flaw.
- Work that needs tools, files, the terminal, or the web — that's your job.
  \`think\` has no environment access; it sees only the prompt string.

### How to prompt it well

Because \`think\` has no access to your conversation, files, or tools, the
prompt must be:

- **Self-contained.** Goal, constraints, relevant code/data inline, what you've
  already tried, and what assumptions you're making.
- **Decision-shaped, not chat-shaped.** Prefer "Given constraints A, B, C,
  should I take approach X or Y, and what am I missing?" over "tell me about
  caching".
- **Adversarial.** State your current best answer and explicitly ask \`think\`
  to find the strongest reasons it's wrong.
- **Scoped.** One decision or one hypothesis per call. Bundling dilutes the
  reasoning.

### Two dials: effort and panel size

\`think\` exposes two independent dials. Effort is *depth* (how hard each critic
reasons); panel size is *breadth* (how many distinct expert lenses examine the
problem). Turn up depth for hard single-threaded reasoning; turn up breadth when
a decision can fail in several different ways.

**\`thinking\` — reasoning effort per critic** (\`off\` → \`xhigh\`). Match it to
difficulty; higher levels cost more latency and tokens, so do not default to the
top:

- \`off\` / \`minimal\` — near-instant sanity checks and lookups where the answer
  is essentially known and you only want a second pair of eyes.
- \`low\` — simple, well-scoped decisions with few interacting parts.
- \`medium\` — the default working level: most design tradeoffs, plan critiques,
  and debugging strategy.
- \`high\` — genuinely hard problems: subtle bugs, tangled tradeoffs, multi-step
  plans that are expensive to unwind, anything where a shallow pass would miss
  the real issue.
- \`xhigh\` — reserve for the hardest, highest-stakes calls where you want the
  deepest possible single-critic pass and the latency is clearly justified.

**\`agents\` — panel size** (1 to ${MAX_THINK_AGENTS}; default 1). One agent is a
single adversarial critic. With two or more, each panelist gets a *different*
lens (correctness, failure-modes, evidence/assumptions, alternative approaches,
framing, domain pragmatics) and they reason independently and in parallel — they
cannot see each other, so disagreement between them is signal, not noise. Panels
run concurrently, so wall-clock latency is roughly one critic's, but token cost
scales with the count.

A panel earns its cost mainly when a problem can fail in several different ways
or the inputs are long, noisy, or conflicting. For a straightforward decision, a
single critic is usually the right call — adding lenses does not manufacture
insight the model doesn't have, and a panel is only as strong as its best member.

- \`agents: 1\` — routine checks and a quick second opinion.
- \`agents: 3\` — the recommended setting for real decisions and high-blast-radius
  execution. The jump from one critic to three distinct lenses is where almost
  all of the gain is.
- \`agents: 4-6\` — reserve for the highest-stakes, multi-faceted calls
  (architecture, migrations, security-sensitive changes). Returns diminish
  sharply past three or four lenses; going higher mostly buys cost.

A useful pairing: high-stakes architectural decision → \`agents: 3-4\` at
\`thinking: high\`. Routine sanity check → \`agents: 1\` at \`thinking: low\`.

### The response shape

A single critic (\`agents: 1\`) returns one JSON object. A panel returns labeled
Markdown sections, one JSON object per expert. Either way, read every field of
every critic, not just \`bottom_line\`:

- \`lens\` — which perspective produced this critique.
- \`restated_claim\` — your proposal restated as a neutral, falsifiable
  proposition. **Check this first:** if it has drifted from what you meant, the
  critique is aimed at the wrong target and your prompt was ambiguous.
- \`steelman\` — the strongest honest case for your proposal.
- \`reasoning[]\` — load-bearing points, each tagged with
  \`basis: "evidence" | "assumption" | "inference"\`.
- \`weakest_point\` — the single most load-bearing flaw or first-failing step.
  This is the headline finding; read it before \`bottom_line\`.
- \`strongest_counterargument\` — the best reason the proposal could still be
  wrong. Read this even when confidence is high.
- \`bottom_line\` — the verdict in 1–3 sentences.
- \`confidence\` / \`confidence_rationale\` — \`"low" | "medium" | "high"\`, why
  it is defensible, and the specific evidence that would change it.
- \`risks[]\` — \`{description, severity, mitigation}\`.
- \`alternatives_considered[]\` — \`{option, why_not_chosen}\`.
- \`unknowns[]\` — \`{question, why_it_matters, how_to_resolve}\`.
- \`recommended_next_steps[]\` — concrete actions.

### How to act on the response

- **Lead with \`weakest_point\` and \`restated_claim\`.** If \`restated_claim\`
  doesn't match your intent, fix your prompt before trusting anything else. Then
  resolve the \`weakest_point\` — it is the finding most likely to change your
  decision.
- **Confidence + unknowns gate execution.** If \`confidence\` is \`"low"\`, or
  any \`unknowns\` entry is material to the decision, **resolve those unknowns
  before acting**. Usually that means reading a file, running a probe, or
  asking the user — not re-calling \`think\` with the same information.
- **Convert \`risks\` into a literal preflight.** Before any
  high-blast-radius step, walk each risk and either confirm it doesn't apply
  or apply the \`mitigation\`. Don't just acknowledge them in prose.
- **Weigh the panel, don't average it.** With multiple critics, look first at
  where they **disagree** — that is where the real uncertainty lives. A lone
  dissenting critic with a sharp \`strongest_counterargument\` can outweigh a
  comfortable majority.
- **Stress-test \`alternatives_considered\` against your own context.**
  \`think\` may have rejected an option for a reason that doesn't apply in
  your situation; if so, reopen it.
- **Audit \`reasoning\` by \`basis\`.** Points marked \`"assumption"\` are the
  cheapest things to verify and the most likely places \`think\` is wrong; if
  the recommendation hinges on one, verify it before acting.
- **Don't blindly defer.** You hold context \`think\` does not — prior turns,
  the live codebase, the user's signals. Integrate, don't outsource.
- **Disagreement means slow down, not pick a side.** If \`think\`'s
  conclusion conflicts with yours, identify the load-bearing disagreement and
  resolve it with evidence before either of you "wins".
`;

const ThinkParams = Type.Object({
  prompt: Type.String({
    description: "Prompt to send to the contained Pi SDK think agent(s).",
    minLength: 1,
  }),
  model: Type.Optional(
    Type.String({
      description: `Model for the think sub-agent(s) (provider/id). Default: ${THINK_TOOL_DEFAULT_MODEL}`,
    }),
  ),
  thinking: Type.Optional(ThinkThinkingLevelSchema),
  agents: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_THINK_AGENTS,
      description: `Panel size: number of independent adversarial critics, each given a distinct expert lens, run in parallel (default 1; max ${MAX_THINK_AGENTS}). Use 3 for real decisions or high-blast-radius execution, 4-6 for the highest-stakes multi-faceted calls. Latency ≈ one critic; token cost scales with the count.`,
    }),
  ),
});

export type ThinkParams = Static<typeof ThinkParams>;

export interface ThinkPanelEntry {
  lens: string;
  title: string;
  text?: string;
  model?: string;
  thinkingLevel?: string;
  error?: string;
}

export interface ThinkDetails {
  prompt: string;
  model?: string;
  thinkingLevel?: string;
  agents?: number;
  panel?: ThinkPanelEntry[];
  output?: string;
  error?: string;
}

export interface ThinkAgentRunner {
  run(
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<ThinkAgentRunResult>;
  dispose(): void;
}

export type CreateThinkAgent = (
  options: ThinkAgentInitOptions,
) => Promise<ThinkAgentRunner>;

function registryFind(
  modelRegistry: ModelRegistry | undefined,
  provider: string,
  modelId: string,
): Model<any> | undefined {
  if (typeof modelRegistry?.find !== "function") {
    return undefined;
  }
  return modelRegistry.find(provider, modelId);
}

function registryFindById(
  modelRegistry: ModelRegistry | undefined,
  modelId: string,
): Model<any> | undefined {
  if (typeof modelRegistry?.getAll !== "function") {
    return undefined;
  }
  return modelRegistry.getAll().find((m) => m.id === modelId);
}

function registryGetAll(
  modelRegistry: ModelRegistry | undefined,
): Model<any>[] {
  if (typeof modelRegistry?.getAll !== "function") {
    return [];
  }
  return modelRegistry.getAll();
}

/** Runtime model lookup; tool `model` is a free-form provider/id string. */
function lookupBuiltInModel(
  provider: string,
  modelId: string,
): Model<any> | undefined {
  return (
    getModel as (p: string, id: string) => Model<any> | undefined
  )(provider, modelId);
}

function lookupBuiltInProviderModels(provider: string): Model<any>[] {
  return (getModels as (p: string) => Model<any>[])(provider);
}

function findModelByReference(
  models: Model<any>[],
  provider: string,
  modelId: string,
): Model<any> | undefined {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModelId = modelId.toLowerCase();
  return models.find(
    (model) =>
      model.provider.toLowerCase() === normalizedProvider &&
      model.id.toLowerCase() === normalizedModelId,
  );
}

function buildProviderFallbackModel(
  models: Model<any>[],
  provider: string,
  modelId: string,
): Model<any> | undefined {
  const normalizedProvider = provider.toLowerCase();
  const baseModel = models.find(
    (model) => model.provider.toLowerCase() === normalizedProvider,
  );
  if (!baseModel) {
    return undefined;
  }

  return {
    ...baseModel,
    provider: baseModel.provider,
    id: modelId,
    name: modelId,
  };
}

export function resolveThinkModel(
  modelReference: string,
  modelRegistry?: ModelRegistry,
): Model<any> | undefined {
  const reference = modelReference.trim() || THINK_TOOL_DEFAULT_MODEL;
  const slashIndex = reference.indexOf("/");

  if (slashIndex !== -1) {
    const provider = reference.slice(0, slashIndex).trim();
    const modelId = reference.slice(slashIndex + 1).trim();
    if (!provider || !modelId) {
      return undefined;
    }

    const registryModels = registryGetAll(modelRegistry);
    const builtInModels = lookupBuiltInProviderModels(provider);
    return (
      registryFind(modelRegistry, provider, modelId) ??
      findModelByReference(registryModels, provider, modelId) ??
      lookupBuiltInModel(provider, modelId) ??
      findModelByReference(builtInModels, provider, modelId) ??
      buildProviderFallbackModel(registryModels, provider, modelId) ??
      buildProviderFallbackModel(builtInModels, provider, modelId)
    );
  }

  return (
    registryFindById(modelRegistry, reference) ??
    lookupBuiltInModel(THINK_AGENT_PROVIDER, reference)
  );
}

export function clampPanelSize(agents?: number): number {
  if (agents === undefined || agents === null || !Number.isFinite(agents)) {
    return 1;
  }
  return Math.min(Math.max(Math.floor(agents), 1), MAX_THINK_AGENTS);
}

export interface ExecuteThinkAgentOptions {
  cwd?: string;
  modelRegistry?: ModelRegistry;
  signal?: AbortSignal;
  createAgent?: CreateThinkAgent;
}

interface RunPanelistOptions {
  cwd?: string;
  model: Model<any>;
  modelRegistry?: ModelRegistry;
  thinkingLevel?: ThinkParams["thinking"];
  signal?: AbortSignal;
}

async function runPanelist(
  createAgent: CreateThinkAgent,
  lens: ThinkLens,
  panelSize: number,
  prompt: string,
  options: RunPanelistOptions,
): Promise<ThinkAgentRunResult> {
  if (options.signal?.aborted) {
    throw new Error("Think panel run was cancelled before it started");
  }

  let agent: ThinkAgentRunner | undefined;
  try {
    agent = await createAgent({
      cwd: options.cwd,
      model: options.model,
      modelRegistry: options.modelRegistry,
      ...(options.thinkingLevel !== undefined
        ? { thinkingLevel: options.thinkingLevel }
        : {}),
      systemPrompt: buildThinkSystemPrompt(lens, panelSize),
    });

    return await agent.run(prompt, { signal: options.signal });
  } finally {
    agent?.dispose();
  }
}

function formatPanel(
  panel: ThinkPanelEntry[],
  panelSize: number,
  thinkingLevel?: string,
): string {
  const succeeded = panel.filter((entry) => entry.text !== undefined);

  // Single critic: return its raw JSON critique unchanged.
  if (panelSize <= 1) {
    return succeeded[0]?.text ?? "";
  }

  const effort = thinkingLevel ? ` · effort: ${thinkingLevel}` : "";
  const header = `# Think panel — ${succeeded.length} of ${panelSize} expert critics${effort}

These critics analysed your prompt from different lenses, blind to one another.
Read every section; disagreement between them is signal, not noise. Integrate
against your own context rather than deferring to any single one.`;

  const sections = succeeded.map(
    (entry, index) => `## ${index + 1} · ${entry.title}\n\n${entry.text}`,
  );

  const failed = panel.filter((entry) => entry.error !== undefined);
  const footer =
    failed.length > 0
      ? `\n\n---\n_${failed.length} panelist(s) failed to return: ${failed
          .map((entry) => entry.title)
          .join(", ")}._`
      : "";

  return `${header}\n\n${sections.join("\n\n")}${footer}`;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

export async function executeThinkAgent(
  params: ThinkParams,
  options: ExecuteThinkAgentOptions = {},
): Promise<AgentToolResult<ThinkDetails>> {
  const modelReference = params.model ?? THINK_TOOL_DEFAULT_MODEL;
  const thinkingLevel = params.thinking;
  const sessionThinkingLevel = thinkingLevel ?? "off";
  const panelSize = clampPanelSize(params.agents);
  const lenses = assignThinkLenses(panelSize);

  const details: ThinkDetails = {
    prompt: params.prompt,
    model: modelReference,
    agents: panelSize,
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  };

  try {
    if (options.signal?.aborted) {
      throw new Error("Think panel run was cancelled before it started");
    }

    const model = resolveThinkModel(modelReference, options.modelRegistry);
    if (!model) {
      throw new Error(`Unable to find Pi model ${modelReference}`);
    }

    const createAgent = options.createAgent ?? ThinkAgent.init;

    const settled = await Promise.allSettled(
      lenses.map((lens) =>
        runPanelist(createAgent, lens, panelSize, params.prompt, {
          cwd: options.cwd,
          model,
          modelRegistry: options.modelRegistry,
          thinkingLevel: sessionThinkingLevel,
          signal: options.signal,
        }),
      ),
    );

    const panel: ThinkPanelEntry[] = settled.map((outcome, index) => {
      const lens = lenses[index];
      if (outcome.status === "fulfilled") {
        return {
          lens: lens.key,
          title: lens.title,
          text: outcome.value.text,
          model: outcome.value.model,
          thinkingLevel: outcome.value.thinkingLevel,
        };
      }
      return {
        lens: lens.key,
        title: lens.title,
        error: errorMessage(outcome.reason),
      };
    });

    const succeeded = panel.filter((entry) => entry.text !== undefined);
    if (succeeded.length === 0) {
      throw new Error(
        panel.find((entry) => entry.error)?.error ??
          "no think panelist produced output",
      );
    }

    const resolvedThinking = succeeded[0]?.thinkingLevel ?? thinkingLevel;
    // Only surface an effort level when the caller actually requested one, so
    // the rendered header and details.thinkingLevel never disagree (a panelist's
    // model-default effort is not a level we asked for, so we don't report it).
    const reportedThinking =
      thinkingLevel !== undefined ? resolvedThinking : undefined;
    const combined = formatPanel(panel, panelSize, reportedThinking);

    return {
      content: [{ type: "text", text: combined }],
      details: {
        ...details,
        model: succeeded[0]?.model ?? modelReference,
        panel,
        output: combined,
        ...(reportedThinking !== undefined
          ? { thinkingLevel: reportedThinking }
          : {}),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      content: [{ type: "text", text: `think failed: ${message}` }],
      details: {
        ...details,
        error: message,
      },
    };
  }
}

function previewPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77)}...`;
}

export default function thinkExtension(pi: ExtensionAPI) {
  pi.registerTool<typeof ThinkParams, ThinkDetails>({
    name: "think",
    label: "Think",
    description:
      "Ask a panel of one or more contained Pi SDK adversarial critics to analyze a hard problem or decision. Each critic tries to find the flaw in your plan. Configure depth with `thinking` (reasoning effort) and breadth with `agents` (panel size). Uses createAgentSession internally and does not call an external `think` binary.",
    promptSnippet:
      "think: delegate hard analysis to a panel of contained Pi SDK adversarial critics.",
    promptGuidelines: [
      "Use think for hard reasoning, architecture tradeoffs, debugging strategy, or when an adversarial second pass would improve the answer.",
      "Pass a complete, self-contained prompt; the think tool only receives the prompt string.",
      "Tune `thinking` for depth (off→xhigh) and `agents` for breadth (1→6 distinct expert lenses); use agents:3 for real decisions, 4-6 for the highest-stakes calls.",
      "The think tool is implemented inside Pi via the SDK and does not shell out to a local binary.",
    ],
    parameters: ThinkParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const panelSize = clampPanelSize(params.agents);
      onUpdate?.({
        content: [
          {
            type: "text",
            text:
              panelSize > 1
                ? `Thinking via a panel of ${panelSize} Pi SDK critics...`
                : "Thinking via Pi SDK sub-agent...",
          },
        ],
        details: { prompt: params.prompt, agents: panelSize },
      });

      return executeThinkAgent(params, {
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        signal,
      });
    },

    renderCall(args, theme) {
      const panelSize = clampPanelSize(args.agents);
      const badge = panelSize > 1 ? `think×${panelSize} ` : "think ";
      return new Text(
        `${theme.fg("toolTitle", theme.bold(badge))}${theme.fg(
          "muted",
          previewPrompt(args.prompt),
        )}`,
        0,
        0,
      );
    },

    renderResult(result, { isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Thinking..."), 0, 0);
      }

      if (result.details.error) {
        return new Text(
          theme.fg("error", `Failed: ${result.details.error}`),
          0,
          0,
        );
      }

      const panel = result.details.panel;
      if (panel && panel.length > 1) {
        const ok = panel.filter((entry) => entry.text !== undefined).length;
        const failed = panel.length - ok;
        const suffix = failed > 0 ? ` (${failed} failed)` : "";
        return new Text(
          theme.fg("success", `Panel of ${panel.length}: ${ok} complete${suffix}`),
          0,
          0,
        );
      }

      return new Text(theme.fg("success", "Complete"), 0, 0);
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (event.systemPrompt.includes("## Thinking Deeply")) {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${THINKING_DEEPLY_AWARENESS_PROMPT}`,
    };
  });
}
