/** Mod tests for the decider: request shape, reading each answer shape, exploration, review bump and gate wiring with a fake ask. */
import { expect, test } from "claude-code/testing";
import { decideSpawn, deciderRequest, readDecision, runDecider } from "../../src/mod/decider.ts";
import type { DeciderDeps, DeciderSettings, HistoryRow } from "../../src/mod/decider.ts";
import { gate, resolveModel } from "../../src/mod/gate.ts";
import type { GateSettings } from "../../src/mod/gate.ts";
import { reviewPlan } from "../../src/mod/review.ts";
import type { ReviewSettings } from "../../src/mod/review.ts";
import { defaults, validate } from "../../src/schema.ts";
import type { Input } from "../../src/mod/api.ts";

const gateCfg = { ...defaults().gate, enabled: true } as unknown as GateSettings;
const dcfg = (over: Partial<DeciderSettings> = {}): DeciderSettings => ({ ...(defaults().decider as unknown as DeciderSettings), ...over });
const row = (runs: number): HistoryRow => ({ model: "haiku", job: "implement", lang: "ts", runs, judged: runs, pass_rate: 0.9, median_tokens: 1000 });
const SONNET = { model: { choice: "sonnet", confidence: 0.9, probabilities: { haiku: 0.3, sonnet: 0.6, opus: 0.1 } } };

/** Deps with a fake endpoint; `random` is fixed. */
function deps(answer: unknown, random = 0.5): DeciderDeps {
  return { ask: async () => answer, wait: () => new Promise(() => {}), random: () => random, now: () => 0 };
}

test("request holds the truncated task, folder name only and at most 30 history rows, busiest first", () => {
  const body = deciderRequest({
    prompt: "x".repeat(5000), tag: { job: "implement" }, agentType: "general", cwd: "/Users/someone/work/proj",
    history: Array.from({ length: 40 }, (_, i) => row(i)),
  }) as { state: { task: string; cwd: string; history: HistoryRow[] }; questions: Record<string, { type: string }> };
  expect(body.state.task.length).toBe(4000);
  expect(body.state.cwd).toBe("proj");
  expect(JSON.stringify(body)).not.toContain("/Users/someone");
  expect(body.state.history.length).toBe(30);
  expect(body.state.history[0].runs).toBe(39);
  expect(Object.keys(body.questions)).toEqual(["model", "effort", "needs_review"]);
  expect(body.questions.needs_review.type).toBe("noul");
});

test("readDecision reads raw answers and applies the confidence floor per answer", () => {
  const d = readDecision({ ...SONNET, effort: { score: 2, confidence: 0.5, probabilities: [0, 0, 1, 0] }, needs_review: 0.8 }, 0.6);
  expect(d).toEqual({ confident: true, model: "sonnet", review: true, probs: { haiku: 0.3, sonnet: 0.6, opus: 0.1 } });
  const e = readDecision({ model: { choice: "haiku", confidence: 0.4, probabilities: { haiku: 0.5 } } }, 0.6);
  expect(e?.confident).toBe(false);
  expect(e?.model).toBe(undefined);
});

test("readDecision reads Clefkit's normalised shape and every noul form", () => {
  const norm = { ok: true, answers: {
    model: { type: "choice", choice: "opus", confidence: 0.8, probabilities: { opus: 0.8 } },
    effort: { type: "score", score: 3, level: 3, confidence: 0.9, probabilities: [0, 0, 0, 1] },
    needs_review: { type: "noul", value: false, probability: 0.2, confidence: 0.7 },
  } };
  expect(readDecision(norm, 0.6)).toEqual({ confident: true, model: "opus", effort: "max", review: false, probs: { opus: 0.8 } });
  expect(readDecision({ needs_review: { probability: 0.9 } }, 0.6)?.review).toBe(true);
  expect(readDecision({ needs_review: { value: false, probability: 0.1 } }, 0.6)?.review).toBe(false);
});

test("readDecision returns null for unusable responses", () => {
  for (const bad of [null, "x", 3, [], {}, { model: "sonnet" }, { model: { choice: "gpt", confidence: 1 } }]) {
    expect(readDecision(bad, 0.6)).toBe(null);
  }
});

