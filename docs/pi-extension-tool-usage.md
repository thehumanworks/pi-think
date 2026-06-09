# Pi Extension Tool Usage

The Pi extension registers a tool named `think`. It uses Pi SDK sub-agents directly; it does not shell out to the local `think` binary.

The extension tool accepts the same structured panel concepts as the standalone CLI.

## Parameters

```json
{
  "prompt": "Self-contained prompt for the think agent(s)",
  "model": "provider/model_id",
  "thinking": "off|minimal|low|medium|high|xhigh",
  "agents": 3,
  "panel": "review",
  "agentConfig": { "agents": [] }
}
```

Use either:

- `agents` for a numeric built-in panel with default lens names, or
- `panel` / `agentConfig` for a structured panel.

Do not combine them.

## Load a saved panel

A named panel loads `.agents/think/<panel_name>.json` from the current working directory:

```json
{
  "prompt": "Review this migration plan",
  "panel": "review"
}
```

An explicit path is also accepted:

```json
{
  "prompt": "Review this migration plan",
  "panel": "./configs/review-panel.json"
}
```

## Inline `agentConfig` object

```json
{
  "prompt": "Review this implementation",
  "agentConfig": {
    "agents": [
      {
        "name": "Docs Critic",
        "appendSystemPrompt": "Focus on missing docs and confusing examples.",
        "effort": "low"
      },
      {
        "name": "Risk Critic",
        "appendSystemPrompt": "Focus on operational and compatibility risks.",
        "model": "xai-auth/grok-composer-2.5-fast",
        "effort": "medium"
      }
    ]
  }
}
```

## `agentConfig` as inline JSON string or path

The tool schema accepts `agentConfig` as `Any`, so callers may pass an object, a JSON string, or a file path.

Inline JSON string:

```json
{
  "prompt": "Review this change",
  "agentConfig": "{\"agents\":[{\"name\":\"Security\",\"appendSystemPrompt\":\"Focus on security.\"}]}"
}
```

File path:

```json
{
  "prompt": "Review this change",
  "agentConfig": ".agents/think/review.json"
}
```

## Output in Pi

For configured panels, Pi's call renderer shows a `think:panel` badge. During execution it reports:

```text
Thinking via a configured Pi SDK critic panel...
```

A multi-agent result is rendered as labeled Markdown sections. The section labels are the configured `name` values:

```text
## 1 · Docs Critic
...

## 2 · Risk Critic
...
```

The tool result details include `panel[]`, `agents`, `thinkingLevel`, optional `panelConfigSource`, and `output`.

## Direct Pi CLI invocation

To exercise the extension from Pi itself in non-interactive mode, load `index.ts` and ask Pi to use the `think` tool:

```sh
pi --no-session --approve --extension ./index.ts --tools think -p \
  'Use the think tool with {"prompt":"Review this tiny change","panel":"smoke-panel"}. Return the tool result summary.'
```

For a read-only inspection of registration and parameters, combine this with the verification commands in [Verification](verification.md).
