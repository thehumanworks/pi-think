import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clampPanelSize,
  default as thinkExtension,
  executeThinkAgent,
  resolveThinkModel,
  resolveThinkPanelConfig,
  THINK_TOOL_DEFAULT_MODEL,
  type ThinkAgentRunner,
  type ThinkParams,
} from "./index";
import { parseThinkCliArgs, runThinkCli } from "./cli";
import {
  assignThinkLenses,
  buildThinkSystemPrompt,
  MAX_THINK_AGENTS,
  ThinkAgent,
  THINK_AGENT_MODEL,
  THINK_AGENT_PROVIDER,
  THINK_AGENT_SYSTEM_PROMPT,
  THINK_GENERALIST_LENS,
  THINK_PANEL_LENSES,
  type ThinkAgentInitOptions,
  type ThinkAgentThinkingLevel,
} from "./lib/agent";

function makeMockModel(provider: string, id: string) {
  return {
    provider,
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://example.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  } as const;
}

const defaultThinkModel = {
  provider: THINK_AGENT_PROVIDER,
  id: THINK_AGENT_MODEL,
} as const;

function mockThinkModelRegistry(
  models = [makeMockModel(defaultThinkModel.provider, defaultThinkModel.id)],
) {
  return {
    find(provider: string, modelId: string) {
      return models.find(
        (model) => model.provider === provider && model.id === modelId,
      );
    },
    getAll() {
      return models;
    },
  } as never;
}

/** Narrow the tool result's first content block to its text. */
function outputText(
  result: Awaited<ReturnType<typeof executeThinkAgent>>,
): string {
  const first = result.content[0];
  return first && "text" in first ? first.text : "";
}

interface PanelMockOptions {
  /** Return true for panelist indices that should throw on run. */
  fail?: (index: number) => boolean;
  /** Override the text a panelist returns. */
  text?: (index: number) => string;
  /** Hook invoked at the start of each run, before it resolves. */
  onRun?: (index: number) => Promise<void> | void;
  /** Effort level the run reports, e.g. a model default the caller never set. */
  reportedThinking?: ThinkAgentThinkingLevel;
}

/** Build an injectable createAgent that records init options per panelist and
 * lets tests control success/failure, output, and run timing. */
function makePanelMock(options: PanelMockOptions = {}) {
  const inits: ThinkAgentInitOptions[] = [];
  let disposeCount = 0;

  const createAgent = async (
    initOptions: ThinkAgentInitOptions,
  ): Promise<ThinkAgentRunner> => {
    const index = inits.length;
    inits.push(initOptions);
    return {
      async run() {
        await options.onRun?.(index);
        if (options.fail?.(index)) {
          throw new Error(`panelist ${index} failed`);
        }
        const model = initOptions.model as
          | { provider?: string; id?: string }
          | undefined;
        return {
          text: options.text?.(index) ?? `crit-${index}`,
          model: model
            ? `${model.provider}/${model.id}`
            : THINK_TOOL_DEFAULT_MODEL,
          thinkingLevel:
            options.reportedThinking ?? initOptions.thinkingLevel ?? "off",
        };
      },
      dispose() {
        disposeCount += 1;
      },
    };
  };

  return {
    createAgent,
    inits,
    get disposeCount() {
      return disposeCount;
    },
  };
}

describe("clampPanelSize", () => {
  test("defaults, clamps, and floors", () => {
    expect(clampPanelSize(undefined)).toBe(1);
    expect(clampPanelSize(0)).toBe(1);
    expect(clampPanelSize(-5)).toBe(1);
    expect(clampPanelSize(3)).toBe(3);
    expect(clampPanelSize(3.9)).toBe(3);
    expect(clampPanelSize(MAX_THINK_AGENTS + 100)).toBe(MAX_THINK_AGENTS);
    expect(clampPanelSize(Number.NaN)).toBe(1);
  });
});

describe("assignThinkLenses", () => {
  test("single seat uses the generalist critic", () => {
    const lenses = assignThinkLenses(1);
    expect(lenses).toHaveLength(1);
    expect(lenses[0]?.key).toBe(THINK_GENERALIST_LENS.key);
  });

  test("clamps non-positive sizes to a single generalist", () => {
    expect(assignThinkLenses(0)).toEqual([THINK_GENERALIST_LENS]);
  });

  test("multi seat assigns distinct specialist lenses", () => {
    const lenses = assignThinkLenses(3);
    expect(lenses.map((lens) => lens.key)).toEqual([
      "correctness",
      "risk",
      "assumptions",
    ]);
  });

  test("wraps with a seat suffix beyond the specialist roster", () => {
    const size = THINK_PANEL_LENSES.length + 2;
    const lenses = assignThinkLenses(size);
    const keys = lenses.map((lens) => lens.key);
    expect(new Set(keys).size).toBe(size);
    expect(keys[THINK_PANEL_LENSES.length]).toBe(
      `${THINK_PANEL_LENSES[0]?.key}-${THINK_PANEL_LENSES.length + 1}`,
    );
  });
});

describe("buildThinkSystemPrompt", () => {
  test("generalist prompt covers all dimensions and is the default export", () => {
    const prompt = buildThinkSystemPrompt(THINK_GENERALIST_LENS, 1);
    expect(prompt).toContain("Adversarial Critic");
    expect(prompt).toContain("sole critic");
    expect(prompt).toContain("disconfirmation");
    expect(prompt).toContain("strongest_counterargument");
    expect(THINK_AGENT_SYSTEM_PROMPT).toBe(prompt);
  });

  test("panel prompt names the lens and the panel context", () => {
    const prompt = buildThinkSystemPrompt(THINK_PANEL_LENSES[1], 3);
    expect(prompt).toContain("Failure Modes & Edge Cases");
    expect(prompt).toContain("3 independent panelists");
  });
});

describe("pi-think CLI wrapper", () => {
  test("parses prompt, model, thinking, agents, and json flags", () => {
    expect(
      parseThinkCliArgs([
        "--model",
        "openai/gpt-test",
        "--thinking",
        "high",
        "--agents",
        "3",
        "--json",
        "review",
        "this",
      ]),
    ).toEqual({
      kind: "run",
      options: {
        model: "openai/gpt-test",
        thinking: "high",
        agents: 3,
        json: true,
      },
      promptParts: ["review", "this"],
    });
  });

  test("parses structured agent config CLI flags", () => {
    expect(
      parseThinkCliArgs([
        "--panel",
        "migration-review",
        "--agent-config",
        '{"agents":[]}',
        "review",
      ]),
    ).toEqual({
      kind: "run",
      options: {
        panel: "migration-review",
        agentConfig: '{"agents":[]}',
      },
      promptParts: ["review"],
    });
  });

  test("rejects invalid CLI options before running the think tool", () => {
    expect(parseThinkCliArgs(["--thinking", "turbo"])).toEqual({
      kind: "error",
      message: "invalid thinking level: turbo",
    });
    expect(parseThinkCliArgs(["--agents", "many"])).toEqual({
      kind: "error",
      message: "invalid agents count: many",
    });
  });

  test("delegates to executeThinkAgent and prints the text result", async () => {
    const calls: ThinkParams[] = [];
    const result = await runThinkCli(
      ["--thinking", "low", "--agents", "2", "inspect", "the", "plan"],
      {
        cwd: "/tmp/cli-cwd",
        stdin: { text: async () => "" },
        execute: async (params, options) => {
          calls.push(params);
          expect(options.cwd).toBe("/tmp/cli-cwd");
          return {
            content: [{ type: "text", text: "mock critique" }],
            details: { prompt: params.prompt, agents: params.agents, output: "mock critique" },
          } as Awaited<ReturnType<typeof executeThinkAgent>>;
        },
      },
    );

    expect(calls).toEqual([
      { prompt: "inspect the plan", thinking: "low", agents: 2 },
    ]);
    expect(result).toEqual({ exitCode: 0, stdout: "mock critique\n" });
  });

  test("delegates structured agent config to executeThinkAgent", async () => {
    const calls: ThinkParams[] = [];
    const config = '{"agents":[{"name":"Friendly","effort":"low"}]}';
    const result = await runThinkCli(["--agent-config", config, "inspect"], {
      cwd: "/tmp/cli-cwd",
      stdin: { text: async () => "" },
      execute: async (params) => {
        calls.push(params);
        return {
          content: [{ type: "text", text: "mock configured critique" }],
          details: { prompt: params.prompt, output: "mock configured critique" },
        } as Awaited<ReturnType<typeof executeThinkAgent>>;
      },
    });

    expect(calls).toEqual([{ prompt: "inspect", agentConfig: config }]);
    expect(result).toEqual({ exitCode: 0, stdout: "mock configured critique\n" });
  });

  test("uses stdin as the prompt when no prompt argument is supplied", async () => {
    const result = await runThinkCli(["--json"], {
      stdin: { text: async () => "review stdin\n" },
      execute: async (params) => ({
        content: [{ type: "text", text: "ok" }],
        details: { prompt: params.prompt, output: "ok" },
      }) as Awaited<ReturnType<typeof executeThinkAgent>>,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? "{}").details.prompt).toBe("review stdin");
  });
});

describe("executeThinkAgent", () => {
  test("resolves canonical provider/model references without changing provider", () => {
    const registry = mockThinkModelRegistry([
      makeMockModel("openai-codex", "gpt-5.5"),
      makeMockModel("xai-auth", "grok-composer-2.5-fast"),
    ]);

    expect(
      resolveThinkModel("xai-auth/grok-composer-2.5-fast", registry),
    ).toMatchObject({
      provider: "xai-auth",
      id: "grok-composer-2.5-fast",
    });
    expect(resolveThinkModel("openai-codex/gpt-5.5", registry)).toMatchObject({
      provider: "openai-codex",
      id: "gpt-5.5",
    });
  });

  test("builds a provider-scoped fallback model for explicit unknown model ids", () => {
    const registry = mockThinkModelRegistry([
      makeMockModel("xai-auth", "known-xai-model"),
    ]);

    expect(resolveThinkModel("xai-auth/new-model-id", registry)).toMatchObject({
      provider: "xai-auth",
      id: "new-model-id",
    });
  });

  test("single critic returns its raw JSON and round-trips details", async () => {
    const signal = new AbortController().signal;
    const modelRegistry = mockThinkModelRegistry();
    const mock = makePanelMock();

    const params: ThinkParams = { prompt: "compare both implementations" };
    const result = await executeThinkAgent(params, {
      cwd: "/tmp/project",
      modelRegistry,
      signal,
      createAgent: mock.createAgent,
    });

    expect(mock.inits).toHaveLength(1);
    expect(mock.inits[0]?.cwd).toBe("/tmp/project");
    expect(mock.inits[0]?.modelRegistry).toBe(modelRegistry);
    expect(mock.inits[0]?.thinkingLevel).toBe("off");
    expect(mock.inits[0]?.systemPrompt).toContain("Adversarial Critic");
    expect(mock.disposeCount).toBe(1);

    expect(result.content).toEqual([{ type: "text", text: "crit-0" }]);
    expect(result.details).toEqual({
      prompt: "compare both implementations",
      model: THINK_TOOL_DEFAULT_MODEL,
      agents: 1,
      panel: [
        {
          lens: "generalist",
          title: "Adversarial Critic",
          text: "crit-0",
          model: THINK_TOOL_DEFAULT_MODEL,
          thinkingLevel: "off",
        },
      ],
      output: "crit-0",
    });
  });

  test("panel of three runs distinct lenses and formats labeled sections", async () => {
    const mock = makePanelMock();

    const result = await executeThinkAgent(
      { prompt: "migrate the db", agents: 3 },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect(mock.inits).toHaveLength(3);
    const prompts = mock.inits.map((init) => init.systemPrompt ?? "");
    expect(prompts[0]).toContain("Correctness & Logic");
    expect(prompts[1]).toContain("Failure Modes & Edge Cases");
    expect(prompts[2]).toContain("Evidence & Assumptions");
    expect(prompts[0]).toContain("3 independent panelists");
    expect(mock.disposeCount).toBe(3);

    expect(result.details.agents).toBe(3);
    expect(result.details.panel).toHaveLength(3);
    expect(result.details.error).toBeUndefined();

    const text = outputText(result);
    expect(text).toContain("Think panel — 3 of 3 expert critics");
    expect(text).toContain("1 · Correctness & Logic");
    expect(text).toContain("2 · Failure Modes & Edge Cases");
    expect(text).toContain("3 · Evidence & Assumptions");
    expect(text).toContain("crit-0");
    expect(text).toContain("crit-1");
    expect(text).toContain("crit-2");
  });

  test("tolerates a partial panel failure and notes it", async () => {
    const mock = makePanelMock({ fail: (index) => index === 1 });

    const result = await executeThinkAgent(
      { prompt: "ship it?", agents: 3 },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect(mock.disposeCount).toBe(3);
    expect(result.details.error).toBeUndefined();

    const panel = result.details.panel ?? [];
    expect(panel[0]?.text).toBe("crit-0");
    expect(panel[1]?.error).toContain("panelist 1 failed");
    expect(panel[2]?.text).toBe("crit-2");

    const text = outputText(result);
    expect(text).toContain("crit-0");
    expect(text).toContain("crit-2");
    expect(text).toContain(
      "1 panelist(s) failed to return: Failure Modes & Edge Cases",
    );
  });

  test("returns an error result only when every panelist fails", async () => {
    const mock = makePanelMock({ fail: () => true });

    const result = await executeThinkAgent(
      { prompt: "where is the bug?", agents: 2 },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect(mock.disposeCount).toBe(2);
    expect(result.content).toEqual([
      { type: "text", text: "think failed: panelist 0 failed" },
    ]);
    expect(result.details).toEqual({
      prompt: "where is the bug?",
      model: THINK_TOOL_DEFAULT_MODEL,
      agents: 2,
      error: "panelist 0 failed",
    });
  });

  test("runs panelists concurrently, not serially", async () => {
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const mock = makePanelMock({
      onRun: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
      },
    });

    const pending = executeThinkAgent(
      { prompt: "parallel?", agents: 3 },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(maxActive).toBe(3);
    release();
    await pending;
  });

  test("forwards optional model and thinking to every panelist", async () => {
    const mock = makePanelMock();

    const result = await executeThinkAgent(
      {
        prompt: "plan the migration",
        model: "openai-codex/gpt-5.5",
        thinking: "high",
        agents: 2,
      },
      { createAgent: mock.createAgent },
    );

    expect(mock.inits).toHaveLength(2);
    expect(mock.inits.every((init) => init.thinkingLevel === "high")).toBe(true);
    expect(result.details).toMatchObject({
      model: "openai-codex/gpt-5.5",
      thinkingLevel: "high",
      agents: 2,
    });
  });

  test("normalizes inline structured agent config with aliases and prompt overrides", () => {
    const normalized = resolveThinkPanelConfig(
      {
        agentConfig: {
          agents: [
            {
              name: "Friendly Agent Name",
              appendSystemPrompt: "Be unusually concise.",
              model: "openai-codex/gpt-5.5",
              effort: "low",
            },
          ],
        },
      },
      "/tmp/project",
    );

    expect(normalized?.agents).toHaveLength(1);
    expect(normalized?.agents[0]).toMatchObject({
      name: "Friendly Agent Name",
      modelReference: "openai-codex/gpt-5.5",
      thinkingLevel: "low",
    });
    expect(normalized?.agents[0]?.systemPrompt).toContain("Adversarial Critic");
    expect(normalized?.agents[0]?.systemPrompt).toContain("Be unusually concise.");
  });

  test("loads named panel configs from .agents/think and schema file pointers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-think-panel-"));
    const panelDir = join(cwd, ".agents", "think");
    mkdirSync(panelDir, { recursive: true });
    writeFileSync(
      join(panelDir, "schema.json"),
      JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } } }),
    );
    writeFileSync(
      join(panelDir, "migration.json"),
      JSON.stringify({
        agents: [
          {
            name: "Schema critic",
            appendSystemPrompt: "Check the schema.",
            outputFormat: "schema.json",
          },
          {
            name: "Custom prompt critic",
            systemPrompt: "You are a custom critic.",
            effort: "medium",
          },
        ],
      }),
    );

    const mock = makePanelMock();
    const result = await executeThinkAgent(
      { prompt: "review", panel: "migration" },
      { cwd, modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect(mock.inits).toHaveLength(2);
    expect(mock.inits[0]?.systemPrompt).toContain("Output format");
    expect(mock.inits[0]?.systemPrompt).toContain('"ok"');
    expect(mock.inits[1]?.systemPrompt).toBe("You are a custom critic.");
    expect(mock.inits[1]?.thinkingLevel).toBe("medium");
    expect(result.details).toMatchObject({
      agents: 2,
      thinkingLevel: "mixed",
      panelConfigSource: join(panelDir, "migration.json"),
    });
    expect(outputText(result)).toContain("1 · Schema critic");
    expect(outputText(result)).toContain("2 · Custom prompt critic");
  });

  test("rejects conflicting structured config fields before starting agents", async () => {
    const mock = makePanelMock();
    const result = await executeThinkAgent(
      {
        prompt: "x",
        agents: 2,
        agentConfig: { agents: [{ systemPrompt: "x" }] },
      },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect(mock.inits).toHaveLength(0);
    expect(result.details.error).toBe("agents cannot be combined with agentConfig or panel");
  });

  test("does not surface an effort level the caller never requested", async () => {
    // Panelist reports a model-default effort, but the caller passed no
    // `thinking`: neither the header nor details may claim an effort.
    const mock = makePanelMock({ reportedThinking: "medium" });

    const result = await executeThinkAgent(
      { prompt: "x", agents: 2 },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect("thinkingLevel" in result.details).toBe(false);
    expect(outputText(result)).not.toContain("effort:");
  });

  test("surfaces the requested effort consistently in header and details", async () => {
    const mock = makePanelMock({ reportedThinking: "high" });

    const result = await executeThinkAgent(
      { prompt: "x", agents: 2, thinking: "high" },
      { modelRegistry: mockThinkModelRegistry(), createAgent: mock.createAgent },
    );

    expect(result.details.thinkingLevel).toBe("high");
    expect(outputText(result)).toContain("effort: high");
  });

  test("registers a Pi tool that delegates through the SDK ThinkAgent", async () => {
    const originalInit = ThinkAgent.init;
    const initCalls: Array<ThinkAgentInitOptions> = [];
    const updates: unknown[] = [];
    const ctx = {
      cwd: "/tmp/repo",
      modelRegistry: {
        ...(mockThinkModelRegistry() as object),
        source: "ctx registry",
      },
    } as never;

    let disposed = false;
    (ThinkAgent.init as unknown as (typeof ThinkAgent)["init"]) = async (
      options = {},
    ) => {
      initCalls.push(options);
      return {
        async run(prompt: string) {
          return {
            text: `reviewed: ${prompt}`,
            model: THINK_TOOL_DEFAULT_MODEL,
            thinkingLevel: "off",
          };
        },
        dispose() {
          disposed = true;
        },
      } as unknown as ThinkAgent;
    };

    try {
      let registeredTool: any;
      let beforeAgentStart:
        | ((event: { systemPrompt: string }) => unknown)
        | undefined;

      thinkExtension({
        registerTool(tool: unknown) {
          registeredTool = tool;
        },
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as typeof beforeAgentStart;
          }
        },
      } as unknown as ExtensionAPI);

      expect(registeredTool?.name).toBe("think");
      expect(registeredTool?.label).toBe("Think");
      expect(registeredTool?.description).toContain("adversarial critics");
      expect(registeredTool?.description).not.toContain("Calls `think");

      const result = await registeredTool.execute(
        "tool-call-1",
        { prompt: "inspect the plan" },
        undefined,
        (partial: unknown) => updates.push(partial),
        ctx,
      );

      expect(initCalls[0]?.cwd).toBe("/tmp/repo");
      expect(initCalls[0]?.thinkingLevel).toBe("off");
      expect(initCalls[0]?.systemPrompt).toContain("Adversarial Critic");
      expect(updates).toEqual([
        {
          content: [
            { type: "text", text: "Thinking via Pi SDK sub-agent..." },
          ],
          details: { prompt: "inspect the plan", agents: 1 },
        },
      ]);
      expect(result.content).toEqual([
        { type: "text", text: "reviewed: inspect the plan" },
      ]);
      expect(result.details).toMatchObject({
        prompt: "inspect the plan",
        model: THINK_TOOL_DEFAULT_MODEL,
        agents: 1,
      });
      expect("thinkingLevel" in result.details).toBe(false);
      expect(disposed).toBe(true);

      const promptInjection = await beforeAgentStart?.({
        systemPrompt: "base",
      });
      expect(promptInjection).toEqual({
        systemPrompt: expect.stringContaining("## Thinking Deeply"),
      });
    } finally {
      (ThinkAgent.init as unknown as (typeof ThinkAgent)["init"]) = originalInit;
    }
  });
});
