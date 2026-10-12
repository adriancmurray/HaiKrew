/**
 * The desktop view: one page on the panel's own background, no tabs. Top to bottom: the pixel banner with the
 * gate switch, quick controls, the crew with each working agent's latest message, token use, the track record and
 * all settings, each a card that folds to one line. The animated crew lives in the band above the prompt (crewBand). On the terminal Home is the
 * Crew scene and roster with token lines under them, and the other pages stay behind tabs.
 */
import type { Settings } from "../schema.ts";
import { fmtElapsed, modelFamily } from "./crew.ts";
import type { Crew, Row } from "./crew.ts";
import { tokenTotals } from "./ledger.ts";
import type { LedgerState } from "./ledger.ts";
import { crewTab } from "./pane-crew.ts";
import { recordSection } from "./pane-ledger.ts";
import { settingsSection } from "./pane-settings.ts";
import { tokensTab } from "./pane-tokens.ts";
import type { Usage } from "./pane-tokens.ts";
import { title } from "./rules.ts";
import { animatedSceneSvg, bannerSvg, PIXEL_ROWS } from "./sprites.ts";
import { gauges, inkFor, table } from "./svg.ts";
import type { Ink } from "./svg.ts";
import { C, CARD_INSET, compact, fillColor, foldCard, hexOf, hrow, labelled, modelColor, modelName, onOff, pxOf, thousands, txt, vcol, view, when } from "./ui.ts";
import type { TimeStyle } from "./ui.ts";
import type { Actions, CardFrame, Ui } from "./ui.ts";

export type HomeData = {
  crew: Crew; settings: Settings; ledger: LedgerState; usage: Usage;
  /** Each working agent's latest line of text, by agent id. */
  messages: Record<string, string>;
  /** Whether the app's theme is dark, as far as its theme setting says. */
  dark: boolean;
};

/** The terminal's Home: the Crew scene and roster with token lines under them. */
export function terminalHome(ui: Ui, data: HomeData, cols: number): unknown[] {
  return [...crewTab(ui, data.crew, cols), ...tokensTab(ui, data.usage, data.ledger, cols)];
}

/** The one-page desktop view. `gate` is the gate line pane.ts draws (it owns the switch). */
export function desktopView(ui: Ui, act: Actions, data: HomeData, gate: unknown, cols: number): unknown {
  const ink = inkFor(data.dark);
  const full = pxOf(cols);
  const inner = pxOf(cols - CARD_INSET);
  const bannerCols = Math.max(60, Math.round(full / 4));
  const frame: CardFrame = { cols: cols - CARD_INSET };
  return vcol(ui, { width: cols }, [
    ui.Svg({ source: bannerSvg(full, ink), alt: "HaiKrew", width: full, height: Math.round((full * 22) / bannerCols) }),
    vcol(ui, { paddingX: 2, paddingBottom: 1, rowGap: 2 }, [
      gate,
      controls(ui, act, frame, data.settings),
      crewCard(ui, act, frame, data.crew, data.messages, Boolean(data.settings.gate.allow_opus)),
      tokenCard(ui, act, frame, data.usage, data.ledger, inner, ink, data.settings.pane.time_style as TimeStyle),
      recordSection(ui, act, frame, data.ledger, data.settings, inner, ink),
      settingsSection(ui, act, frame, data.settings, cols - 4),
    ]),
  ]);
}

/**
 * The crew for the band above the prompt: the animated scene, edge to edge, on the panel's own background.
 * `cols` is the band's width in columns.
 */
export function crewBand(ui: Ui, crew: Crew, cols: number, dark: boolean): unknown {
  const full = pxOf(cols);
  // The scene's pixel grid follows the width, so a sprite pixel stays about five screen pixels wide.
  const sceneCols = Math.max(48, Math.min(240, Math.round(full / 5)));
  const scene = animatedSceneSvg(crew, sceneCols, inkFor(dark));
  const who = crew.working ? `${crew.working} working` : "resting";
  return ui.Svg({ source: scene.svg, alt: `The crew, ${who}: one pixel critter per agent, the lead first`, width: full,
    height: Math.round((full * PIXEL_ROWS) / sceneCols) });
}

