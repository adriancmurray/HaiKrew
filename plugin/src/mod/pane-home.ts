/**
 * The desktop view: one page on the panel's own background, no tabs. Top to bottom: the pixel banner with the
 * gate switch, quick controls, the crew with each working agent's latest message, token use, the track record and
 * all settings, each a card that folds to one line. The animated crew lives in the band above the prompt (crewBand). On the terminal Home is the
 * Crew scene and roster with token lines under them, and the other pages stay behind tabs.
 */
import type { Settings } from "../schema.ts";
import { fmtElapsed, modelFamily } from "./crew.ts";
import type { Crew, Lead, LeadState, Row } from "./crew.ts";
import { tokenTotals } from "./ledger.ts";
import type { LedgerState } from "./ledger.ts";
import { crewTab } from "./pane-crew.ts";
import { recordSection } from "./pane-ledger.ts";
import { settingsSection } from "./pane-settings.ts";
import { tokensTab } from "./pane-tokens.ts";
import type { Usage } from "./pane-tokens.ts";
import { title } from "./rules.ts";
import { activityOf, animatedSceneSvg, bannerSvg, SVG_ROWS } from "./sprites.ts";
import type { Activity } from "./sprites.ts";
import { moonPhase, skyHour, skySvg } from "./sky.ts";
import type { SkyMode } from "./sky.ts";
import { anchorAnimations, gauges, inkFor, table } from "./svg.ts";
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
      tokenCard(ui, act, frame, data.usage, data.ledger, data.crew, inner, ink, data.settings.pane.time_style as TimeStyle),
      recordSection(ui, act, frame, data.ledger, data.settings, inner, ink),
      settingsSection(ui, act, frame, data.settings, cols - 4),
    ]),
  ]);
}

/** What the band draws besides the crew: the band settings, each working agent's latest line, the time, and how to open the pane. */
export type BandOpts = {
  band: Settings["band"]; messages: Record<string, string>; now: number;
  open: () => unknown;
  /** Opens a subagent's transcript in HaiKrew's agent pane. */
  openAgent: (row: Row) => unknown;
};

// ponytail: desktop rows measured at about 27 px; a different font size shifts where the hover targets sit.
const ROW_PX = 27;
// The band's height in rows; the scene is drawn to fill exactly this many.
const BAND_ROWS = 3;
// Rows at the top of the band where a hover card shows; no hover target reaches into them.
const CARD_ROWS = 2;
// Scene pixels kept free at the right for the sun or moon, which opens the pane.
const ORB_ROOM = 12;
const LEAD_SAYS: Record<LeadState, string> = {
  working: "Working on it myself.",
  directing: "Directing the crew while I work.",
  waiting: "My turn is done; waiting on the crew.",
  resting: "Resting. Nothing is running.",
};

/**
 * The band above the prompt: a pixel sky (live time of day, or one the settings hold) behind the crew, edge to
 * edge. Hovering a critter shows a card with who it is and what it is doing; hovering the sun or moon at the right
 * shows a button that opens the pane. Cards and button are styles the surface applies on hover; no hook runs.
 */
