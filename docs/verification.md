# Verification

Use these commands from the repository root.

## Unit tests

```sh
bun test
```

This covers CLI parsing, structured config normalization, saved panel loading, validation conflicts, per-agent prompt/model/effort forwarding, output labels, partial failures, and Pi tool registration.

## Mocked smoke test

```sh
bun run scripts/smoke-test.ts
```

The smoke test verifies tool parameter registration, default model resolution, mocked execution, built-in multi-agent panel orchestration, and structured `agentConfig` behavior.

## Optional live smoke test

Requires a configured model/auth for `xai-auth/grok-composer-2.5-fast` or the default think model.

```sh
PI_THINK_LIVE=1 bun run scripts/smoke-test.ts
```

## Build the standalone CLI

```sh
bun run build:cli
./think --version
```

## CLI structured panel smoke

Use the checked-in sample panel:

```sh
./think --panel smoke-panel --json "Return a tiny smoke critique"
```

Use inline JSON:

```sh
./think --agent-config '{"agents":[{"name":"Inline Smoke","appendSystemPrompt":"Keep it short.","effort":"off"}]}' --json "Return a tiny smoke critique"
```

Expected shape:

- process exits `0` when at least one panelist succeeds,
- JSON output includes `details.agents`, `details.panel[]`, and `details.output`,
- saved-panel runs include `details.panelConfigSource`,
- multi-agent rendered output uses section labels like `## 1 · Friendly Smoke Critic`.

## Conflict validation smoke

```sh
./think --agents 2 --panel smoke-panel "This should fail"
```

Expected result:

```text
think failed: agents cannot be combined with agentConfig or panel
```

```sh
./think --panel smoke-panel --agent-config '{"agents":[{"name":"x"}]}' "This should fail"
```

Expected result:

```text
think failed: agentConfig and panel are mutually exclusive
```

## Direct Pi extension verification

Run Pi in non-interactive mode with only the `think` extension tool enabled:

```sh
pi --no-session --approve --extension ./index.ts --tools think -p \
  'Use the think tool with {"prompt":"Review this tiny change","panel":"smoke-panel"}. Return the tool result summary.'
```

Expected behavior:

- Pi loads `./index.ts` as an extension,
- the registered `think` tool accepts `panel` and `agentConfig` parameters,
- the call path says it is thinking via a configured Pi SDK critic panel,
- the final result summarizes the named panelists from `.agents/think/smoke-panel.json`.

## Current documentation-pass verification

During this documentation update, the following command was run successfully:

```sh
bun test
```

Result: 30 tests passed, 0 failed.
