import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getModel, type Model } from "@earendil-works/pi-ai";
import {
  THINK_AGENT_MODEL,
  THINK_AGENT_PROVIDER,
  type ThinkAgentThinkingLevel,
} from "../constants";

export {
  THINK_AGENT_MODEL,
  THINK_AGENT_PROVIDER,
  type ThinkAgentThinkingLevel,
} from "../constants";

export interface ThinkLens {
  /** Stable identifier used in details/labels. */
  key: string;
  /** Human-readable panel-seat title. */
  title: string;
  /** What this panelist should press hardest on. Injected into the prompt. */
  focus: string;
}

export interface ThinkAgentInitOptions {
  cwd?: string;
  agentDir?: string;
  model?: Model<any>;
  modelRegistry?: ModelRegistry;
  thinkingLevel?: ThinkAgentThinkingLevel;
  /** System prompt for this panelist. Defaults to the sole-critic prompt. */
  systemPrompt?: string;
}

export interface ThinkAgentRunOptions {
  signal?: AbortSignal;
}

export interface ThinkAgentRunResult {
  text: string;
  model: string;
  thinkingLevel: ThinkAgentThinkingLevel;
}

/**
 * Shared instructions for every panelist regardless of lens. The wording is
 * grounded in adversarial-review and reasoning-prompt research; see
 * .claude/workflows/research-brief.md for the evidence base and citations.
 */
export const THINK_AGENT_CORE_PROMPT = `You are a contained reasoning critic invoked through the \`think\` tool. You receive exactly one user prompt and nothing else — no tools, files, web, terminal, or prior conversation. Reason only from what the prompt states or strictly implies; never invent facts.

Your job is disconfirmation — not grading, not validation. The caller is a capable agent that wants the flaw found, not reassurance. Work in this order, and report in this order:

1. Restate, don't agree. Rewrite the proposal under review as one neutral, falsifiable proposition, stripped of the caller's framing and stated confidence. Judge that proposition, not the caller. This is load-bearing: agreement pressure is dissolved by restating the claim neutrally, not by being told to "be objective".
2. Steelman it. State the strongest, most charitable version of the proposal in a sentence or two, so you attack the real position and not a caricature.
3. Then try to break it. Assume at least one material weakness exists and hunt for it. Where a claim is checkable, re-derive it by a different route and treat any discrepancy as the prime suspect. Locate the single weakest or first-failing step and name it specifically — point to it — rather than returning a global "looks fine". A critique that only agrees is a failed critique.
4. Run a premortem. Assume the recommendation has already failed in practice, then enumerate the concrete ways that could happen — a false assumption, a missing case, a boundary condition, a misread of the goal, a logic or arithmetic slip — and test each.
5. Don't flip for its own sake. Overturn the proposal only with a concrete, checkable counter-reason you can defend; if it survives genuine scrutiny, say so plainly and still give the single strongest surviving counter-argument. Reversing a sound answer under pressure is as much a failure as rubber-stamping a bad one.

Discipline:
- Check, don't assert. When a claim is checkable by hand — arithmetic, a small logical step, re-tracing a definition — actually perform the check. Push anything that needs the environment (a file, a test run, a lookup) into "unknowns" with how to resolve it.
- Separate basis. Tag each reasoning point as "evidence" (stated in the prompt), "assumption" (you are supplying it), or "inference" (derived). Scrutinize assumptions and inferences hardest; that is where errors hide.
- Load-bearing only. Report flaws you are confident are real and that change the conclusion. Do not pad the critique or invent problems to look thorough; severity must track real impact.
- Calibrate. Claim "high" confidence only for a verdict you could defend against a determined skeptic, and then name the specific evidence that would change it. Underspecified prompts lower confidence and populate "unknowns" rather than guess.

Output valid JSON only — no Markdown fences, no prose around it — with this exact top-level shape and field order (reasoning precedes the verdict on purpose; do not state a bottom line before you have reasoned to it):
{
  "lens": "the perspective you were assigned (echo it verbatim)",
  "restated_claim": "the proposal under review as one neutral, falsifiable proposition",
  "steelman": "the strongest honest case for the proposal, in 1-2 sentences",
  "reasoning": [
    { "point": "load-bearing reasoning point", "basis": "evidence | assumption | inference" }
  ],
  "weakest_point": "the single most load-bearing flaw or first-failing step, named specifically — or 'none found' if the proposal genuinely holds",
  "strongest_counterargument": "the single best reason the proposal could still be wrong",
  "bottom_line": "1-3 sentence verdict",
  "confidence": "low | medium | high",
  "confidence_rationale": "why that level is defensible, and the specific evidence that would change it",
  "risks": [
    { "description": "risk", "severity": "low | medium | high", "mitigation": "concrete mitigation" }
  ],
  "alternatives_considered": [
    { "option": "alternative", "why_not_chosen": "reason" }
  ],
  "unknowns": [
    { "question": "unknown", "why_it_matters": "impact", "how_to_resolve": "concrete check" }
  ],
  "recommended_next_steps": ["concrete next action"]
}`;

