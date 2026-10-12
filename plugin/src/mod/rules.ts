/**
 * Gate rules, instructions and effort entries as plain words and back. The stored strings keep their schema format
 * (`job:review+lang:rust=sonnet@high`, `cwd:~/x: text`, `sonnet=high`), so the gate reads them unchanged; the pane
 * shows and builds them as sentences. Pure.
 */
import { parseRule } from "./select.ts";

/** The selector kinds, in the order the pane offers them, with how a sentence names each. */
export const KINDS = [
  { key: "job", label: "Job", phrase: "job is" },
  { key: "lang", label: "Language", phrase: "language is" },
  { key: "type", label: "Agent type", phrase: "agent type is" },
  { key: "desc", label: "Task mentions", phrase: "task mentions" },
  { key: "cwd", label: "Folder", phrase: "folder matches" },
] as const;

export const MODELS = ["haiku", "sonnet", "opus"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** One condition of a selector: its kind and the value it matches. */
export type Condition = { kind: string; value: string };

/** A selector (`job:review+lang:rust`) as its conditions. */
export function conditions(selector: string): Condition[] {
  return selector.split("+").filter(Boolean).map((term) => {
    const at = term.indexOf(":");
    return at < 0 ? { kind: "", value: term } : { kind: term.slice(0, at), value: term.slice(at + 1) };
  });
}

/** Conditions back to a selector: values trimmed, empty ones dropped. */
export function selector(conds: Condition[]): string {
  return conds.map((c) => ({ kind: c.kind, value: c.value.trim() })).filter((c) => c.value !== "")
    .map((c) => `${c.kind}:${c.value}`).join("+");
}

/** Conditions as words: "job is review and language is rust". */
export function phrase(conds: Condition[]): string {
  return conds.map((c) => `${KINDS.find((k) => k.key === c.kind)?.phrase ?? c.kind} ${c.value}`).join(" and ");
}

/** A model name with a capital: sonnet -> Sonnet. */
export function title(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A stored rule as its parts. */
export function readRule(rule: string): { conds: Condition[]; model: string; effort: string } {
  const p = parseRule(rule);
  return { conds: conditions(p.selector), model: p.model, effort: p.effort ?? "" };
}

/** A rule from its parts; `effort` "" leaves the agent's own. */
export function buildRule(conds: Condition[], model: string, effort: string): string {
  return `${selector(conds)}=${model}${effort ? `@${effort}` : ""}`;
}

/** A rule as one sentence: "When job is review → Sonnet, high effort". */
export function ruleSentence(rule: string): string {
  const r = readRule(rule);
  return `When ${phrase(r.conds)} → ${title(r.model)}${r.effort ? `, ${r.effort} effort` : ""}`;
}

/** An instruction entry (`<selector>: <text>`) as its parts. */
export function readInstruction(entry: string): { conds: Condition[]; text: string } {
  const at = entry.indexOf(": ");
  return at < 0 ? { conds: [], text: entry } : { conds: conditions(entry.slice(0, at)), text: entry.slice(at + 2) };
}

/** An instruction entry from its parts. */
export function buildInstruction(conds: Condition[], text: string): string {
  return `${selector(conds)}: ${text.trim()}`;
}

/** The effort a model's subagents get by default, from `default_effort` entries like "sonnet=high"; "" for their own. */
export function effortOf(entries: string[], model: string): string {
  return entries.find((e) => e.startsWith(`${model}=`))?.slice(model.length + 1) ?? "";
}

/** `entries` with the model's default effort set to `effort`, or removed when `effort` is "". Order is kept. */
export function withEffort(entries: string[], model: string, effort: string): string[] {
  const rest = entries.filter((e) => !e.startsWith(`${model}=`));
  return effort ? [...rest, `${model}=${effort}`] : rest;
}

/** The default squeeze patterns by the tool they catch, so the pane can show them as named switches. */
export const SQUEEZE_PRESETS: Array<{ label: string; pattern: string }> = [
  { label: "Cargo (Rust)", pattern: "^(cargo) (test|build|check|clippy)\\b" },
  { label: "Swift", pattern: "^swift (build|test)\\b" },
  { label: "xcodebuild", pattern: "^xcodebuild\\b" },
  { label: "pytest", pattern: "^(pytest|python3? -m pytest)\\b" },
  { label: "npm, pnpm, yarn, bun", pattern: "^(npm|pnpm|yarn|bun) (run )?(test|build)\\b" },
  { label: "Go", pattern: "^go (test|build)\\b" },
  { label: "make", pattern: "^make\\b" },
];