test("runDecider: a timeout or an error gives null; exploring needs a plausible cheaper model", async () => {
  const input = { prompt: "p", tag: {}, agentType: "", cwd: "", history: [] };
  const slow: DeciderDeps = { ...deps(SONNET), ask: () => new Promise(() => {}), wait: async () => {} };
  expect(await runDecider(slow, dcfg(), input)).toBe(null);
  expect(await runDecider({ ...deps(SONNET), ask: async () => { throw new Error("down"); } }, dcfg(), input)).toBe(null);
  expect((await runDecider(deps(SONNET, 0.05), dcfg(), input))?.explore).toBe("haiku");
  expect((await runDecider(deps(SONNET, 0.5), dcfg(), input))?.explore).toBe(null);
  const unlikely = { model: { choice: "sonnet", confidence: 0.9, probabilities: { haiku: 0.1, sonnet: 0.9 } } };
  expect((await runDecider(deps(unlikely, 0.05), dcfg(), input))?.explore).toBe(null);
  const haiku = { model: { choice: "haiku", confidence: 0.9, probabilities: { haiku: 0.9 } } };
  expect((await runDecider(deps(haiku, 0), dcfg(), input))?.explore).toBe(null);
});

test("an explored run gets a standard review where a light one was due; unexplored stays light", () => {
  const cfg = defaults().review as unknown as ReviewSettings;
  const input = { job: "docs", lang: "md", paths: ["README.md"], lines: 5, testsPassed: true, model: "haiku", record: null };
  expect(reviewPlan(input, cfg, false).tier).toBe("light");
  const plan = reviewPlan({ ...input, explored: true }, cfg, false);
  expect(plan.tier).toBe("standard");
  expect(plan.reviewer?.model).toBe("sonnet");
});

/** The model the gate would launch with after the decider, for one spawn. */
async function spawn(d: DeciderDeps, cfg: DeciderSettings, e: Input, g: GateSettings = gateCfg): Promise<{ model: unknown; record: unknown }> {
  const choice = resolveModel(g, e);
  const found = await decideSpawn(d, cfg, g, e, choice, "/x/proj", [], {});
  const passed = found?.choice.model ? { ...e, model: found.choice.model } : e;
  const out = gate(g, passed, (p) => p) as Input;
  return { model: out.model, record: found?.record };
}

test("shadow records the decision but leaves the spawn on the gate's default", async () => {
  const r = await spawn(deps(SONNET), dcfg({ mode: "shadow" }), { subagentType: "general", prompt: "x" });
  expect(r.model).toBe("haiku");
  expect((r.record as { model: string; mode: string }).model).toBe("sonnet");
});

test("decide applies the confident model; a timeout falls back to the default", async () => {
  expect((await spawn(deps(SONNET), dcfg({ mode: "decide" }), { subagentType: "general", prompt: "x" })).model).toBe("sonnet");
  const slow: DeciderDeps = { ...deps(SONNET), ask: () => new Promise(() => {}), wait: async () => {} };
  expect((await spawn(slow, dcfg({ mode: "decide" }), { subagentType: "general", prompt: "x" })).model).toBe("haiku");
});

test("decide explores a cheaper model and marks it; Opus is refused to Sonnet without allow_opus", async () => {
  const r = await spawn(deps(SONNET, 0), dcfg({ mode: "decide" }), { subagentType: "general", prompt: "x" });
  expect(r.model).toBe("haiku");
  expect((r.record as { explored: boolean }).explored).toBe(true);
  const opus = { model: { choice: "opus", confidence: 0.9, probabilities: { sonnet: 0.1, opus: 0.9 } } };
  expect((await spawn(deps(opus), dcfg({ mode: "decide" }), { subagentType: "general", prompt: "x" })).model).toBe("sonnet");
  expect((await spawn(deps(opus), dcfg({ mode: "decide" }), { subagentType: "general", prompt: "x" }, { ...gateCfg, allow_opus: true })).model).toBe("opus");
});

test("a named model, a matching rule, a pinned type and mode off are never asked", async () => {
  let asked = 0;
  const counting: DeciderDeps = { ...deps(SONNET), ask: async () => { asked++; return SONNET; } };
  const decide = dcfg({ mode: "decide" });
  expect((await spawn(counting, decide, { subagentType: "general", prompt: "x", model: "haiku" })).model).toBe("haiku");
  expect((await spawn(counting, decide, { subagentType: "general", prompt: "HAIKREW job=research x" })).model).toBe("haiku");
  expect((await spawn(counting, decide, { subagentType: "haiku-coder", prompt: "x" })).model).toBe(undefined);
  expect((await spawn(counting, dcfg({ mode: "off" }), { subagentType: "general", prompt: "x" })).model).toBe("haiku");
  expect(asked).toBe(0);
});

test("decider settings validate", () => {
  expect(validate("decider", "mode", "shadow")).toBe(null);
  expect(validate("decider", "mode", "on")).not.toBe(null);
  expect(validate("decider", "explore_rate", 0.25)).toBe(null);
  expect(validate("decider", "explore_rate", 1.5)).not.toBe(null);
  expect(validate("decider", "url", "ftp://x")).not.toBe(null);
});