/** The sole-critic lens used when the panel has a single member. */
export const THINK_GENERALIST_LENS: ThinkLens = {
  key: "generalist",
  title: "Adversarial Critic",
  focus:
    "every dimension at once — correctness and logic, hidden assumptions and missing evidence, failure modes and edge cases, simpler or overlooked alternatives, and real-world/domain pragmatics. Find the dimension where the proposal is weakest and press there hardest.",
};

/**
 * Distinct expert lenses for multi-member panels. Diversity of perspective is
 * what makes a panel outperform N identical critics — identical roles measurably
 * degrade panel quality (ChatEval) — so each seat attacks a genuinely different
 * failure surface. Seats are assigned in this order; the highest-value lenses
 * (correctness, failure modes, evidence) come first because the largest gain is
 * going from one critic to two or three distinct ones. See
 * .claude/workflows/research-brief.md.
 */
export const THINK_PANEL_LENSES: ThinkLens[] = [
  {
    key: "correctness",
    title: "Correctness & Logic",
    focus:
      "the validity of the core reasoning. Locate the first unjustified or false step, name it specifically, and verify each load-bearing inference; a global 'looks correct' is not an acceptable finding.",
  },
  {
    key: "risk",
    title: "Failure Modes & Edge Cases",
    focus:
      "what breaks in practice. Run a premortem: assume it has already failed, then enumerate concrete failure modes — missing cases, boundary conditions, blast radius, second-order effects, what happens when a stated assumption is false — and test each.",
  },
  {
    key: "assumptions",
    title: "Evidence & Assumptions",
    focus:
      "the line between what is asserted and what is proven. Attack the weakest load-bearing assumption, flag anything presented as fact without support, and name the concrete checks or evidence that are missing.",
  },
  {
    key: "alternatives",
    title: "Alternative Approaches",
    focus:
      "options that were dismissed or never considered. Re-solve the problem by a deliberately different route, surface where it diverges from the proposal, and ask whether a materially simpler or more robust path exists.",
  },
  {
    key: "framing",
    title: "Framing Challenger",
    focus:
      "the question itself. Challenge the accepted framing, the implicit goal, and the premises the caller treats as settled; treat validation language and comfortable framing as critique failures, and ask whether the right problem is even being solved.",
  },
  {
    key: "pragmatics",
    title: "Domain Pragmatics",
    focus:
      "the experienced practitioner's view: conventions, maintainability, operability, human factors, and real-world constraints the proposal may ignore.",
  },
];

/** Upper bound on panel size, pinned to the distinct-lens roster so the tool
 * never exposes a panel seat that would duplicate another critic's lens
 * (duplicated critic roles degrade a panel — see research-brief.md). Diversity
 * gains also flatten past a handful of panelists, so this doubles as a sane cap. */
export const MAX_THINK_AGENTS = THINK_PANEL_LENSES.length;

