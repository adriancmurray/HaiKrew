/** Mod tests for the agent gate and the tool guards: plain functions, called with a fake next and fake $. */
import { expect, test } from "claude-code/testing";
import { effortFor, gate, jobTag, resolveModel } from "../../src/mod/gate.ts";
import type { GateSettings } from "../../src/mod/gate.ts";
import { noteEffort, resetEffort, stepEffort } from "../../src/mod/effort.ts";
import { readGuard, squeeze } from "../../src/mod/guards.ts";
import type { ReadGuardSettings, SqueezeSettings } from "../../src/mod/guards.ts";
import type { Input } from "../../src/mod/api.ts";
import { defaults, validate } from "../../src/schema.ts";

const passThrough = (e: Input) => ({ next: e });
const ROOT = "/plugins/haikrew";

/** One settings section at its schema default. */
function section<T>(name: string): T {
  const values = defaults()[name];
  // The gate ships off; these tests exercise it turned on.
  return (name === "gate" ? { ...values, enabled: true } : values) as unknown as T;
}

test("gate ships off: a fresh install passes an agent launch through unchanged", () => {
  const cfg = defaults().gate as unknown as GateSettings;
  expect(gate(cfg, { subagentType: "general", prompt: "x", model: "opus" }, passThrough))
    .toEqual({ next: { subagentType: "general", prompt: "x", model: "opus" } });
});

test("gate gives an agent with no model the default model", () => {
  const cfg = section<GateSettings>("gate");
  expect(gate(cfg, { subagentType: "general", prompt: "x" }, passThrough))
    .toEqual({ next: { subagentType: "general", prompt: "x", model: "haiku" } });
});

test("gate leaves a pinned agent type and an explicit model alone", () => {
  const cfg = section<GateSettings>("gate");
  expect(gate(cfg, { subagentType: "haiku-coder" }, passThrough)).toEqual({ next: { subagentType: "haiku-coder" } });
  expect(gate(cfg, { subagentType: "general", model: "sonnet" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "sonnet" } });
});

test("gate denies opus unless gate.allow_opus is on", () => {
  const cfg = section<GateSettings>("gate");
  const denied = gate(cfg, { subagentType: "general", model: "opus" }, passThrough) as { deny: string };
  expect(denied.deny).toMatch(/Opus/);
  const allowed = { ...section<GateSettings>("gate"), allow_opus: true };
  expect(gate(allowed, { subagentType: "general", model: "opus" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "opus" } });
});

test("gate treats a full Opus model id like the alias", () => {
  const cfg = section<GateSettings>("gate");
  const denied = gate(cfg, { subagentType: "general", model: "claude-opus-5-5" }, passThrough) as { deny: string };
  expect(denied.deny).toMatch(/Opus/);
});

test("gate gives a nested agent the nested model, and refuses nesting when it is off", () => {
  const cfg = { ...section<GateSettings>("gate"), default_model: "sonnet" };
  expect(gate(cfg, { subagentType: "general", parentAgentId: "a1" }, passThrough))
    .toEqual({ next: { subagentType: "general", parentAgentId: "a1", model: "haiku" } });
  const off = { ...cfg, allow_nested: false };
  const denied = gate(off, { subagentType: "haiku-coder", parentAgentId: "a1" }, passThrough) as { deny: string };
  expect(denied.deny).toMatch(/allow_nested/);
  expect(gate(off, { subagentType: "general" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "sonnet" } });
});

test("squeeze denies a squeeze-pattern command, bare or after cd", () => {
  const cfg = section<SqueezeSettings>("squeeze");
  const bare = squeeze(cfg, { command: "cargo test" }, ROOT, passThrough) as { deny: string };
  expect(bare.deny).toBe(`Run it through squeeze instead: node "${ROOT}/bin/haikrew.mjs" squeeze --max-lines 20 -- cargo test`);
  const after = squeeze(cfg, { command: "cd x && cargo test" }, ROOT, passThrough) as { deny: string };
  expect(after.deny).toMatch(/squeeze --max-lines 20 -- cd x && cargo test$/);
  const wrapped = squeeze({ ...cfg, wrap_prefix: "lock" }, { command: "make" }, ROOT, passThrough) as { deny: string };
  expect(wrapped.deny).toMatch(/squeeze --max-lines 20 --wrap "lock" -- make$/);
});

