# Research brief — grounding for the `think` system prompt

Produced by `optimise-pi-think.workflow.js` (5 agents, ~221k tokens). This is the
evidence base for the wording choices in `lib/agent.ts` and the effort/panel
guidance in `index.ts`. Keep it in sync when the prompts change.

## Core principles baked into the critic prompt

1. **Falsification + localization, not grading.** Assume a weakness exists;
   locate the single weakest/first failing step and name it specifically rather
   than returning a global "looks correct." Detection is the bottleneck — GPT-4
   only ~52.9% at locating the first wrong step, but given the location,
   backtracking lifts accuracy +18–44 pts. (Tyen et al., BIG-Bench Mistake,
   https://aclanthology.org/2024.findings-acl.826/)
2. **Manufacture real diversity / grounding.** Re-solve by a different route and
   treat discrepancies as prime suspects. Plain self-reflection is
   affirmation-biased (~46.7% just affirm). Self-Contrast beat it +7.8% vs -0.8%.
   (https://aclanthology.org/2024.acl-long.197/)
3. **Premortem / failure enumeration.** Assume the conclusion failed; enumerate
   concrete failure modes, then test each. The enumeration step drives the gain.
   (InvThink, https://arxiv.org/html/2510.01569)
4. **Rationale → verdict → confidence, in that fixed order.** CoT-before-verdict
   is the safest universal LLM-as-judge intervention (+1.5–13pp on LLMBar).
   Operationalized by JSON field order (reasoning + counterargument before
   bottom_line + confidence). (Zheng et al., https://arxiv.org/abs/2306.05685)
5. **Anti-sycophancy is structural, not an instruction.** Restate the claim as a
   neutral falsifiable proposition before judging; "don't be sycophantic" is weak
   and can backfire. (Sharma et al. https://arxiv.org/abs/2310.13548; ELEPHANT
   https://arxiv.org/abs/2505.13995; Ask Don't Tell https://arxiv.org/abs/2602.23971)
6. **Steelman then overturn only with a concrete re-derived counter-reason; say
   so plainly when the original holds.** Pure "attack it" causes regressive
   flips — models flip ~46% on "are you sure?", ~17% accuracy drop. (FlipFlop,
   https://arxiv.org/abs/2311.08596)
7. **Load-bearing flaws over flaw count.** Report only flaws confident-real and
   conclusion-changing; tag severity; never invent problems to seem thorough.
   More claims catch more bugs but hallucinate more. (CriticGPT,
   https://arxiv.org/html/2407.00215v1)
8. **Prefer concrete checks over pure reasoning.** Where a claim is checkable by
   hand (arithmetic, a small logic step, re-deriving), do the check; route what
   needs external verification into `unknowns`. Prompted self-correction without
   grounding often degrades. (Kamoi et al. TACL 2024; Huang et al. ICLR 2024
   https://arxiv.org/abs/2310.01798)
9. **Calibrated, defensible confidence.** High confidence must name what evidence
   would change the verdict; reserve top bands for claims defensible against a
   determined skeptic. Judges cluster at 90–100% with high ECE. (Overconfidence
   in LLM-as-a-Judge, https://arxiv.org/abs/2508.06225)
10. **One-line role, goal-and-contract framing.** No persona padding (adds tokens
    without correctness gains on modern reasoning models); raise reasoning effort
    rather than prompting around shallow reasoning. (OpenAI reasoning guide;
    Anthropic extended-thinking-tips)

## Lens design (distinct, never duplicated)

Identical critic roles *degrade* performance (ChatEval,
https://arxiv.org/abs/2308.07201); distinct personas improve correlation with
human judgment ~10–16%. Assignment order puts the highest-value lenses first:
correctness → failure-modes → evidence/assumptions → alternatives → framing →
pragmatics.

## Panel size

- Single critic (+ the model's own self-consistency) is a strong, cheap baseline
  that multi-agent debate often fails to beat at matched compute. (Smit et al.
  ICML 2024 https://arxiv.org/abs/2311.17371; https://arxiv.org/abs/2502.08788)
- Biggest gain is **1 → 2-3 distinct lenses** (MoA ablation: 47.8% → 58.8% at
  n=2), then sharply diminishing (n=2→6 adds ~2.5pts). Ceiling ~3-4, hard cap a
  bit higher. (Mixture-of-Agents, https://arxiv.org/abs/2406.04692)
- Panels help most on **hard, uncertain, or long/noisy/conflicting** inputs;
  single-agent is strongest at matched budget otherwise. Ensemble accuracy is
  bounded by the strongest reasoner — diversity refines, it does not manufacture
  capability. (https://arxiv.org/html/2511.07784, https://arxiv.org/html/2604.02460v1)

## Effort

Effort is the **primary** quality knob; raise it rather than prompting around
shallow reasoning. off/minimal = trivial/schema-only; low = cheap single-claim
checks/routing; medium = default bounded critique; high = hard multi-step logic,
debugging, intelligence-sensitive critique; xhigh = deep adversarial critique of
long/noisy/high-stakes inputs. More thinking does not uniformly help on
knowledge-intensive tasks and can raise hallucination — it pays off on
verifiable, reasoning-bound problems. (OpenAI reasoning guide; Anthropic
adaptive-thinking; https://arxiv.org/abs/2509.06861)