export function crewBand(ui: Ui, crew: Crew, cols: number, dark: boolean, opts: BandOpts): unknown {
  const full = pxOf(cols);
  // The band is BAND_ROWS rows tall and the scene fills them exactly: its pixel size follows from the height, and
  // its width in scene pixels from that, so the drawing never leaves part of a row empty above or below it.
  const rows = BAND_ROWS;
  const height = rows * ROW_PX;
  const sceneCols = Math.max(48, Math.round((full * SVG_ROWS) / height));
  const b = opts.band;
  const mode = String(b.sky) as SkyMode;
  const local = new Date(opts.now);
  const hour = skyHour(mode, local.getHours() + local.getMinutes() / 60);
  const phase = moonPhase(opts.now);
  const sky = skySvg(sceneCols, SVG_ROWS, { mode, hour, phase, clouds: Boolean(b.clouds) });
  const scene = animatedSceneSvg(crew, sceneCols, inkFor(dark), {
    headwear: String(b.headwear) as "crown" | "wizard" | "cap" | "none",
    colors: { haiku: String(b.haiku_color), sonnet: String(b.sonnet_color), opus: String(b.opus_color) },
    background: sky.body, reserveRight: ORB_ROOM,
  });
  const toCol = (x: number): number => Math.floor((x * cols) / sceneCols);
  const toRow = (y: number): number => Math.max(0, Math.min(rows - 1, Math.floor((y * rows) / SVG_ROWS)));
  const lead = crew.lead ?? { state: crew.working > 0 ? "directing" : "resting", model: "opus" };
  const drawn = crew.rows.filter((r) => scene.spots.some((s) => s.id === r.id));
  const source = sceneSource({ sceneCols, dark, band: b, hour, phase, lead, rows: drawn }, scene.svg, opts.now);
  const who = crew.working ? `${crew.working} working` : "resting";
  const svg = ui.Svg({ source, alt: `The crew, ${who}: one pixel critter per agent, the main agent first`, width: full, height });
  const orbLeft = toCol(sky.orb.x - sky.orb.r - 1);
  const cardWidth = Math.min(orbLeft, 64);
  const cardLeft = (left: number): number => Math.max(0, Math.min(orbLeft - cardWidth, left - 1));
  // Hover targets must not overlap, or one pointer lights several cards: each runs from its own left column to the
  // next one's, the last to its critter's right edge, and none reaches the sun or moon's column.
  const spans = hoverSpans(scene.spots, toCol, orbLeft);
  const targets = scene.spots.map((spot, i) => {
    const { left, width } = spans[i];
    // Targets start below the card rows: a card shown over another critter's target would keep both lit.
    const top = Math.min(rows - 1, Math.max(CARD_ROWS, toRow(spot.top)));
    const row = spot.id === "lead" ? undefined : crew.rows.find((r) => r.id === spot.id);
    const lines = spot.id === "lead" ? leadCard(lead, crew.working) : rowCard(row, opts.messages[spot.id]);
    return ui.Box({ key: `band-${spot.id}`, position: "absolute", left, top, width, height: rows - top, children: [
      ui.Box({ position: "absolute", top: -top, left: cardLeft(left) - left, width: Math.min(cardWidth, orbLeft - cardLeft(left)), height: CARD_ROWS,
        display: "none", hover: { display: "flex" }, flexDirection: "column", paddingX: 1, backgroundColor: dark ? "#2b2a27" : "#f1efe8",
        children: [
          hrow(ui, { columnGap: 1, justifyContent: "space-between" }, [
            hrow(ui, { flexShrink: 1 }, [txt(ui, { bold: true, wrap: "truncate-end" }, lines[0])]),
            row ? ui.Button({ key: `band-transcript-${spot.id}`, label: "Transcript ↗", variant: "secondary", onPress: () => opts.openAgent(row) }) : null,
          ].filter((x) => x !== null)),
          txt(ui, { dimColor: true, wrap: "truncate-end" }, lines[1]),
        ] }),
    ] });
  });
  // The sun or moon: hovering it shows the open button just to its left, inside the band.
  const orb = sky.orb;
  const orbWidth = Math.max(2, toCol(orb.x + orb.r + 1) - orbLeft + 1);
  const opener = ui.Box({ key: "band-orb", position: "absolute", left: orbLeft, top: 0, width: Math.min(orbWidth, cols - orbLeft), height: rows, children: [
    // In the card rows, like the cards, so the shown button never lies over a critter's hover target.
    ui.Box({ position: "absolute", top: 0, right: orbWidth, display: "none", hover: { display: "flex" }, children: [
      ui.Button({ key: "band-open", label: `Open HaiKrew ${orb.kind === "sun" ? "☀" : "☾"}`, variant: "primary", onPress: () => opts.open() }),
    ] }),
  ] });
  // An explicit height, with the hover layers clipped to it, so nothing they place can make the band taller.
  return ui.Box({ key: "crew-band", flexDirection: "column", height: rows, overflow: "hidden", children: [svg, ...targets, opener] });
}

/** What the band's scene is drawn from: the sky (quarter hour and moon phase), the settings, the lead and the crew as drawn. */
type SceneInputs = {
  sceneCols: number; dark: boolean; band: Settings["band"]; hour: number; phase: number; lead: Lead; rows: Row[];
};

/** The last band source drawn, with the key it was drawn for. */
let bandCache: { key: string; svg: string } | null = null;

/**
 * The band's scene source. The sky is keyed by the quarter hour and the moon phase to two decimals, so a redraw
 * within them hands the app the same SVG and its loops keep their place. A new key draws and anchors a new source
 * at `now`.
 */
function sceneSource(s: SceneInputs, svg: string, now: number): string {
  const key = JSON.stringify({
    sceneCols: s.sceneCols, dark: s.dark, band: s.band, hour: Math.floor(s.hour * 4) / 4, phase: Math.round(s.phase * 100) / 100,
    lead: [s.lead.state, s.lead.model], rows: s.rows.map((r) => [r.id, r.model, r.state, activityOf(r), r.over]),
  });
  if (bandCache && bandCache.key === key) return bandCache.svg;
  bandCache = { key, svg: anchorAnimations(svg, now) };
  return bandCache.svg;
}

/**
 * Column spans for the critters' hover targets, left to right and never overlapping: each runs from its own left
 * column to the next one's, the last to its critter's right edge, none past `limit` (the sun or moon's column).
 */
