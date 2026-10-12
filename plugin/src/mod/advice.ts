/**
 * Rules the pane offers from the ledger, both ways: a job that keeps failing on a model is sent one model up, and
 * a job a stronger model passes nearly every time is offered one model down, where the token savings are. Only
 * tagged jobs are judged (the gate reads tags, so an inferred job could never match a rule). Writes nothing. Pure.
 */
import { summary } from "./ledger.ts";
import type { KeyStats, LedgerState } from "./ledger.ts";

/** A rule the pane offers, the line that explains it, which way it moves, and the rule it would replace, if any. */
export type Suggestion = { rule: string; text: string; kind: "up" | "down"; replaces?: string };

const UP_MIN_RUNS = 4;
const UP_PASS_BELOW = 0.6;
const DOWN_MIN_RUNS = 8;
const DOWN_PASS_FROM = 0.9;
const ORDER = ["haiku", "sonnet", "opus"];

/** 'haiku', 'sonnet' or 'opus' when the model name contains one, else ''. */
export function family(model: string): string {
  return ORDER.find((f) => model.toLowerCase().includes(f)) ?? "";
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The selector a group's rule would use: job, and language when known. */
function selectorOf(job: string, lang: string): string {
  return "job:" + job + (lang && lang !== "unknown" ? "+lang:" + lang : "");
}

/** "implement rust on Haiku", the group as words. */
function groupWords(job: string, lang: string, fam: string): string {
  return job + " " + (lang && lang !== "unknown" ? lang + " " : "") + "on " + capitalize(fam);
}

/**
 * Suggestions for the ledger under the current rules. Up: a tagged group with four or more runs passing under 60%
 * on Haiku or Sonnet, when no rule has its selector yet. Down: a tagged group with eight or more runs passing 90% or
 * more on Sonnet or Opus, unless the model below has four or more runs of the same job passing under 60%; it
 * replaces the rule with that selector when there is one.
 */
export function suggestions(state: LedgerState, rules: string[]): Suggestion[] {
  const groups = summary(state).by_key;
  const out: Suggestion[] = [];
  const ruleFor = (selector: string): string | undefined => rules.find((r) => r.slice(0, r.lastIndexOf("=")) === selector);
  const poorBelow = (g: KeyStats, fam: string): boolean => groups.some((o) => o.job === g.job && o.lang === g.lang &&
    family(String(o.model)) === fam && Number(o.n) >= UP_MIN_RUNS && Number(o.pass_rate) < UP_PASS_BELOW);
  for (const g of groups) {
    const n = Number(g.n);
    const job = String(g.job);
    const lang = String(g.lang);
    const fam = family(String(g.model));
    if (job === "" || job === "unknown" || job.startsWith("~") || fam === "") continue;
    const at = ORDER.indexOf(fam);
    const pct = Math.round(Number(g.pass_rate) * 100);
    const selector = selectorOf(job, lang);
    if (n >= UP_MIN_RUNS && Number(g.pass_rate) < UP_PASS_BELOW && at < ORDER.length - 1 && !ruleFor(selector)) {
      out.push({ kind: "up", rule: selector + "=" + ORDER[at + 1], text: groupWords(job, lang, fam) + " passed " + pct + "% of " + n + " runs" });
    } else if (n >= DOWN_MIN_RUNS && Number(g.pass_rate) >= DOWN_PASS_FROM && at > 0 && !poorBelow(g, ORDER[at - 1])) {
      const lower = ORDER[at - 1];
      const current = ruleFor(selector);
      if (current && current.slice(current.lastIndexOf("=") + 1).split("@")[0] === lower) continue;
      const effort = current && current.includes("@") ? current.slice(current.lastIndexOf("@")) : "";
      out.push({ kind: "down", rule: selector + "=" + lower + effort, replaces: current,
        text: groupWords(job, lang, fam) + " passed " + pct + "% of " + n + " runs; " + capitalize(lower) + " might do and costs less" });
    }
  }
  return out;
}