/** The controls people reach for most, as a two-column form. Everything else is under Settings. */
function controls(ui: Ui, act: Actions, frame: CardFrame, s: Settings): unknown {
  const word = (v: unknown): string => (v ? "on" : "off");
  const summary = `Agents start on ${title(String(s.gate.default_model))} · Opus ${s.gate.allow_opus ? "allowed" : "off"} · ` +
    `agents starting agents ${word(s.gate.allow_nested)} · tools for Claude ${s.agents.control === "off" ? "off" : s.agents.control === "read" ? "look only" : "look and change"}`;
  return foldCard(ui, act, frame, "card-controls", "Controls", "", summary, true, [
    labelled(ui, "Agents start on", ["haiku", "sonnet", "opus"].map((m) => ui.Button({ key: `quick-model-${m}`, label: title(m),
      variant: s.gate.default_model === m ? "primary" : "secondary", onPress: () => act.save("gate.default_model", "gate", "default_model", m) }))),
    labelled(ui, "Claude's HaiKrew tools", ([["off", "Off"], ["read", "Look"], ["change", "Look and change"]] as const).map(([c, label]) => ui.Button({
      key: `quick-agents-${c}`, label, variant: s.agents.control === c ? "primary" : "secondary",
      onPress: () => act.save("agents.control", "agents", "control", c) }))),
    labelled(ui, "Allow Opus", [onOff(ui, "quick-gate.allow_opus", Boolean(s.gate.allow_opus), (v) => act.save("gate.allow_opus", "gate", "allow_opus", v))]),
    labelled(ui, "Agents may start agents", [onOff(ui, "quick-gate.allow_nested", Boolean(s.gate.allow_nested), (v) => act.save("gate.allow_nested", "gate", "allow_nested", v))]),
    labelled(ui, "Open this pane on start", [onOff(ui, "quick-pane.open_on_start", Boolean(s.pane.open_on_start), (v) => act.save("pane.open_on_start", "pane", "open_on_start", v))]),
    txt(ui, { dimColor: true }, "Rules under Settings › Routing can send a job to another model."),
  ]);
}

/** Who is working: one block per agent, its latest message under it while it works. */
function crewCard(ui: Ui, act: Actions, frame: CardFrame, crew: Crew, messages: Record<string, string>, allowOpus: boolean): unknown {
  const done = crew.rows.length - crew.working;
  const note = [crew.working ? `${crew.working} working` : "", done ? `${done} finished` : ""].filter(Boolean).join(" · ");
  const latest = crew.rows.find((r) => messages[r.id]);
  const summary = crew.rows.length === 0 ? "Nobody is working right now." : latest ? `${latest.name}: “${messages[latest.id]}”` : note;
  return foldCard(ui, act, frame, "card-crew", "Your crew", note, summary, true, crew.rows.length === 0
    ? [txt(ui, { dimColor: true }, "Nobody is working right now. When Claude starts a subagent it shows up here and joins the crew above the prompt.")]
    : crew.rows.map((r) => member(ui, act, r, messages[r.id] ?? "", allowOpus)));
}

/** The model one step up from `model` (Haiku to Sonnet, Sonnet to Opus when Opus is allowed), or "" when none. */
export function stepUp(model: string, allowOpus: boolean): string {
  const fam = modelFamily(model);
  return fam === "haiku" ? "sonnet" : fam === "sonnet" && allowOpus ? "opus" : "";
}

