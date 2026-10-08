/**
 * Agent gate, run on `agent.spawn` before a subagent starts: gives an agent with no model the default model,
 * refuses Opus unless allowed, and decides whether a subagent may start agents of its own (a nested spawn,
 * which Claude Code marks with `parentAgentId`) and which model those get.
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
};

/** Reply for one spawn: next(e) with the model injected, next(e) unchanged, or {deny}. */
export function gate(cfg: GateSettings, e: Input, next: Next): unknown {
  if (!cfg.enabled || e.fork) return next(e);
  const nested = Boolean(e.parentAgentId);
  if (nested && !cfg.allow_nested) {
    return { deny: "Subagents can't start agents of their own here. Do the work yourself, or set " +
      "gate.allow_nested to true in haikrew settings." };
  }
  if (cfg.pinned_types.includes(String(e.subagentType))) return next(e);
  if (String(e.model ?? "").includes("opus") && !cfg.allow_opus) {
    return { deny: "Opus subagents are turned off. Use model haiku or sonnet, or set " +
      "gate.allow_opus to true in haikrew settings." };
  }
  if (!e.model) return next({ ...e, model: nested ? cfg.nested_model : cfg.default_model });
  return next(e);
}
