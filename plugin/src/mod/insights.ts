/**
 * Routing insights from the ledger: how the decider's picks held up against what ran, which routing rules the outcomes
 * would support, and the few findings worth a look. Pure: the current routing comes in as a value. Every number is
 * counted from the runs. A model in a job and language is only acted on with MIN_JUDGED judged runs of its own.
 */
import type { Settings } from "../schema.ts";
import { modelFamily } from "./crew.ts";
import type { Run } from "./ledger.ts";
import { lateFailed, MODEL_ORDER, outcomeStats, rankOf } from "./outcomes.ts";
import type { OutcomeRow } from "./outcomes.ts";
import { buildRule } from "./rules.ts";
import { parseRule, selectorMatch } from "./select.ts";
import type { SelectCtx } from "./select.ts";

/** The fewest judged runs a model needs in a job and language before a rule is proposed for it. */
export const MIN_JUDGED = 8;
/** The pass rate a model needs in a job and language to be proposed for it. */
export const MIN_SUCCESS = 0.8;
const FINDINGS_MAX = 5;

/** The routing the proposals are checked against: the gate's rules, its default model, and whether Opus may be routed to. */
export type Routing = { rules: string[]; defaultModel: string; allowOpus: boolean };

/**
 * Decided runs with a verdict. `over`: the decider picked a bigger model than the one that ran, and it passed.
 * `under`: the decider picked Haiku, Haiku ran, and it failed or failed late.
 */
export type Calibration = { judged: number; over: number; under: number };

/** A routing rule the outcomes support, with the evidence in words. */
export type ProposedRule = {
  rule: string; job: string; lang: string; model: string; current: string; passed: number; judged: number; evidence: string;
};

/** A one-line finding and the number of runs it rests on. */
export type Finding = { text: string; count: number };

export type Insights = { judged: number; calibration: Calibration; rules: ProposedRule[]; findings: Finding[] };

/** The routing the gate would apply: the rules and default from settings. */
export function routingFrom(settings: Settings): Routing {
  return {
    rules: settings.gate.rules as string[],
    defaultModel: String(settings.gate.default_model),
    allowOpus: Boolean(settings.gate.allow_opus),
  };
}

/** The model the current rules give a task with this job and language: the first rule whose conditions hold, else the default. */
export function currentPick(rules: string[], defaultModel: string, job: string, lang: string): string {
  const ctx: SelectCtx = { job, lang, type: "", desc: "", cwd: "" };
  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (selectorMatch(parsed.selector, ctx)) return parsed.model;
  }
  return defaultModel;
}

/** The decider's answers checked against what ran, over the runs that have a decision and a verdict. */
function calibrate(runs: Run[]): Calibration {
  const out: Calibration = { judged: 0, over: 0, under: 0 };
  for (const run of runs) {
    const picked = modelFamily(run.decision?.model ?? "");
    const ran = modelFamily(run.model);
    const judged = run.verdict === "pass" || run.verdict === "fail";
    if (picked === "unknown" || !judged) continue;
    out.judged += 1;
    // A pick of a bigger model than the one that ran; the smaller one passing means the pick was too big.
    if (rankOf(ran) >= 0 && rankOf(picked) > rankOf(ran) && run.verdict === "pass") out.over += 1;
    // Haiku was picked and ran, and it failed or failed late. The pick and the run agree here, so this does not need them to differ.
    if (picked === "haiku" && ran === "haiku" && (run.verdict === "fail" || lateFailed(run))) out.under += 1;
  }
  return out;
}

type Cell = { passed: number; judged: number };

/** Pass counts per model for each job and language, from the outcome rows (sizes added together). */
function byBucket(rows: OutcomeRow[]): Map<string, Map<string, Cell>> {
  const out = new Map<string, Map<string, Cell>>();
  for (const row of rows) {
    const key = JSON.stringify([row.job, row.lang]);
    const models = out.get(key) ?? new Map<string, Cell>();
    const cell = models.get(row.model) ?? { passed: 0, judged: 0 };
    cell.passed += row.passed;
    cell.judged += row.judged;
    models.set(row.model, cell);
    out.set(key, models);
  }
  return out;
}

/** The cheapest model that passes at least MIN_SUCCESS of its judged runs here, with MIN_JUDGED of its own; Opus only when allowed. */
function cheapestPassing(models: Map<string, Cell>, allowOpus: boolean): { model: string; cell: Cell } | null {
  for (const model of MODEL_ORDER) {
    const cell = models.get(model);
    if (!cell || (model === "opus" && !allowOpus) || cell.judged < MIN_JUDGED) continue;
    if (cell.passed / cell.judged >= MIN_SUCCESS) return { model, cell };
  }
  return null;
}

/** A rule per job and language whose cheapest passing model differs from what the current rules would pick. */
function proposeRules(rows: OutcomeRow[], routing: Routing): ProposedRule[] {
  const out: ProposedRule[] = [];
  for (const [key, models] of byBucket(rows)) {
    const [job, lang] = JSON.parse(key) as [string, string];
    // A rule on a job or language nobody tagged would match nothing useful.
    if (job === "" || lang === "" || job === "unknown" || lang === "unknown") continue;
    const pick = cheapestPassing(models, routing.allowOpus);
    if (!pick) continue;
    const current = currentPick(routing.rules, routing.defaultModel, job, lang);
    if (current === pick.model) continue;
    const rule = buildRule([{ kind: "job", value: job }, { kind: "lang", value: lang }], pick.model, "");
    out.push({ rule, job, lang, model: pick.model, current, passed: pick.cell.passed, judged: pick.cell.judged,
      evidence: `${pick.model} passed ${pick.cell.passed} of ${pick.cell.judged} judged runs` });
  }
  return out.sort((a, b) => b.judged - a.judged || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}

/** The findings with the most runs behind them, at most FINDINGS_MAX, most evidence first. Empty counts are left out. */
function findingsOf(rows: OutcomeRow[], cal: Calibration, rules: ProposedRule[]): Finding[] {
  const late = rows.reduce((n, r) => n + r.late_fail, 0);
  const escalations = rows.reduce((n, r) => n + r.escalations, 0);
  const found: Finding[] = [
    { text: `Clef picked a bigger model where a smaller one passed, in ${cal.over} decided runs`, count: cal.over },
    { text: `Clef picked Haiku and Haiku failed, in ${cal.under} decided runs`, count: cal.under },
    { text: `${escalations} runs were re-run on a bigger model`, count: escalations },
    { text: `${late} runs were marked as late failures`, count: late },
    ...rules.map((r) => ({ text: `${r.evidence} on ${r.job} / ${r.lang}; the current rules pick ${r.current}`, count: r.judged })),
  ];
  return found.filter((f) => f.count > 0).sort((a, b) => b.count - a.count).slice(0, FINDINGS_MAX);
}

/** Calibration, proposed routing rules and findings for the runs, against the current routing. */
export function insights(runs: Run[], routing: Routing): Insights {
  const rows = outcomeStats(runs);
  const calibration = calibrate(runs);
  const rules = proposeRules(rows, routing);
  return {
    judged: rows.reduce((n, r) => n + r.judged, 0),
    calibration,
    rules,
    findings: findingsOf(rows, calibration, rules),
  };
}
