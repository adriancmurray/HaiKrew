/**
 * The ledger as people read it: per-model results with pass-rate bars, suggested rules, the model/job/language detail
 * and the latest runs (a tab on the terminal, the Track record card on desktop). Every number comes from the
 * stored ledger; nothing is estimated.
 */
import type { Settings } from "../schema.ts";
import { suggestions } from "./advice.ts";
import type { Suggestion } from "./advice.ts";
import { byModel, summary } from "./ledger.ts";
import type { KeyStats, LedgerState, ModelStats, Run } from "./ledger.ts";
import { jobLabel } from "./infer.ts";
import { ruleSentence } from "./rules.ts";
import { table } from "./svg.ts";
import type { Cell, Ink } from "./svg.ts";
import { C, compact, foldCard, when, duration, empty, fit, heading, hexOf, hrow, meter, modelColor, modelName, passColor, textAndControls, txt, vcol, view } from "./ui.ts";
import type { Actions, CardFrame, TimeStyle, Ui } from "./ui.ts";

const RECENT_SHOWN = 8;

export function ledgerTab(ui: Ui, act: Actions, state: LedgerState, settings: Settings, cols: number): unknown[] {
  const { recent, by_key } = summary(state);
  const off = settings.ledger.enabled ? null : txt(ui, { color: C.warn }, OFF_TEXT);
  if (recent.length === 0 && by_key.length === 0) return [off, empty(ui, EMPTY_WHAT, EMPTY_HINT)].filter((x) => x !== null);
  const models = byModel(by_key);
  const total = models.reduce((sum, m) => sum + m.n, 0);
  return [
    off,
    vcol(ui, {}, [heading(ui, "By model", `${total} ${total === 1 ? "run" : "runs"}`), modelHead(ui, cols), ...models.map((m) => modelRow(ui, m, cols))]),
    suggestionBox(act, ui, suggestions(state, settings.gate.rules as string[])),
    vcol(ui, {}, [heading(ui, "By job and language"), detailHead(ui, cols), ...by_key.map((g) => detailRow(ui, g, cols))]),
    vcol(ui, {}, [heading(ui, "Latest runs"), ...recent.slice(0, RECENT_SHOWN).map((r) => runRow(ui, r, cols))]),
  ].filter((x) => x !== null);
}

const OFF_TEXT = "Recording is off, so new runs are not added. Turn it on under Settings › General.";
const EMPTY_WHAT = "No runs recorded yet.";
const EMPTY_HINT = "Each finished subagent adds a run. HaiKrew guesses the job when a spec has no `HAIKREW job=<word> lang=<word>` line; tag it to get rule suggestions for that job.";

/**
 * The desktop's Track record card, folded to one line until opened: how each model is doing, suggested rules,
 * and behind "Details" the per-job table and the latest runs. Tables are SVG drawn with `ink`, the colours for the app's background.
 */
export function recordSection(ui: Ui, act: Actions, frame: CardFrame, state: LedgerState, settings: Settings, width: number, ink: Ink): unknown {
  const { recent, by_key } = summary(state);
  const off = settings.ledger.enabled ? null : txt(ui, { color: C.warn }, OFF_TEXT);
  if (recent.length === 0 && by_key.length === 0) {
    return foldCard(ui, act, frame, "card-record", "Track record", "", EMPTY_WHAT, false,
      [off, txt(ui, {}, EMPTY_WHAT), txt(ui, { dimColor: true }, EMPTY_HINT)].filter((x) => x !== null));
  }
  const models = byModel(by_key);
  const total = models.reduce((sum, m) => sum + m.n, 0);
  const open = Boolean(view.open["record-details"]);
  const svgOf = (source: string, alt: string): unknown => ui.Svg({ source, alt });
  const tips = suggestions(state, settings.gate.rules as string[]);
  const folded = models.slice(0, 3).map((m) => `${modelName(m.model)} passed ${pct(m.pass_rate)} of ${m.n}`).join(" · ") +
    (tips.length ? ` · ${tips.length} ${tips.length === 1 ? "suggestion" : "suggestions"}` : "");
  return foldCard(ui, act, frame, "card-record", "Track record", `${total} ${total === 1 ? "run" : "runs"} so far`, folded, false, [
    off,
    svgOf(modelTable(models, width, ink), "Runs, pass rate, tokens and time per model"),
    suggestionBox(act, ui, tips),
    hrow(ui, {}, [ui.Button({ key: "record-details", label: open ? "▾ Details" : "▸ Details by job and latest runs",
      onPress: () => {
        view.open["record-details"] = !open;
        act.redraw();
      } })]),
    open ? txt(ui, { bold: true }, "By job and language") : null,
    open ? svgOf(detailTable(by_key, width, ink), "Runs and pass rate per model, job and language") : null,
    open ? txt(ui, { bold: true }, "Latest runs") : null,
    open ? svgOf(runTable(recent.slice(0, RECENT_SHOWN), width, ink, settings.pane.time_style as TimeStyle), "The latest runs") : null,
  ].filter((x) => x !== null));
}