export function hoverSpans(spots: Array<{ x: number; w: number }>, toCol: (x: number) => number, limit: number): Array<{ left: number; width: number }> {
  const lefts = spots.map((s) => Math.min(toCol(s.x), limit - 1));
  return spots.map((s, i) => {
    const end = Math.min(i + 1 < lefts.length ? lefts[i + 1] : toCol(s.x + s.w) + 1, limit);
    return { left: lefts[i], width: Math.max(1, end - lefts[i]) };
  });
}

/** The main agent's card: its model and what it is doing. */
function leadCard(lead: Lead, working: number): [string, string] {
  const crewNote = working ? ` · ${working} ${working === 1 ? "agent" : "agents"} working` : "";
  return [`Main agent · ${title(modelName(lead.model.replace(/\[.*\]$/, "")))} · ${lead.state}${crewNote}`, LEAD_SAYS[lead.state]];
}

/** What a crew member's activity reads as in words. */
const ACTIVITY_WORDS: Record<Activity, string> = {
  thinking: "thinking", reading: "reading", editing: "writing code", running: "running a command", web: "searching the web",
  directing: "directing", done: "done", failed: "failed",
};

/**
 * A crew member's card: name, model, what it is doing and for how long, and its tokens when it has used some; then
 * its latest line while it works, else its task.
 */
function rowCard(r: Row | undefined, message: string | undefined): [string, string] {
  if (!r) return ["", ""];
  const doing = r.over ? "past its token limit" : ACTIVITY_WORDS[activityOf(r)];
  const head = [r.name, r.model && r.model !== "unknown" ? modelName(r.model) : "", doing, fmtElapsed(r.elapsedMs),
    r.tokens ? `${compact(r.tokens)} tokens` : ""];
  const body = r.state === "working" && message ? `“${message}”` : r.task;
  return [head.filter(Boolean).join(" · "), body || " "];
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
  const stats = [fmtElapsed(r.elapsedMs), r.calls ? `${r.calls} ${r.calls === 1 ? "step" : "steps"}` : "", r.tokens ? `${compact(r.tokens)} tokens` : "", r.cached ? `+${compact(r.cached)} cached` : ""]
    .filter(Boolean).join(" · ");
  const up = r.state === "failed" ? stepUp(r.model, allowOpus) : "";
  const asked = view.open[`retried-${r.id}`];
  return vcol(ui, { key: `agent-${r.id}`, paddingLeft: r.depth * 2, hover: { backgroundColor: "#8A8A8A1A" } }, [
    hrow(ui, { justifyContent: "space-between", columnGap: 2 }, [
      hrow(ui, { columnGap: 1, flexShrink: 1 }, [
        txt(ui, { color: r.state === "failed" ? C.bad : live ? C.ok : C.muted }, "●"),
        txt(ui, live ? { bold: true, wrap: "truncate-end" } : { dimColor: true, wrap: "truncate-end" }, r.name),
        txt(ui, { dimColor: true, wrap: "truncate-end" }, r.type),
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
function tokenCard(ui: Ui, act: Actions, frame: CardFrame, usage: Usage, ledger: LedgerState, crew: Crew, width: number, ink: Ink, style: TimeStyle): unknown {
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
        [{ label: "Subagents", share: 24 }, { label: "Tokens", share: 36 }, { label: "In", share: 10, end: true },
          { label: "Out", share: 10, end: true }, { label: "Cached", share: 10, end: true }, { label: "Runs", share: 10, end: true }],
        models.map((m) => [{ dot: modelColor(m), text: modelName(m) }, { bar: sum(totals[m]) / most, color: modelColor(m), label: compact(sum(totals[m])) },
          { text: compact(totals[m].tokens_in), muted: true }, { text: compact(totals[m].tokens_out), muted: true },
          { text: compact(totals[m].cache_read ?? 0), muted: true }, { text: String(totals[m].runs) }]),
        width, models.map((m) => `${modelName(m)}: ${thousands(totals[m].tokens_in)} in, ${thousands(totals[m].tokens_out)} out, ` +
          `${thousands(totals[m].cache_read ?? 0)} cache reads, ${totals[m].runs} runs`), ink),
      alt: "Subagent tokens per model" }),
    tokenNote(ui, ledger, crew),
  ]);
}

/** What the table counts: finished runs only, new work (cache reads apart), and which outputs are estimates. */
function tokenNote(ui: Ui, ledger: LedgerState, crew: Crew): unknown {
  const running = crew.rows.filter((r) => r.state === "working");
  const estimated = ledger.runs.filter((r) => r.tokens_estimated !== false).length;
  const parts = ["Finished runs. Tokens are new work (input, cache writes, output); cached is context re-read from cache."];
  if (running.length) parts.push(`${running.length} still running: ${compact(running.reduce((n, r) => n + r.tokens, 0))} so far, added when they finish.`);
  if (estimated) parts.push(`Output of ${estimated} older ${estimated === 1 ? "run is" : "runs is"} an estimate.`);
  return txt(ui, { dimColor: true }, parts.join(" "));
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
