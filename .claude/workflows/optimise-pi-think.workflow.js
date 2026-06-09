export const meta = {
  name: 'optimise-pi-think-research',
  description: 'Fan out grounded research on adversarial review, panel/multi-agent reasoning, calibration, and reasoning prompt engineering, then synthesise a citation-backed design brief for the pi-think system-prompt rewrite.',
  phases: [
    { title: 'Research', detail: 'parallel research analysts, one per lens' },
    { title: 'Synthesise', detail: 'consolidate findings into a usable design brief' },
  ],
}

// The analyst persona, tools (web search/fetch), and model live in the versioned
// agent definition .claude/agents/reasoning-research-analyst.md, referenced by
// `agentType` below. Project agents must be loaded at session start to resolve;
// if you just created the file this session, restart (or create via /agents).

// One research lens per analyst. Distinct angles so coverage is broad, not redundant.
const LENSES = [
  {
    key: 'adversarial-critique',
    prompt:
      'Research what makes an adversarial / red-team CRITIQUE prompt effective for an LLM reasoning critic. Focus on: falsification framing (actively trying to prove an answer WRONG vs. confirming it), steelman-then-refute, surfacing the strongest counter-argument, premortem/inversion ("assume this failed — why?"), and separating evidence from assumption from inference. What phrasing and structure measurably improve critique quality? Cite papers and reputable practitioner sources from roughly 2023-2026.',
  },
  {
    key: 'multi-agent-panel',
    prompt:
      'Research multi-agent debate, panel-of-experts / "society of minds", and ensemble reasoning for LLMs. Key questions: does running multiple agents with DIVERSE perspectives/roles beat one agent or N identical agents? How many agents is the sweet spot before diminishing returns? Should the orchestrator synthesise, or present all outputs and let the caller integrate? How should distinct expert roles/lenses be assigned? Cite papers (e.g. multi-agent debate, self-consistency, mixture-of-agents) from 2023-2026 with specific findings on agent count and diversity.',
  },
  {
    key: 'calibration-sycophancy',
    prompt:
      'Research calibration and anti-sycophancy for LLM critics/judges. Key questions: how do you get an LLM to produce CALIBRATED confidence and a rationale rather than overconfident agreement? What is known about sycophancy (models agreeing with the user / validation-seeking) and how do prompts mitigate it? What are known LLM-as-judge failure modes (position bias, verbosity bias, self-preference) and mitigations? Cite 2023-2026 sources with concrete prompt-level mitigations.',
  },
  {
    key: 'reasoning-prompt-eng',
    prompt:
      'Research current (2024-2026) prompt-engineering guidance for REASONING/analysis agents. Focus on: chain-of-verification (CoVe), self-refine, self-consistency, structured/JSON output for machine consumption, whether explicit role prompting still helps on modern reasoning models, and how reasoning-effort/thinking-budget should be matched to task difficulty. What does the latest official model-provider guidance (OpenAI, Anthropic, etc.) say? Cite sources.',
  },
]

phase('Research')
const findings = await parallel(
  LENSES.map((lens) => () =>
    agent(lens.prompt, {
      label: `research:${lens.key}`,
      phase: 'Research',
      agentType: 'reasoning-research-analyst',
    }),
  ),
)

const usable = findings
  .map((text, i) => ({ key: LENSES[i].key, text }))
  .filter((f) => f.text)

if (usable.length === 0) {
  return { error: 'all research analysts failed', briefs: [] }
}

phase('Synthesise')
const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'core_principles',
    'lens_design',
    'panel_size_guidance',
    'effort_guidance',
    'anti_patterns',
    'citations',
  ],
  properties: {
    core_principles: {
      type: 'array',
      description: 'Principles for the shared adversarial-critic system prompt.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['principle', 'rationale', 'basis'],
        properties: {
          principle: { type: 'string' },
          rationale: { type: 'string' },
          basis: { type: 'string', description: 'paper/doc/practitioner finding it rests on' },
        },
      },
    },
    lens_design: {
      type: 'array',
      description: 'Recommended distinct expert lenses for panelists, with what each should attack.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lens', 'focus'],
        properties: { lens: { type: 'string' }, focus: { type: 'string' } },
      },
    },
    panel_size_guidance: {
      type: 'string',
      description: 'Recommended n, the diminishing-returns point, and when to scale up vs. stay at 1.',
    },
    effort_guidance: {
      type: 'string',
      description: 'How to map reasoning effort (off..xhigh) to task difficulty, with concrete triggers per level.',
    },
    anti_patterns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Prompt/design anti-patterns to avoid, grounded in the research.',
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'source'],
        properties: { claim: { type: 'string' }, source: { type: 'string', description: 'title + URL' } },
      },
    },
  },
}

const brief = await agent(
  `You are consolidating four research briefs into a single design brief for rewriting the system prompt of a "think" tool: a contained reasoning sub-agent that acts as an adversarial critic, optionally run as a panel of N agents with distinct expert lenses, configurable reasoning effort.

Synthesise ONLY what the briefs support. Do not invent citations — reuse the sources the analysts actually returned. Where briefs conflict, prefer the better-sourced claim and note the tension in the relevant rationale.

=== RESEARCH BRIEFS ===
${usable.map((f) => `\n## Lens: ${f.key}\n${f.text}`).join('\n')}
=== END ===

Produce the structured design brief.`,
  { label: 'synthesise-brief', phase: 'Synthesise', schema: BRIEF_SCHEMA },
)

return { brief, rawFindings: usable }