test("squeeze lets an ordinary command through", () => {
  expect(squeeze(section<SqueezeSettings>("squeeze"), { command: "ls" }, ROOT, passThrough)).toEqual({ next: { command: "ls" } });
});

test("read guard denies a 700-line read without a range, and allows a ranged or unread file", () => {
  const text = Array.from({ length: 700 }, (_, i) => (i === 0 ? "fn main() {" : `line ${i}`)).join("\n");
  const cfg = section<ReadGuardSettings>("read_guard");
  const denied = readGuard(cfg, { file_path: "/w/big.rs" }, text, passThrough) as { deny: string };
  expect(denied.deny).toMatch(/700 lines, over the 600-line limit/);
  expect(denied.deny).toMatch(/1: fn main\(\) \{/);
  expect(readGuard(cfg, { file_path: "/w/big.rs", offset: 1, limit: 50 }, text, passThrough))
    .toEqual({ next: { file_path: "/w/big.rs", offset: 1, limit: 50 } });
  expect(readGuard(cfg, { file_path: "/w/gone.rs" }, null, passThrough)).toEqual({ next: { file_path: "/w/gone.rs" } });
});

test("gate rules match by job tag, agent type and description words, ignoring case", () => {
  const cfg = section<GateSettings>("gate");
  const review = { subagentType: "general", prompt: "HAIKREW job=review lang=ts\nbody" };
  expect(gate(cfg, review, passThrough)).toEqual({ next: { ...review, model: "sonnet" } });
  const explore = { subagentType: "Explore", prompt: "find it" };
  expect(gate(cfg, explore, passThrough)).toEqual({ next: { ...explore, model: "haiku" } });
  const cfgDesc = { ...cfg, rules: ["desc:Migration Plan=sonnet"] };
  const desc = { subagentType: "general", description: "write the migration plan now" };
  expect(gate(cfgDesc, desc, passThrough)).toEqual({ next: { ...desc, model: "sonnet" } });
  expect(jobTag("HAIKREW job=research lang=ts")).toBe("research");
  expect(jobTag("not a header\nHAIKREW job=review")).toBe("");
});

test("gate uses the first matching rule", () => {
  const cfg = { ...section<GateSettings>("gate"), rules: ["type:general=opus", "job:review=sonnet"] };
  const task = { subagentType: "general", prompt: "HAIKREW job=review lang=ts" };
  expect((resolveModel(cfg, task).deny ?? "")).toMatch(/rule type:general=opus/);
  const cfgSonnet = { ...cfg, rules: ["job:review=sonnet", "type:general=haiku"] };
  expect(resolveModel(cfgSonnet, task)).toEqual({ model: "sonnet", rule: "job:review=sonnet" });
});

test("gate keeps a named model unless rules_override is on", () => {
  const cfg = section<GateSettings>("gate");
  const named = { subagentType: "Explore", model: "sonnet" };
  expect(gate(cfg, named, passThrough)).toEqual({ next: named });
  const override = { ...cfg, rules_override: true };
  expect(gate(override, named, passThrough)).toEqual({ next: { ...named, model: "haiku" } });
});

test("gate denies a rule that chooses opus unless allow_opus is on, and names the rule", () => {
  const cfg = { ...section<GateSettings>("gate"), rules: ["type:Explore=opus"] };
  const denied = gate(cfg, { subagentType: "Explore" }, passThrough) as { deny: string };
  expect(denied.deny).toMatch(/Opus/);
  expect(denied.deny).toMatch(/rule type:Explore=opus/);
  expect(gate({ ...cfg, allow_opus: true }, { subagentType: "Explore" }, passThrough))
    .toEqual({ next: { subagentType: "Explore", model: "opus" } });
});

test("gate uses rules before nested_model for nested agents", () => {
  const cfg = { ...section<GateSettings>("gate"), nested_model: "sonnet" };
  expect(gate(cfg, { subagentType: "Explore", parentAgentId: "a1" }, passThrough))
    .toEqual({ next: { subagentType: "Explore", parentAgentId: "a1", model: "haiku" } });
  expect(gate(cfg, { subagentType: "general", parentAgentId: "a1" }, passThrough))
    .toEqual({ next: { subagentType: "general", parentAgentId: "a1", model: "sonnet" } });
});

test("schema rejects a rule that is not job, type or desc with a model", () => {
  expect(validate("gate", "rules", ["job:review=sonnet"])).toBeNull();
  expect(validate("gate", "rules", ["review=sonnet"])).toMatch(/does not match/);
  expect(validate("gate", "rules", ["job:review=gpt"])).toMatch(/does not match/);
  expect(validate("gate", "rules", ["job:review"])).toMatch(/does not match/);
});

test("gate rules match a combined job and language selector, and a cwd folder", () => {
  const cfg = { ...section<GateSettings>("gate"), rules: ["job:review+lang:ts=sonnet", "cwd:~/work/*=opus"] };
  const tsReview = { subagentType: "general", prompt: "HAIKREW job=review lang=ts\nbody" };
  expect(resolveModel(cfg, tsReview)).toEqual({ model: "sonnet", rule: "job:review+lang:ts=sonnet" });
  const swiftReview = { subagentType: "general", prompt: "HAIKREW job=review lang=swift" };
  expect(resolveModel(cfg, swiftReview, "/Users/adrian/work/app/src").deny).toMatch(/cwd:~\/work\/\*=opus/);
  expect(resolveModel({ ...cfg, allow_opus: true }, swiftReview, "/Users/adrian/work/app"))
    .toEqual({ model: "opus", rule: "cwd:~/work/*=opus" });
});

test("gate passes a rule's @effort along and gives instructions to pinned types, not forks", () => {
  const cfg = {
    ...section<GateSettings>("gate"),
    rules: ["job:review=sonnet@high"],
    instructions: ["job:review: Cite file:line.", "type:haiku-coder: Keep it small."],
  };
  const review = { subagentType: "general", prompt: "HAIKREW job=review lang=ts\nbody" };
  expect(resolveModel(cfg, review)).toEqual({ model: "sonnet", rule: "job:review=sonnet@high", effort: "high" });
  expect(gate(cfg, review, passThrough))
    .toEqual({ next: { ...review, model: "sonnet", prompt: review.prompt + "\n\nInstructions from HaiKrew settings:\n- Cite file:line." } });
  const pinned = gate(cfg, { subagentType: "haiku-coder", prompt: "task" }, passThrough) as { next: Input };
  expect(pinned.next).toEqual({ subagentType: "haiku-coder", prompt: "task\n\nInstructions from HaiKrew settings:\n- Keep it small." });
  const fork = { subagentType: "general", prompt: "task", fork: true };
  expect(gate(cfg, { ...fork, model: "sonnet" }, passThrough)).toEqual({ next: { ...fork, model: "sonnet" } });
});

test("effortFor prefers the rule's effort, then a default_effort entry, and is undefined when off", () => {
  const cfg = { ...section<GateSettings>("gate"), default_effort: ["sonnet=high"] };
  expect(effortFor(cfg, { model: "sonnet", effort: "low" }, "claude-sonnet-5-5")).toBe("low");
  expect(effortFor(cfg, { model: "claude-sonnet-5-5" }, "claude-sonnet-5-5")).toBe("high");
  expect(effortFor(cfg, { model: "haiku" }, "haiku")).toBeUndefined();
  expect(effortFor({ ...cfg, enabled: false }, { model: "sonnet", effort: "low" }, "sonnet")).toBeUndefined();
});

test("stepEffort sets the tracked effort only on a subagent step that already has an effort field", () => {
  resetEffort();
  noteEffort("a1", "high");
  expect(stepEffort({ agentId: "a1", effort: "low", tool: "Read" })).toEqual({ agentId: "a1", effort: "high", tool: "Read" });
  expect(stepEffort({ agentId: "a1", tool: "Read" })).toEqual({ agentId: "a1", tool: "Read" });
  expect(stepEffort({ tool: "Read", effort: "low" })).toEqual({ tool: "Read", effort: "low" });
  expect(stepEffort({ agentId: "a2", effort: "low" })).toEqual({ agentId: "a2", effort: "low" });
  resetEffort();
});

test("rules_override keeps a named model when no rule matches", () => {
  const cfg = { ...section<GateSettings>("gate"), rules_override: true, rules: ["job:review=sonnet"] };
  expect(gate(cfg, { subagentType: "general", model: "haiku", prompt: "HAIKREW job=implement" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "haiku", prompt: "HAIKREW job=implement" } });
  expect(gate(cfg, { subagentType: "general", model: "haiku", prompt: "HAIKREW job=review" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "sonnet", prompt: "HAIKREW job=review" } });
});
