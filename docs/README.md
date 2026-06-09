# pi-think Documentation

`pi-think` exposes Pi's contained adversarial `think` critic in two equivalent ways:

1. as a **Pi extension tool** named `think`, and
2. as a **standalone CLI** (`pi-think` / local `./think`).

Both surfaces support the structured think-agent panel feature: a JSON config can define named panelists with per-agent prompts, models, effort levels, and output-format instructions.

## Documentation index

- [Structured agent panels](structured-agent-panels.md) — the shared config shape, `.agents/think/<panel_name>.json`, inline JSON, validation rules, labels, and output behavior.
- [CLI usage](cli-usage.md) — standalone command-line flags and examples for saved panels and inline configs.
- [Pi extension tool usage](pi-extension-tool-usage.md) — calling `think` from Pi with `panel` or `agentConfig`.
- [Verification](verification.md) — test, smoke, compiled CLI, and direct Pi extension verification commands.
- [Documentation update brief](doc-update-brief.md) — source brief for the current documentation pass.

## Quick start

Create a reusable panel:

```jsonc
// .agents/think/review.json
{
  "agents": [
    {
      "name": "Correctness Critic",
      "appendSystemPrompt": "Focus on logic, compatibility, and regressions.",
      "effort": "low"
    },
    {
      "name": "Risk Critic",
      "appendSystemPrompt": "Focus on edge cases and operational blast radius.",
      "effort": "medium"
    }
  ]
}
```

Run it from the standalone CLI:

```sh
./think --panel review "Review this migration plan"
```

Call the same panel through the Pi extension tool:

```json
{
  "prompt": "Review this migration plan",
  "panel": "review"
}
```

For one-off calls, pass inline JSON instead of saving a file:

```sh
./think --agent-config '{"agents":[{"name":"Docs","appendSystemPrompt":"Focus on documentation gaps."}]}' "Review this change"
```