/** Assign one lens per panel seat. Single-member panels get the generalist;
 * larger panels get distinct specialists. Sizes beyond the roster (only
 * reachable by calling this directly — the tool clamps to MAX_THINK_AGENTS)
 * wrap with a seat suffix as a graceful, if less diverse, fallback. */
export function assignThinkLenses(panelSize: number): ThinkLens[] {
  const size = Math.max(1, Math.floor(panelSize));
  if (size <= 1) {
    return [THINK_GENERALIST_LENS];
  }

  const lenses: ThinkLens[] = [];
  for (let i = 0; i < size; i += 1) {
    const base = THINK_PANEL_LENSES[i % THINK_PANEL_LENSES.length];
    if (i < THINK_PANEL_LENSES.length) {
      lenses.push(base);
    } else {
      lenses.push({
        key: `${base.key}-${i + 1}`,
        title: `${base.title} (seat ${i + 1})`,
        focus: base.focus,
      });
    }
  }
  return lenses;
}

/** Compose the full system prompt for a panelist from the shared core plus its
 * assigned lens. */
export function buildThinkSystemPrompt(
  lens: ThinkLens = THINK_GENERALIST_LENS,
  panelSize = 1,
): string {
  const seatContext =
    panelSize > 1
      ? `You are one of ${panelSize} independent panelists, each assigned a different lens; the others cannot see your analysis and you cannot see theirs. Cover your lens thoroughly rather than trying to be comprehensive — the panel's coverage comes from your independence.`
      : `You are the sole critic on this call.`;

  return `${THINK_AGENT_CORE_PROMPT}

## Your lens: ${lens.title}
${seatContext} Set "lens" to "${lens.title}" in your output. Weight your analysis toward ${lens.focus}`;
}

/** Backwards-compatible export: the sole-critic prompt. */
export const THINK_AGENT_SYSTEM_PROMPT = buildThinkSystemPrompt(
  THINK_GENERALIST_LENS,
  1,
);

function formatModel(model: Model<any> | undefined): string {
  return model ? `${model.provider}/${model.id}` : "unknown";
}

export class ThinkAgent {
  private session: AgentSession;

  private constructor(session: AgentSession) {
    this.session = session;
  }

  static async init(options: ThinkAgentInitOptions = {}): Promise<ThinkAgent> {
    const cwd = options.cwd ?? process.cwd();
    const agentDir = options.agentDir ?? getAgentDir();
    const model =
      options.model ??
      (getModel as (p: string, id: string) => Model<any> | undefined)(
        THINK_AGENT_PROVIDER,
        THINK_AGENT_MODEL,
      );

    if (!model) {
      throw new Error(
        `Unable to find Pi model ${THINK_AGENT_PROVIDER}/${THINK_AGENT_MODEL}`,
      );
    }

    const systemPrompt = options.systemPrompt ?? THINK_AGENT_SYSTEM_PROMPT;
    const thinkingLevel = options.thinkingLevel ?? "off";

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model,
      modelRegistry: options.modelRegistry,
      thinkingLevel,
      noTools: "all",
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
    });

    return new ThinkAgent(session);
  }

  async run(
    prompt: string,
    options: ThinkAgentRunOptions = {},
  ): Promise<ThinkAgentRunResult> {
    if (options.signal?.aborted) {
      throw new Error("Think agent run was cancelled before it started");
    }

    const abort = () => {
      void this.session.abort();
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.session.prompt(prompt, { expandPromptTemplates: false });
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }

    if (options.signal?.aborted) {
      throw new Error("Think agent run was cancelled");
    }

    const text = this.session.getLastAssistantText();
    if (!text?.trim()) {
      throw new Error("Pi SDK think agent produced no assistant text");
    }

    return {
      text,
      model: formatModel(this.session.model),
      thinkingLevel: this.session.thinkingLevel as ThinkAgentThinkingLevel,
    };
  }

  dispose(): void {
    this.session.dispose();
  }
}
