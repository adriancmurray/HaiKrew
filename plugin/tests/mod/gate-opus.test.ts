/** Mod tests for the gate's Opus refusal on pinned types, forks and any case, and the agent tools' refusals of gate settings. */
import { expect, test } from "claude-code/testing";
import { effortFor, gate, resolveModel } from "../../src/mod/gate.ts";
import type { GateSettings } from "../../src/mod/gate.ts";
import { answer } from "../../src/mod/agents.ts";
import type { Input } from "../../src/mod/api.ts";
import { defaults } from "../../src/schema.ts";

const passThrough = (e: Input) => ({ next: e });

/** The gate settings at their schema default, turned on. */
function gateOn(): GateSettings {
  return { ...defaults().gate, enabled: true } as unknown as GateSettings;
}

/** The deny reason of a gate reply, or "" when the reply passed the spawn on. */
function denial(reply: unknown): string {
  return (reply as { deny?: string }).deny ?? "";
}

test("a named Opus model on a pinned type is refused while Opus is off", () => {
  const cfg = gateOn();
  expect(denial(gate(cfg, { subagentType: "haiku-coder", model: "opus" }, passThrough))).toMatch(/Opus/);
  expect(denial(gate(cfg, { subagentType: "haikrew:haiku-coder", model: "claude-opus-5-5" }, passThrough))).toMatch(/Opus/);
  expect(gate(cfg, { subagentType: "haiku-coder", model: "sonnet" }, passThrough))
    .toEqual({ next: { subagentType: "haiku-coder", model: "sonnet" } });
  expect(gate(cfg, { subagentType: "haiku-coder" }, passThrough)).toEqual({ next: { subagentType: "haiku-coder" } });
  expect(gate({ ...cfg, allow_opus: true }, { subagentType: "haiku-coder", model: "opus" }, passThrough))
    .toEqual({ next: { subagentType: "haiku-coder", model: "opus" } });
});

test("a fork that names an Opus model is refused, and a fork that names none inherits the parent's model", () => {
  const cfg = gateOn();
  expect(denial(gate(cfg, { subagentType: "general", fork: true, model: "opus" }, passThrough))).toMatch(/Opus/);
  expect(gate(cfg, { subagentType: "general", fork: true }, passThrough))
    .toEqual({ next: { subagentType: "general", fork: true } });
  expect(gate(cfg, { subagentType: "general", fork: true, model: "sonnet" }, passThrough))
    .toEqual({ next: { subagentType: "general", fork: true, model: "sonnet" } });
  expect(gate({ ...cfg, allow_opus: true }, { subagentType: "general", fork: true, model: "opus" }, passThrough))
    .toEqual({ next: { subagentType: "general", fork: true, model: "opus" } });
});

test("the Opus check ignores case, for a named model on any agent", () => {
  const cfg = gateOn();
  for (const model of ["Opus", "OPUS", "claude-OPUS-5-5"]) {
    expect(denial(gate(cfg, { subagentType: "general", model }, passThrough))).toMatch(/Opus/);
    expect(denial(gate(cfg, { subagentType: "haiku-coder", model }, passThrough))).toMatch(/Opus/);
  }
  expect(resolveModel({ ...cfg, allow_opus: true }, { subagentType: "general", model: "Opus" })).toEqual({});
});

test("rules_override still lets a rule replace a named Opus model when Opus is off", () => {
  const cfg = { ...gateOn(), rules_override: true, rules: ["job:review=haiku"] };
  expect(resolveModel(cfg, { subagentType: "general", model: "opus", prompt: "HAIKREW job=review" }))
    .toEqual({ model: "haiku", rule: "job:review=haiku" });
});

test("effortFor matches a default_effort model whatever the case of the model name", () => {
  const cfg = { ...gateOn(), default_effort: ["sonnet=high"] };
  expect(effortFor(cfg, {}, "claude-SONNET-5-5")).toBe("high");
});

test("agents cannot change gate.enabled, gate.pinned_types or gate.rules_override", () => {
  const settings = defaults();
  expect(answer("set_setting", { section: "gate", key: "enabled", value: false }, settings)).toEqual({
    ok: false, reason: "Only the person can change gate.enabled, in /haikrew: Settings › Routing.",
  });
  expect(answer("set_setting", { section: "gate", key: "pinned_types", value: [] }, settings)).toEqual({
    ok: false, reason: "Only the person can change gate.pinned_types, in /haikrew: Settings › Routing.",
  });
  expect(answer("set_setting", { section: "gate", key: "rules_override", value: true }, settings)).toEqual({
    ok: false, reason: "Only the person can change gate.rules_override, in /haikrew: Settings › Routing.",
  });
});

test("agents still cannot turn Opus on or change agents, and can change other gate settings", () => {
  const settings = defaults();
  expect(answer("set_setting", { section: "gate", key: "allow_opus", value: true }, settings)).toEqual({
    ok: false, reason: "Only the person can allow Opus, in /haikrew: Settings › Routing.",
  });
  expect(answer("set_setting", { section: "agents", key: "control", value: "change" }, settings)).toEqual({
    ok: false, reason: "Agent control is the person's setting; agents cannot change it.",
  });
  expect(answer("set_setting", { section: "gate", key: "default_model", value: "sonnet" }, settings).ok).toBe(true);
});