/** Bars are drawn when the pane is wide enough; below that the pass rate is a coloured number alone. */
function barWidth(cols: number): number {
  return cols >= 60 ? 10 : 0;
}

function modelHead(ui: Ui, cols: number): unknown {
  const pass = fit("Pass", barWidth(cols) ? barWidth(cols) + 6 : 5);
  return txt(ui, { dimColor: true }, `${fit("Model", 12)} ${"Runs".padStart(5)}  ${pass}${"Tokens".padStart(8)} ${"Time".padStart(8)}`);
}

function modelRow(ui: Ui, m: ModelStats, cols: number): unknown {
  const bw = barWidth(cols);
  return hrow(ui, {}, [
    txt(ui, { color: modelColor(m.model) }, "● "),
    txt(ui, {}, fit(modelName(m.model), 10)),
    txt(ui, {}, ` ${String(m.n).padStart(5)}  `),
    bw ? meter(ui, m.pass_rate, bw, passColor(m.pass_rate)) : null,
    txt(ui, { color: passColor(m.pass_rate) }, `${bw ? " " : ""}${pct(m.pass_rate).padStart(4)} `),
    txt(ui, {}, `${(lowerBound(m.estimated_runs > 0) + compact(m.tokens_mean)).padStart(8)} ${duration(m.duration_mean).padStart(8)}`),
  ]);
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "≥" in front of a token count that includes transcript-counted output, which is only a lower bound. */
function lowerBound(estimated: boolean): string {
  return estimated ? "≥" : "";
}

/** Suggestions in an amber box, each with an Add rule button that adds nothing until pressed twice. */
function suggestionBox(act: Actions, ui: Ui, list: Suggestion[]): unknown {
  if (list.length === 0) return null;
  return vcol(ui, { borderStyle: "round", borderColor: C.warn, paddingX: 2, paddingY: 1, rowGap: 1 }, [
    txt(ui, { bold: true, color: C.warn }, "Worth a look"),
    ...list.map((s, i) => vcol(ui, {}, [
      txt(ui, {}, `${s.text}.`),
      textAndControls(ui, [txt(ui, { dimColor: true, wrap: "wrap" }, s.kind === "down" ? `Try a cheaper model: ${ruleSentence(s.rule)}${s.replaces ? " (replaces the current rule)" : ""}`
        : `Send it to a stronger model: ${ruleSentence(s.rule)}`)], [
        ui.Button({
          key: `suggest-${i}`, ...(view.armed === s.rule ? { variant: "primary" } : {}),
          label: view.armed === s.rule ? "Press again to add" : "Add rule",
          onPress: () => addSuggestion(act, s.rule, s.replaces),
        }),
      ]),
    ])),
  ]);
}

/** The first press arms the rule; a second press on the same armed rule puts it first in the gate rules. */
async function addSuggestion(act: Actions, rule: string, replaces?: string): Promise<void> {
  if (view.armed !== rule) {
    view.armed = rule;
    act.redraw();
    return;
  }
  view.armed = "";
  await act.addRule(rule, replaces);
}

/** Job and language columns share what the fixed columns leave. */
function detailWidths(cols: number): { job: number; lang: number } {
  const free = Math.max(12, cols - 12 - 6 - 6 - 6 - 8 - 5);
  return { job: Math.ceil(free * 0.6), lang: Math.floor(free * 0.4) };
}

function detailHead(ui: Ui, cols: number): unknown {
  const w = detailWidths(cols);
  return txt(ui, { dimColor: true, wrap: "truncate-end" },
    `${fit("Model", 12)}${fit("Job", w.job)}${fit("Lang", w.lang)}${"Runs".padStart(6)}${"Pass".padStart(6)}${"Qual".padStart(6)}${"Tokens".padStart(8)}`);
}

function detailRow(ui: Ui, g: KeyStats, cols: number): unknown {
  const w = detailWidths(cols);
  const rate = Number(g.pass_rate);
  return hrow(ui, {}, [
    txt(ui, { color: modelColor(String(g.model)) }, fit(modelName(String(g.model)), 12)),
    txt(ui, {}, fit(jobLabel(String(g.job)), w.job) + fit(String(g.lang), w.lang) + String(g.n).padStart(6)),
    txt(ui, { color: passColor(rate) }, pct(rate).padStart(6)),
    txt(ui, {}, Number(g.quality_mean).toFixed(2).padStart(6)),
    txt(ui, { dimColor: true }, (lowerBound(Number(g.estimated_runs) > 0) + compact(Number(g.tokens_in_mean) + Number(g.tokens_out_mean))).padStart(8)),
  ]);
}

/** A verdict's mark and colour: pass green, fail or blocked red, anything else dim. */
function verdictMark(verdict: string): [string, string] {
  if (verdict === "pass") return ["✓", C.ok];
  if (verdict === "fail" || verdict === "blocked") return ["✗", C.bad];
  return ["·", C.muted];
}

function runRow(ui: Ui, r: Run, cols: number): unknown {
  const [mark, color] = verdictMark(r.verdict);
  const when = r.ts.slice(5, 16).replace("T", " ");
  const what = `${jobLabel(r.job)}/${r.lang}`;
  const tail = `${duration(r.duration_s)} · ${lowerBound(r.tokens_estimated)}${compact(r.tokens_in + r.tokens_out)} tok`;
  return hrow(ui, { columnGap: 1 }, [
    txt(ui, { color }, mark),
    txt(ui, { dimColor: true }, when),
    txt(ui, { color: modelColor(r.model) }, fit(modelName(r.model), 10)),
    txt(ui, { wrap: "truncate-end" }, fit(what, Math.max(8, cols - 48))),
    txt(ui, { dimColor: true }, `${r.verdict} · ${tail}`),
  ]);
}

/** Per-model rows: name, runs, pass-rate bar, mean tokens and time per run, each with a tooltip. */
function modelTable(models: ModelStats[], width: number, ink: Ink): string {
  return table([
    { label: "Model", share: 24 }, { label: "Runs", share: 10, end: true }, { label: "Pass rate", share: 38 },
    { label: "Tokens/run", share: 15, end: true }, { label: "Time/run", share: 13, end: true },
  ], models.map((m): Cell[] => [
    { dot: modelColor(m.model), text: modelName(m.model) }, { text: String(m.n) },
    { bar: m.pass_rate, color: hexOf(passColor(m.pass_rate)), label: pct(m.pass_rate) },
    { text: lowerBound(m.estimated_runs > 0) + compact(m.tokens_mean) }, { text: duration(m.duration_mean), muted: true },
  ]), width, models.map((m) => `${modelName(m.model)}: ${m.n} runs, ${pct(m.pass_rate)} passed, ` +
    `${lowerBound(m.estimated_runs > 0)}${Math.round(m.tokens_mean).toLocaleString("en-US")} tokens and ${duration(m.duration_mean)} per run on average`), ink);
}

/** Model, job and language groups with runs, pass rate and mean tokens. */
function detailTable(groups: KeyStats[], width: number, ink: Ink): string {
  return table([
    { label: "Model", share: 22 }, { label: "Job", share: 18 }, { label: "Lang", share: 13 }, { label: "Runs", share: 8, end: true },
    { label: "Pass rate", share: 27 }, { label: "Tokens/run", share: 12, end: true },
  ], groups.map((g): Cell[] => [
    { dot: modelColor(String(g.model)), text: modelName(String(g.model)) }, { text: jobLabel(String(g.job)) }, { text: String(g.lang), muted: true },
    { text: String(g.n) }, { bar: Number(g.pass_rate), color: hexOf(passColor(Number(g.pass_rate))), label: pct(Number(g.pass_rate)) },
    { text: lowerBound(Number(g.estimated_runs) > 0) + compact(Number(g.tokens_in_mean) + Number(g.tokens_out_mean)), muted: true },
  ]), width, groups.map((g) => `${jobLabel(String(g.job))} ${g.lang} on ${modelName(String(g.model))}: ${g.n} runs, mean quality ${Number(g.quality_mean).toFixed(2)}`), ink);
}

/** The latest runs: verdict, when, model, job and language, time and tokens. */
function runTable(runs: Run[], width: number, ink: Ink, style: TimeStyle): string {
  const now = Date.now();
  return table([
    { label: "", share: 5 }, { label: "When", share: 18 }, { label: "Model", share: 22 }, { label: "Job / lang", share: 29 },
    { label: "Time", share: 12, end: true }, { label: "Tokens", share: 14, end: true },
  ], runs.map((r): Cell[] => {
    const [mark, color] = verdictMark(r.verdict);
    return [{ text: mark, bold: true, color: hexOf(color) }, { text: when(r.ts, now, style), muted: true },
      { dot: modelColor(r.model), text: modelName(r.model) }, { text: `${jobLabel(r.job)} / ${r.lang}` },
      { text: duration(r.duration_s), muted: true }, { text: lowerBound(r.tokens_estimated) + compact(r.tokens_in + r.tokens_out), muted: true }];
  }), width, runs.map((r) => `${r.agent_type || "agent"}: ${r.verdict}, ${r.tool_calls} tool calls, ${r.attempts} attempts`), ink);
}
