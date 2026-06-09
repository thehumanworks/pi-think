export const meta = {
  name: 'pi-think-adversarial-review',
  description: 'Find-then-refute adversarial review of the pi-think panel changes: dimension reviewers surface defects, then independent skeptics try to refute each, so only surviving findings are reported.',
  phases: [
    { title: 'Review', detail: 'parallel dimension reviewers read the changed files' },
    { title: 'Refute', detail: 'independent skeptic attacks each finding' },
  ],
}

// The reviewer persona/tools/model live in the versioned agent definition
// .claude/agents/adversarial-reviewer.md, referenced by `agentType` below.
// Project agents resolve only if loaded at session start (restart or /agents
// after creating the file).

const ROOT = '/Users/mish/.pi/agent/extensions/pi-think'

const CHANGE_CONTEXT = `Project: ${ROOT} (a Pi coding-agent extension; runtime is bun; no git repo).

What changed: the \`think\` tool was upgraded from a single contained reasoning sub-agent to a configurable PANEL of adversarial critics.
- lib/agent.ts: rewrote the critic system prompt (THINK_AGENT_CORE_PROMPT) grounded in research; added a lens framework (THINK_GENERALIST_LENS, THINK_PANEL_LENSES, ThinkLens), assignThinkLenses(panelSize), buildThinkSystemPrompt(lens, panelSize), MAX_THINK_AGENTS=8, and a systemPrompt option on ThinkAgentInitOptions. THINK_AGENT_SYSTEM_PROMPT is now buildThinkSystemPrompt(generalist,1).
- index.ts: added an \`agents\` param (integer 1..8), clampPanelSize(), runPanelist(), formatPanel(), and rewrote executeThinkAgent to run the panel in parallel via Promise.allSettled, tolerate partial failures, and only error when ALL panelists fail. n=1 returns the single critic's raw JSON unchanged (backward compat); n>=2 returns labeled Markdown sections. Also rewrote the host-agent awareness prompt (THINKING_DEEPLY_AWARENESS_PROMPT) and the renderCall/renderResult.
- index.test.ts and scripts/smoke-test.ts: updated for the new contract.

Requirements this must satisfy (spec fidelity):
1. The number of parallel thinking agents is configurable (panel of experts, adversarial reasoning); the tool presents ALL panelists' output to the caller.
2. Effort level is configurable AND clearly documented for when each level should be used.
3. The critic system prompt is optimised and grounded in adversarial-review / reasoning / prompt-engineering research.

Files to read: index.ts, lib/agent.ts, index.test.ts, scripts/smoke-test.ts, and .claude/workflows/research-brief.md for the research the prompt should reflect.`

const DIMENSIONS = [
  {
    key: 'correctness-contract',
    brief:
      'Correctness and contract/compatibility. Check clampPanelSize edge cases (undefined, 0, negative, NaN, fractional, > MAX), assignThinkLenses wrapping past the roster (distinct keys? off-by-one in the seat suffix?), formatPanel section numbering when some panelists fail, the details shape (agents/panel/output/model/thinkingLevel) and whether n=1 truly preserves the old raw-output contract, and any exported symbol that callers/tests depend on that changed without all call sites updated.',
  },
  {
    key: 'concurrency-failure',
    brief:
      'Concurrency, resource and failure handling. Verify every panelist session is disposed even on throw (finally in runPanelist), Promise.allSettled never rejects the whole call, the abort signal is honoured for an in-flight panel, the all-fail path throws a useful message while partial-fail is tolerated, and there is no shared mutable state across the concurrent sessions that could race.',
  },
  {
    key: 'prompt-spec',
    brief:
      'Prompt quality and spec fidelity. Does THINK_AGENT_CORE_PROMPT actually implement the research principles in research-brief.md (falsification/localization, structural anti-sycophancy via restated_claim, steelman + anti-flip, premortem, rationale-before-verdict field order, calibrated confidence, load-bearing-only)? Are the lenses genuinely distinct (no duplication)? Are all three requirements delivered? Any internal contradiction between the JSON schema, the awareness prompt response-shape section, and the actual fields the model is told to emit?',
  },
  {
    key: 'tests',
    brief:
      'Test integrity. Do the tests actually exercise the new behaviour or pass vacuously? Specifically: does the concurrency test truly prove parallelism (could it pass if runs were serial?), does the partial-failure test assert disposal of the failing seat, do the lens-distinctness assertions match the real titles, and would the suite catch a regression that made the panel run serially or drop a panelist?',
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'location', 'defect', 'fix'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          location: { type: 'string', description: 'file:line or symbol' },
          defect: { type: 'string', description: 'why it is a real problem' },
          fix: { type: 'string', description: 'concrete fix' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'confidence', 'reason'],
  properties: {
    real: { type: 'boolean', description: 'true only if it survived refutation' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'the strongest refutation, and why it did or did not stick' },
  },
}

phase('Review')
const reviewed = await pipeline(
  DIMENSIONS,
  (dim) =>
    agent(
      `${CHANGE_CONTEXT}\n\n=== YOUR REVIEW DIMENSION ===\n${dim.brief}\n\nRead the files under ${ROOT} and report only defects you can defend. If you find none in your dimension, return an empty findings array.`,
      { label: `review:${dim.key}`, phase: 'Review', agentType: 'adversarial-reviewer', schema: FINDINGS_SCHEMA },
    ),
  (result, dim) =>
    parallel(
      (result?.findings ?? []).map((f) => () =>
        agent(
          `${CHANGE_CONTEXT}\n\n=== A FELLOW REVIEWER REPORTED THIS FINDING ===\nTitle: ${f.title}\nSeverity: ${f.severity}\nLocation: ${f.location}\nClaimed defect: ${f.defect}\nProposed fix: ${f.fix}\n\nIndependently verify by reading the actual code under ${ROOT}. Construct the STRONGEST argument that this is NOT a real problem (unreachable path, value validated upstream, intended behaviour, test already covers it). Default real=false unless you cannot make the refutation stick.`,
          { label: `refute:${dim.key}`, phase: 'Refute', agentType: 'adversarial-reviewer', schema: VERDICT_SCHEMA },
        ).then((verdict) => ({ ...f, dimension: dim.key, verdict })),
      ),
    ),
)

const all = reviewed.flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict?.real)
const dismissed = all.filter((f) => !f.verdict?.real)

return {
  confirmed,
  dismissed: dismissed.map((f) => ({
    title: f.title,
    location: f.location,
    refutation: f.verdict?.reason,
  })),
  counts: { total: all.length, confirmed: confirmed.length, dismissed: dismissed.length },
}
