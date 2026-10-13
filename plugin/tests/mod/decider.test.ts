/** Mod tests for the decider: request shape, reading each answer shape, exploration, review bump and gate wiring with a fake ask. */
import { expect, test } from "claude-code/testing";
import { decideSpawn, deciderRequest, readDecision, runDecider } from "../../src/mod/decider.ts";
import type { DeciderDeps, DeciderSettings, HistoryRow } from "../../src/mod/decider.ts";
import type { PolicyRun } from "../../src/mod/policy.ts";
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
  expect(Object.keys(body.questions)).toEqual(["model", "effort", "needs_review", "size", "terminal_heavy", "has_tests", "spec_clarity"]);
  expect(body.questions.needs_review.type).toBe("noul");
  expect(body.questions.size.type).toBe("score");
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

test("runDecider: a timeout, a failed call or an unusable answer gives its reason; an answer gives its decision and latency", async () => {
  const input = { prompt: "p", tag: {}, agentType: "", cwd: "", history: [] };
  const slow: DeciderDeps = { ...deps(SONNET), ask: () => new Promise(() => {}), wait: async () => {} };
  expect(await runDecider(slow, dcfg(), input)).toEqual({ error: "timeout", latency_ms: 0 });
  expect(await runDecider({ ...deps(SONNET), ask: async () => { throw new Error("down"); } }, dcfg(), input))
    .toMatchObject({ error: "request failed" });
  expect(await runDecider({ ...deps(SONNET), ask: async () => { throw new Error("http 500"); } }, dcfg(), input))
    .toMatchObject({ error: "http 500" });
  expect(await runDecider(deps({}), dcfg(), input)).toMatchObject({ error: "invalid response" });
  expect(await runDecider(deps(SONNET), dcfg(), input)).toMatchObject({ decision: { model: "sonnet" }, latency_ms: 0 });
});

test("a failing decider leaves an error record with no pick, and the spawn keeps the gate's default", async () => {
  const failing: DeciderDeps = { ...deps(SONNET), ask: async () => { throw new Error("http 500"); } };
  const found = await decideSpawn(failing, dcfg({ mode: "decide" }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, []);
  expect(found?.choice.model).toBe("haiku");
  expect(found?.record).toMatchObject({ mode: "decide", model: "", effort: "", explored: false, source: "default", error: "http 500" });
  expect(found?.record.features).toEqual({ size_level: null, spec_clarity_level: null, terminal_heavy: null, has_tests: null });
  const slow: DeciderDeps = { ...deps(SONNET), ask: () => new Promise(() => {}), wait: async () => {} };
  const late = await decideSpawn(slow, dcfg({ mode: "shadow" }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, []);
  expect(late?.record).toMatchObject({ model: "", error: "timeout" });
});

test("the record always keeps all four features: null when the answer leaves them out, false when it says false", async () => {
  const bare = await decideSpawn(deps(SIZED), dcfg({ mode: "shadow" }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, []);
  expect(bare?.record.features).toEqual({ size_level: "small", spec_clarity_level: null, terminal_heavy: null, has_tests: null });
  const answered = { ...SIZED, terminal_heavy: false, has_tests: { value: false, probability: 0.1 } };
  const said = await decideSpawn(deps(answered), dcfg({ mode: "shadow" }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, []);
  expect(said?.record.features).toEqual({ size_level: "small", spec_clarity_level: null, terminal_heavy: false, has_tests: false });
  expect(readDecision({ terminal_heavy: true, has_tests: false }, 0.6)?.features).toEqual({ terminal_heavy: true, has_tests: false });
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
  const found = await decideSpawn(d, cfg, g, e, choice, "/x/proj", [], {}, []);
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

test("readDecision reads the task features; a features-only answer is usable and has no confidence floor", () => {
  const d = readDecision({ ...SONNET,
    size: { level: 2, score: 2, confidence: 0.7 },
    spec_clarity: { score: 3, level: 3, confidence: 0.4 },
    terminal_heavy: { value: true, probability: 0.8 },
    has_tests: 0.2,
  }, 0.6);
  expect(d?.features).toEqual({ size_level: "medium", spec_clarity_level: "exact", terminal_heavy: true, has_tests: false });
  expect(readDecision({ size: { level: 9 }, has_tests: { value: true } }, 0.6)?.features).toEqual({ has_tests: true });
  expect(readDecision({ size: { level: 0 } }, 0.6)).toEqual({ confident: false, probs: {}, features: { size_level: "tiny" } });
});

/** `n` runs with the same verdict, in one bucket: implement, ts, size small by default. */
const repeat = (verdict: string, n: number): string[] => Array.from({ length: n }, () => verdict);
const runsOf = (model: string, verdicts: string[], size = "small"): PolicyRun[] =>
  verdicts.map((verdict) => ({ model, job: "implement", lang: "ts", verdict, decision: { features: { size_level: size } } }));
const SIZED = { ...SONNET, size: { level: 1, confidence: 0.9 } };
const IMPLEMENT = { subagentType: "general", prompt: "HAIKREW job=implement lang=ts x" };
const TAG = { job: "implement", lang: "ts" };

test("decideSpawn with no ledger runs in the bucket keeps the decider's pick and records why", async () => {
  const found = await decideSpawn(deps(SIZED), dcfg({ mode: "decide" }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, []);
  expect(found?.choice.model).toBe("sonnet");
  expect(found?.record).toMatchObject({ model: "sonnet", source: "clef", explored: false, features: { size_level: "small" } });
});

test("the ledger's bucket picks the model over the decider's pick; shadow records it and leaves the spawn", async () => {
  const opus = { size: { level: 1, confidence: 0.9 }, model: { choice: "opus", confidence: 0.9, probabilities: { opus: 0.9 } } };
  const runs = runsOf("sonnet", repeat("pass", 10));
  const at = (mode: "shadow" | "decide") => decideSpawn(deps(opus), dcfg({ mode }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, runs);
  const shadow = await at("shadow");
  expect(shadow?.choice.model).toBe("haiku");
  expect(shadow?.record).toMatchObject({ model: "sonnet", source: "data" });
  expect((await at("decide"))?.choice.model).toBe("sonnet");
});

test("a bucket of other sizes does not feed the pick", async () => {
  const runs = runsOf("sonnet", repeat("pass", 10), "large");
  const found = await decideSpawn(deps(SIZED), dcfg({ mode: "decide" }), gateCfg, IMPLEMENT, resolveModel(gateCfg, IMPLEMENT), "/x/proj", [], TAG, runs);
  expect(found?.record).toMatchObject({ model: "sonnet", source: "clef" });
});

test("decider settings validate", () => {
  expect(validate("decider", "mode", "shadow")).toBe(null);
  expect(validate("decider", "mode", "on")).not.toBe(null);
  expect(validate("decider", "explore_rate", 0.25)).toBe(null);
  expect(validate("decider", "explore_rate", 1.5)).not.toBe(null);
  expect(validate("decider", "url", "ftp://x")).not.toBe(null);
  expect(validate("decider", "target_pass", 0.9)).toBe(null);
  expect(validate("decider", "target_pass", 1.2)).not.toBe(null);
  expect(validate("decider", "min_runs", 8)).toBe(null);
  expect(validate("decider", "min_runs", 0)).not.toBe(null);
});
