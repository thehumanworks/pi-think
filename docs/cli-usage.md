# CLI Usage

The standalone CLI runs the same `executeThinkAgent` implementation used by the Pi extension tool.

Local development commands usually use the compiled `./think` binary after `bun run build:cli`. Package installs expose `pi-think` from `cli.ts`.

## Basic usage

```sh
pi-think [options] <prompt>
echo "prompt" | pi-think [options]
```

Important options:

```text
-p, --prompt <text>       Prompt to send to the critic(s)
-m, --model <provider/id> Model for the sub-agent(s)
-t, --thinking <level>    off|minimal|low|medium|high|xhigh
-a, --agents <count>      Numeric panel size for built-in lenses
    --panel <name|path>    Load .agents/think/<name>.json or an explicit JSON file
    --agent-config <json|path>
                           Inline JSON config or path to { agents: [...] }
    --json                Print the full tool result as JSON
```

## Saved panel from `.agents/think`

Given `.agents/think/review.json`:

```json
{
  "agents": [
    {
      "name": "Correctness Critic",
      "appendSystemPrompt": "Focus on logic and compatibility.",
      "effort": "low"
    },
    {
      "name": "Risk Critic",
      "appendSystemPrompt": "Focus on edge cases and operational risk.",
      "effort": "medium"
    }
  ]
}
```

Run:

```sh
./think --panel review "Review this implementation plan"
```

`review` resolves to `.agents/think/review.json`.

## Explicit panel path

Use an explicit path when the config is outside `.agents/think`:

```sh
./think --panel ./configs/review-panel.json "Review this implementation plan"
```

A `panel` value is treated as a path when it contains `/` or ends with `.json`.

## Inline JSON config

```sh
./think --agent-config '{"agents":[{"name":"Docs","appendSystemPrompt":"Focus on documentation gaps.","effort":"low"}]}' "Review this change"
```

## JSON file through `--agent-config`

`--agent-config` also accepts a file path:

```sh
./think --agent-config .agents/think/review.json "Review this implementation"
```

Prefer `--panel review` for reusable named panels; use `--agent-config <path>` when you want to be explicit that the input is a raw structured config.

## Full result JSON

Use `--json` to inspect `details.panel`, `details.panelConfigSource`, per-panelist models, efforts, and errors:

```sh
./think --panel smoke-panel --json "Return a tiny smoke critique"
```

## Conflicts

Do not combine structured config with numeric `--agents`:

```sh
./think --agents 3 --panel review "Review this"
```

This fails before any agents start:

```text
think failed: agents cannot be combined with agentConfig or panel
```

Also do not pass both `--panel` and `--agent-config`:

```text
think failed: agentConfig and panel are mutually exclusive
```
