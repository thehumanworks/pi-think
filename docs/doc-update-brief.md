# Documentation Update Brief

## Change List

Implemented structured think agent panel configuration for both the CLI and Pi extension tool.
Added `panel` and `agentConfig` inputs, per-agent name/systemPrompt/appendSystemPrompt/model/effort/outputFormat handling,
conflict validation against numeric agents, named section output, CLI flags --panel and --agent-config,
smoke-panel example at .agents/think/smoke-panel.json, tests, smoke tests, compiled CLI verification, and direct pi CLI extension verification.


## Documentation Prompt

Create or update markdown docs for this extension so any developer can understand the new structured panel feature,
how to call it from the standalone CLI and Pi extension tool, validation rules, preferred .agents/think/<panel_name>.json files,
and how the change was verified.


## Expectations

- Keep documentation in `docs/` as readable Markdown.
- Preserve useful existing docs and organize them with an index page.
- Cover both the standalone CLI and Pi extension tool surfaces equally.
- Include examples for inline JSON and `.agents/think/<panel_name>.json` files.
- Include validation/conflict behavior and verification notes.