/**
 * Token lines for Home on the terminal: this session's context and rate limits as meters (from the session usage), then subagent tokens
 * per model from the ledger, each bar scaled to the model that used the most.
 */
import { tokenTotals } from "./ledger.ts";
import type { LedgerState } from "./ledger.ts";
import { compact, empty, fillColor, fit, heading, hrow, meter, modelColor, modelName, thousands, when, txt, vcol } from "./ui.ts";
import type { Ui } from "./ui.ts";

/** The parts of the session usage record the tab reads; any may be missing. */
export type Usage = Record<string, any>;

export function tokensTab(ui: Ui, usage: Usage, ledger: LedgerState, cols: number): unknown[] {
  const ctx: Usage = usage.context ?? {};
  const bw = Math.max(10, Math.min(30, cols - 40));
  const used = Number(ctx.tokens ?? 0);
  const window = Number(ctx.window ?? 0);
  const percent = Number(ctx.percent ?? 0);
  const session: unknown[] = [
    heading(ui, "This session"),
    gauge(ui, "Context", percent / 100, bw, `${thousands(used)} of ${thousands(window)} tokens · ${percent}%`),
  ];
  for (const limit of Array.isArray(usage.rateLimits) ? usage.rateLimits : []) {
    const p = Number(limit.percentUsed ?? 0);
    session.push(gauge(ui, String(limit.kind ?? "limit").replace(/_/g, " "), p / 100, bw, `${p}% used · resets ${when(limit.resetsAt, Date.now(), "both")}`));
  }
  if (typeof usage.cost === "number") session.push(hrow(ui, {}, [txt(ui, { dimColor: true }, fit("Cost", 12)), txt(ui, {}, `$${usage.cost.toFixed(2)}`)]));
  return [vcol(ui, {}, session), ...subagentTokens(ui, tokenTotals(ledger), bw)];
}

/** A labelled meter with its numbers after it; coloured green, amber or red by how full it is. */
function gauge(ui: Ui, label: string, fraction: number, width: number, detail: string): unknown {
  return hrow(ui, { columnGap: 1, flexWrap: "wrap" }, [
    txt(ui, { dimColor: true }, fit(label.charAt(0).toUpperCase() + label.slice(1), 11)),
    meter(ui, fraction, width, fillColor(fraction)),
    txt(ui, {}, detail),
  ]);
}

/** One bar per model, scaled to the busiest; or a note when the ledger has no runs. */
function subagentTokens(ui: Ui, totals: Record<string, { tokens_in: number; tokens_out: number; runs: number }>, width: number): unknown[] {
  const models = Object.keys(totals).sort((a, b) => sum(totals[b]) - sum(totals[a]));
  if (models.length === 0) {
    return [vcol(ui, {}, [heading(ui, "Subagent tokens by model"),
      empty(ui, "No subagent runs recorded yet.", "Totals appear here once the ledger records a finished subagent.")])];
  }
  const most = Math.max(1, ...models.map((m) => sum(totals[m])));
  return [vcol(ui, {}, [
    heading(ui, "Subagent tokens by model", "all recorded runs"),
    ...models.map((m) => {
      const t = totals[m];
      return hrow(ui, { columnGap: 1, flexWrap: "wrap" }, [
        txt(ui, { color: modelColor(m) }, fit(modelName(m), 11)),
        meter(ui, sum(t) / most, width, modelColor(m)),
        txt(ui, {}, `${compact(sum(t))}`),
        txt(ui, { dimColor: true }, `in ${compact(t.tokens_in)} · out ${compact(t.tokens_out)} · ${t.runs} ${t.runs === 1 ? "run" : "runs"}`),
      ]);
    }),
  ])];
}

function sum(t: { tokens_in: number; tokens_out: number }): number {
  return t.tokens_in + t.tokens_out;
}
