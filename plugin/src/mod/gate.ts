/**
 * Agent gate, run on `agent.spawn` before a subagent starts: gives an agent with no model a model (from the first
 * matching rule, else the default for its depth), refuses Opus unless allowed, and decides whether a subagent may
 * start agents of its own (a nested spawn, which Claude Code marks with `parentAgentId`).
 */
import type { Input, Next } from "./api.ts";
import { ctxFrom, instructionsFor, parseRule, selectorMatch, tag, withInstructions } from "./select.ts";
import type { SelectCtx } from "./select.ts";

/** The `gate` section of settings. */
export type GateSettings = {
  enabled: boolean;
  default_model: string;
  allow_opus: boolean;
  pinned_types: string[];
  allow_nested: boolean;
  nested_model: string;
  rules: string[];
  rules_override: boolean;
  default_effort: string[];
  instructions: string[];
};

/**
 * What the gate decides for one spawn: a deny reason, a model to inject, or neither (leave the spawn alone).
 * `rule` is the rule text that chose `model`, when a rule did, and `effort` is that rule's `@effort`, if any.
 */
export type Choice = { deny?: string; model?: string; rule?: string; effort?: string };

/** The job tag on the first line of a prompt (`HAIKREW job=<word> ...`), or "" when the line has none. */
export function jobTag(prompt: unknown): string {
  return tag(prompt, "job");
}

/** The model, effort and text of the first rule that matches the spawn, or null. Rules are validated by the schema. */
function matchRule(rules: string[], ctx: SelectCtx): { model: string; effort?: string; rule: string } | null {
  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (selectorMatch(parsed.selector, ctx)) return { model: parsed.model, effort: parsed.effort, rule };
  }
  return null;
}

/** The deny reason for an Opus model, naming the rule when a rule chose it. */
function opusDenial(rule: string | undefined): string {
  const why = rule ? `Opus subagents are turned off (rule ${rule} chose it). ` : "Opus subagents are turned off. ";
  return why + "Use model haiku or sonnet, or set gate.allow_opus to true in haikrew settings.";
}

/**
 * Which model a spawn gets, or why it is refused. A named model is kept unless rules_override is on; otherwise
 * the first matching rule decides, then nested_model (nested) or default_model. The Opus check runs on the result.
 */
export function resolveModel(cfg: GateSettings, e: Input, cwd = ""): Choice {
  if (!cfg.enabled || e.fork) return {};
  const nested = Boolean(e.parentAgentId);
  if (nested && !cfg.allow_nested) {
    return { deny: "Subagents can't start agents of their own here. Do the work yourself, or set " +
      "gate.allow_nested to true in haikrew settings." };
  }
  if (cfg.pinned_types.includes(String(e.subagentType))) return {};
  const named = Boolean(e.model);
  const hit = named && !cfg.rules_override ? undefined : matchRule(cfg.rules, ctxFrom(e, cwd));
  // A caller-named model stands unless a rule matched and rules_override lets it replace the name.
  if (named && !hit) {
    return String(e.model).includes("opus") && !cfg.allow_opus ? { deny: opusDenial(undefined) } : {};
  }
  const model = hit?.model ?? (nested ? cfg.nested_model : cfg.default_model);
  if (model.includes("opus") && !cfg.allow_opus) return { deny: opusDenial(hit?.rule) };
  const choice: Choice = { model };
  if (hit) {
    choice.rule = hit.rule;
    if (hit.effort) choice.effort = hit.effort;
  }
  return choice;
}

/**
 * The effort to pass with a spawn: the matched rule's `@effort`, else the first default_effort entry whose model
 * is contained in `model` (so "sonnet=high" fits "claude-sonnet-5-5"), else undefined. Undefined when the gate is off.
 */
export function effortFor(cfg: GateSettings, choice: Choice, model: string): string | undefined {
  if (!cfg.enabled) return undefined;
  if (choice.effort) return choice.effort;
  for (const entry of cfg.default_effort) {
    const eq = entry.lastIndexOf("=");
    if (model.includes(entry.slice(0, eq))) return entry.slice(eq + 1);
  }
  return undefined;
}

/**
 * Reply for one spawn: next(e) with the model injected and instructions appended to the prompt, next(e) unchanged,
 * or {deny}. Instructions apply even to pinned types, but not to forks.
 */
export function gate(cfg: GateSettings, e: Input, next: Next, cwd = ""): unknown {
  const choice = resolveModel(cfg, e, cwd);
  if (choice.deny) return { deny: choice.deny };
  let passed = choice.model ? { ...e, model: choice.model } : e;
  if (cfg.enabled && !e.fork) {
    const texts = instructionsFor(cfg.instructions, ctxFrom(e, cwd));
    if (texts.length > 0) passed = { ...passed, prompt: withInstructions(String(e.prompt ?? ""), texts) };
  }
  return next(passed);
}
