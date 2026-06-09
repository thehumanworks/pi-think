# pi-think optimisation workflow

Versioned orchestration for the "panel of experts" upgrade to the `think` tool.
Agent definitions live in `../agents/`; this directory holds the workflow scripts
and this record of how they are run and iterated.

## Agents (`.claude/agents/`)

| Agent | Role |
| --- | --- |
| `reasoning-research-analyst` | Grounds the system-prompt rewrite in current, cited research (one lens per analyst). |
| `pi-extension-engineer` | Implements convention-matching TypeScript changes against the Pi SDK. |
| `adversarial-reviewer` | Find-then-refute review of the diff; only findings that survive refutation are reported. |

## Phase 1 — Research (`optimise-pi-think.workflow.js`)

Fans out four `reasoning-research-analyst` agents in parallel, one per lens
(adversarial critique, multi-agent panel, calibration/anti-sycophancy, reasoning
prompt engineering), then a synthesis agent consolidates them into a structured,
citation-backed design brief.

Run:

```
Workflow({ scriptPath: ".claude/workflows/optimise-pi-think.workflow.js" })
```

The returned `brief` grounds the system-prompt rewrite; `rawFindings` keeps the
underlying analyst output for audit.

## Phase 2 — Implementation

The orchestrator implements the code changes directly (precise multi-file
TypeScript edits with full session context), guided by `pi-extension-engineer`'s
conventions. The change set: configurable panel size, documented effort levels,
the research-grounded system prompt, parallel panel execution with
partial-failure tolerance, and the updated host-agent awareness prompt.

## Phase 3 — Adversarial review and iteration

`adversarial-reviewer` reviews the diff (find-then-refute). Surviving findings
are fixed; the agent definition is tightened when its output quality reveals a
gap. Validation gate: `bun test` and `bun scripts/smoke-test.ts` must pass, and
results are reported faithfully.

## Iteration log

- Initial agent definitions created for the panel-of-experts upgrade.
- **`agentType` resolves project-local `.claude/agents` by name** — both
  workflows reference `reasoning-research-analyst` and `adversarial-reviewer`
  directly, so each agent definition is the single source of truth for its
  persona, tool allowlist, and model (no inline duplication). Caveat: subagents
  are loaded at **session start** (per the Claude Code docs), so a file created
  mid-session isn't resolvable until the session restarts or the agent is
  (re)created via the `/agents` interface. The very first research run in this
  session failed for exactly that reason — the files had just been written — and
  the workflows were briefly rewired to inline personas on `general-purpose`
  before being restored to `agentType` once the agents were registered (verified
  with a one-agent probe returning `RESOLVED`).
- `adversarial-review.workflow.js` (find-then-refute, 6 agents) confirmed two
  low-severity findings, both of which survived independent refutation, and
  dismissed none:
  1. The panel header could show an effort level the caller never requested
     while `details.thinkingLevel` stayed undefined. Fixed in `executeThinkAgent`
     by only reporting an effort when the caller set one, consistently across the
     header and details. Locked in by two new tests.
  2. `MAX_THINK_AGENTS` (8) exceeded the 6 distinct lenses, so panels of 7-8
     emitted duplicate-role critics, contradicting the distinctness guarantee.
     Fixed by pinning `MAX_THINK_AGENTS = THINK_PANEL_LENSES.length` so the tool
     never exposes a duplicate seat; the wrap path remains a defensive fallback.
- Agent-instruction quality: both the `reasoning-research-analyst` and
  `adversarial-reviewer` personas produced high-signal, empirically-verified
  output (the reviewer ran the code to confirm each finding), so no instruction
  changes were warranted this pass. The reviewer's emphasis on cheap empirical
  verification is what made its findings high-confidence; keep it.