function member(ui: Ui, act: Actions, r: Row, message: string, allowOpus: boolean): unknown {
  const live = r.state === "working";
  const detail = [r.task, r.last ? `last used ${r.last}` : ""].filter(Boolean).join(" · ");
  const stats = [fmtElapsed(r.elapsedMs), r.calls ? `${r.calls} ${r.calls === 1 ? "step" : "steps"}` : "", r.tokens ? `${compact(r.tokens)} tokens` : ""]
    .filter(Boolean).join(" · ");
  const up = r.state === "failed" ? stepUp(r.model, allowOpus) : "";
  const asked = view.open[`retried-${r.id}`];
  return vcol(ui, { key: `agent-${r.id}`, paddingLeft: r.depth * 2, hover: { backgroundColor: "#8A8A8A1A" } }, [
    hrow(ui, { justifyContent: "space-between", columnGap: 2 }, [
      hrow(ui, { columnGap: 1, flexShrink: 1 }, [
        txt(ui, { color: r.state === "failed" ? C.bad : live ? C.ok : C.muted }, "●"),
        txt(ui, live ? { bold: true, wrap: "truncate-end" } : { dimColor: true, wrap: "truncate-end" }, r.name),
        r.model && r.model !== "unknown" ? txt(ui, { color: modelColor(r.model) }, modelName(r.model)) : null,
        r.rule ? txt(ui, { dimColor: true }, `chosen by ${r.rule}`) : null,
        r.state === "failed" ? txt(ui, { color: C.bad }, "failed") : r.state === "done" ? txt(ui, { dimColor: true }, "done") : null,
      ].filter((x) => x !== null)),
      txt(ui, r.over ? { color: C.warn } : { dimColor: true }, stats),
    ]),
    r.over ? txt(ui, { color: C.warn }, "Past the token warning for one agent (Settings › Guards).") : null,
    live && message ? txt(ui, { italic: true, wrap: "truncate-end" }, `“${message}”`) : null,
    detail ? txt(ui, { dimColor: true, wrap: "truncate-end" }, detail) : null,
    up && !asked ? hrow(ui, {}, [ui.Button({ key: `retry-${r.id}`, label: `↻ Retry on ${title(up)}`, onPress: async () => {
      view.open[`retried-${r.id}`] = true;
      await act.retry(r, up);
      act.redraw();
    } })]) : null,
    up && asked ? txt(ui, { dimColor: true }, `Asked Claude to run it again on ${title(up)}.`) : null,
  ]);
}

/** Token use: rings for context and rate limits, then each model's share of subagent tokens. */
function tokenCard(ui: Ui, act: Actions, frame: CardFrame, usage: Usage, ledger: LedgerState, width: number, ink: Ink, style: TimeStyle): unknown {
  const now = Date.now();
  const ctx: Usage = usage.context ?? {};
  const rings = [{ label: "Context", fraction: Number(ctx.percent ?? 0) / 100, color: hexOf(fillColor(Number(ctx.percent ?? 0) / 100)),
    detail: `${compact(Number(ctx.tokens ?? 0))} of ${compact(Number(ctx.window ?? 0))}` }];
  for (const limit of Array.isArray(usage.rateLimits) ? usage.rateLimits : []) {
    const p = Number(limit.percentUsed ?? 0) / 100;
    rings.push({ label: title(String(limit.kind ?? "limit").replace(/_/g, " ")), fraction: p, color: hexOf(fillColor(p)),
      detail: `resets ${when(limit.resetsAt, now, style)}` });
  }
  const totals = tokenTotals(ledger);
  const models = Object.keys(totals).sort((a, b) => sum(totals[b]) - sum(totals[a]));
  const most = Math.max(1, ...models.map((m) => sum(totals[m])));
  const summary = rings.map((g) => `${g.label} ${Math.round(g.fraction * 100)}%`).join(" · ");
  return foldCard(ui, act, frame, "card-tokens", "Token use", typeof usage.cost === "number" ? `$${usage.cost.toFixed(2)} this session` : "", summary, true, [
    ui.Svg({ source: gauges(rings, width, ink), alt: summary }),
    models.length === 0
      ? txt(ui, { dimColor: true }, "Each model's share of subagent tokens shows here once a subagent finishes.")
      : ui.Svg({ source: table(
        [{ label: "Subagents", share: 26 }, { label: "Tokens", share: 44 }, { label: "In", share: 10, end: true },
          { label: "Out", share: 10, end: true }, { label: "Runs", share: 10, end: true }],
        models.map((m) => [{ dot: modelColor(m), text: modelName(m) }, { bar: sum(totals[m]) / most, color: modelColor(m), label: compact(sum(totals[m])) },
          { text: compact(totals[m].tokens_in), muted: true }, { text: compact(totals[m].tokens_out), muted: true }, { text: String(totals[m].runs) }]),
        width, models.map((m) => `${modelName(m)}: ${thousands(totals[m].tokens_in)} in, ${thousands(totals[m].tokens_out)} out, ${totals[m].runs} runs`), ink),
      alt: "Subagent tokens per model" }),
  ]);
}

function sum(t: { tokens_in: number; tokens_out: number }): number {
  return t.tokens_in + t.tokens_out;
}

/** The first line of the newest assistant text in an agent's messages, cut to `max` characters; "" when none. */
export function latestLine(entries: unknown, max = 90): string {
  if (!Array.isArray(entries)) return "";
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as { role?: string; text?: string };
    const line = e?.role === "assistant" && typeof e.text === "string" ? e.text.split("\n").map((l) => l.trim()).find(Boolean) ?? "" : "";
    if (line) return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return "";
}
