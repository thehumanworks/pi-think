# Structured Agent Panels

Structured panels replace the legacy numeric `agents` count with an explicit JSON definition of each think agent to run. They are supported equally by the standalone CLI and the Pi extension tool.

Use structured panels when you want stable panelist names, custom per-agent prompts, mixed effort levels, model overrides, or output-format instructions.

## Config shape

```json
{
  "agents": [
    {
      "name": "Friendly Agent Name",
      "systemPrompt": "Replacement for the default think critic prompt.",
      "appendSystemPrompt": "Extra instructions appended to the default lens-specific prompt.",
      "model": "provider/model_id",
      "effort": "off|minimal|low|medium|high|xhigh",
      "outputFormat": { "type": "object" }
    }
  ]
}
```

### Agent fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | No | Human-readable panel section label and result title. Defaults to the built-in lens title. Blank names are ignored. |
| `systemPrompt` | No | Fully replaces the default think critic system prompt for this agent. |
| `appendSystemPrompt` | No | Appends extra instructions to the default lens-specific think critic system prompt. |
| `model` | No | Per-agent model reference (`provider/id`). Defaults to top-level `model`, then the extension default. |
| `effort` | No | Per-agent reasoning effort: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Defaults to top-level `thinking`, then `off`. |
| `outputFormat` | No | Inline JSON value, inline JSON string, or path to a JSON file that is appended to the agent prompt as an output-format instruction. |

## Preferred saved panel files

Save reusable panels under:

```text
.agents/think/<panel_name>.json
```

A `panel` value without `/` and without a `.json` suffix resolves to this directory. For example, `panel: "smoke-panel"` loads `.agents/think/smoke-panel.json`.

Example saved panel:

```json
{
  "agents": [
    {
      "name": "Correctness Critic",
      "appendSystemPrompt": "Focus on logic and compatibility.",
      "model": "xai-auth/grok-composer-2.5-fast",
      "effort": "low"
    },
    {
      "name": "Failure Mode Critic",
      "appendSystemPrompt": "Focus on edge cases and operational risk.",
      "effort": "medium"
    }
  ]
}
```

The repository includes a smoke example at `.agents/think/smoke-panel.json`.

## Inline JSON

Inline JSON is useful for one-off calls or tests.

CLI:

```sh
./think --agent-config '{"agents":[{"name":"Docs","appendSystemPrompt":"Focus on documentation gaps.","effort":"low"}]}' "Review this implementation"
```

Pi extension tool:

```json
{
  "prompt": "Review this implementation",
  "agentConfig": {
    "agents": [
      {
        "name": "Docs Critic",
        "appendSystemPrompt": "Focus on missing docs.",
        "effort": "low"
      }
    ]
  }
}
```

## Output format pointers

`outputFormat` can be an object:

```json
{
  "agents": [
    {
      "name": "Schema Critic",
      "outputFormat": {
        "type": "object",
        "required": ["bottom_line", "confidence"],
        "properties": {
          "bottom_line": { "type": "string" },
          "confidence": { "enum": ["low", "medium", "high"] }
        }
      }
    }
  ]
}
```

It can also be a string containing JSON, or a path to a JSON file:

```json
{
  "agents": [
    {
      "name": "Schema Critic",
      "outputFormat": "./schemas/critic-output.json"
    }
  ]
}
```

When a panel is loaded from disk, relative `outputFormat` file paths resolve relative to the panel file's directory. Inline `agentConfig` paths resolve relative to the current working directory.

## Validation rules and conflicts

The resolver validates configuration before starting any think agents.

- `agentConfig` and `panel` are mutually exclusive.
- Structured config (`agentConfig` or `panel`) is mutually exclusive with numeric `agents`.
- The loaded config must be an object with a non-empty `agents` array.
- The `agents` array is capped at the built-in maximum panel size: 6.
- Every `agents[i]` entry must be an object.
- `systemPrompt` and `appendSystemPrompt` cannot both be set on the same agent.
- `effort` must be one of `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `panel` names resolve to `.agents/think/<name>.json`; explicit paths are accepted when the value contains `/` or ends with `.json`.
- `agentConfig` may be an object, an inline JSON string, or a JSON file path.

Common errors:

```text
agents cannot be combined with agentConfig or panel
agentConfig and panel are mutually exclusive
agent config must contain a non-empty agents array
agent config supports at most 6 agents
agent config agent <name> cannot set both systemPrompt and appendSystemPrompt
agent config agent <name> has invalid effort: <value>
```

## Output labels and details

For a single critic, the tool returns that critic's raw text unchanged.

For multi-agent panels, the rendered output uses each configured `name` as the Markdown section title:

```text
# Think panel — 2 of 2 expert critics · effort: mixed

These critics analysed your prompt from different lenses, blind to one another.
...

## 1 · Correctness Critic

...

## 2 · Failure Mode Critic

...
```

If some panelists fail but at least one succeeds, successful sections are returned and the footer lists failed panelists. If every panelist fails, the tool returns `think failed: ...` and records the error in details.

The result details include:

- `agents`: resolved panel size,
- `thinkingLevel`: requested effort or `mixed` for structured panels with differing efforts,
- `panelConfigSource`: file path when the config came from a saved `panel` or `agentConfig` file path,
- `panel[]`: per-panelist `lens`, `title`, `text` or `error`, `model`, and `thinkingLevel`,
- `output`: combined rendered output.
