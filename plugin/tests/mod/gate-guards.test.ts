/** Mod tests for the agent gate and the tool guards: plain functions, called with a fake next and fake $. */
import { expect, test } from "claude-code/testing";
import { gate, jobTag, resolveModel } from "../../src/mod/gate.ts";
import type { GateSettings } from "../../src/mod/gate.ts";
import { readGuard, squeeze } from "../../src/mod/guards.ts";
import type { ReadGuardSettings, SqueezeSettings } from "../../src/mod/guards.ts";
import type { Input } from "../../src/mod/api.ts";
import { defaults, validate } from "../../src/schema.ts";

const passThrough = (e: Input) => ({ next: e });
const ROOT = "/plugins/haikrew";

/** One settings section at its schema default. */
function section<T>(name: string): T {
  return defaults()[name] as unknown as T;
}

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

test("rules_override keeps a named model when no rule matches", () => {
  const cfg = { ...section<GateSettings>("gate"), rules_override: true, rules: ["job:review=sonnet"] };
  expect(gate(cfg, { subagentType: "general", model: "haiku", prompt: "HAIKREW job=implement" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "haiku", prompt: "HAIKREW job=implement" } });
  expect(gate(cfg, { subagentType: "general", model: "haiku", prompt: "HAIKREW job=review" }, passThrough))
    .toEqual({ next: { subagentType: "general", model: "sonnet", prompt: "HAIKREW job=review" } });
});
