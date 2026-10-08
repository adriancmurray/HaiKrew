/**
 * Agent gate, run on `agent.spawn` before a subagent starts: gives an agent with no model a model (from the first
 * matching rule, else the default for its depth), refuses Opus unless allowed, and decides whether a subagent may
 * start agents of its own (a nested spawn, which Claude Code marks with `parentAgentId`).
 */
import type { Input, Next } from "./api.ts";

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
};

/**
 * What the gate decides for one spawn: a deny reason, a model to inject, or neither (leave the spawn alone).
 * `rule` is the rule text that chose `model`, when a rule did.
 */
export type Choice = { deny?: string; model?: string; rule?: string };

/** The job tag on the first line of a prompt (`HAIKREW job=<word> ...`), or "" when the line has none. */
export function jobTag(prompt: unknown): string {
  const first = String(prompt ?? "").split("\n")[0];
  return /^HAIKREW\s.*\bjob=(\S+)/.exec(first)?.[1] ?? "";
}

/** The model and text of the first rule that matches the spawn, or null. Rules are validated by the schema. */
function matchRule(rules: string[], e: Input): { model: string; rule: string } | null {
  const job = jobTag(e.prompt);
  const type = String(e.subagentType ?? "");
  const desc = String(e.description ?? "").toLowerCase();
  for (const rule of rules) {
    const eq = rule.lastIndexOf("=");
    const selector = rule.slice(0, eq);
    const colon = selector.indexOf(":");
    const kind = selector.slice(0, colon);
    const value = selector.slice(colon + 1);
    const hit = kind === "job" ? job === value
      : kind === "type" ? type === value
      : desc.includes(value.toLowerCase());
    if (hit) return { model: rule.slice(eq + 1), rule };
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
export function resolveModel(cfg: GateSettings, e: Input): Choice {
  if (!cfg.enabled || e.fork) return {};
  const nested = Boolean(e.parentAgentId);
  if (nested && !cfg.allow_nested) {
    return { deny: "Subagents can't start agents of their own here. Do the work yourself, or set " +
      "gate.allow_nested to true in haikrew settings." };
  }
  if (cfg.pinned_types.includes(String(e.subagentType))) return {};
  const named = Boolean(e.model);
  if (named && !cfg.rules_override) {
    return String(e.model).includes("opus") && !cfg.allow_opus ? { deny: opusDenial(undefined) } : {};
  }
  const hit = matchRule(cfg.rules, e);
  const model = hit?.model ?? (nested ? cfg.nested_model : cfg.default_model);
  if (model.includes("opus") && !cfg.allow_opus) return { deny: opusDenial(hit?.rule) };
  return { model, rule: hit?.rule };
}

/** Reply for one spawn: next(e) with the model injected, next(e) unchanged, or {deny}. */
export function gate(cfg: GateSettings, e: Input, next: Next): unknown {
  const choice = resolveModel(cfg, e);
  if (choice.deny) return { deny: choice.deny };
  return next(choice.model ? { ...e, model: choice.model } : e);
}
