/**
 * The desktop view: one page on the panel's own background, no tabs. Top to bottom: the pixel banner with the
 * gate switch, quick controls, the crew with each working agent's latest message, token use, the track record and
 * all settings, each a card that folds to one line. The animated crew lives in the band above the prompt (crewBand). On the terminal Home is the
 * Crew scene and roster with token lines under them, and the other pages stay behind tabs.
 */
import type { Settings } from "../schema.ts";
import { activityOf, fmtElapsed, modelFamily } from "./crew.ts";
import type { Activity, Crew, Lead, LeadState, Row } from "./crew.ts";
import { H } from "./band/common.ts";
import { bandLook, bandScene, leadAct, leadOf, rowAct } from "./band/scene.ts";
import type { BandScene } from "./band/scene.ts";
import { tokenTotals } from "./ledger.ts";
import type { LedgerState } from "./ledger.ts";
import { crewTab } from "./pane-crew.ts";
import { insightsSection } from "./pane-insights.ts";
import { recordSection } from "./pane-ledger.ts";
import { settingsSection } from "./pane-settings.ts";
import { tokensTab } from "./pane-tokens.ts";
import type { Usage } from "./pane-tokens.ts";
import { title } from "./rules.ts";
import { MANUAL_UPDATE } from "./update.ts";
import { bannerSvg } from "./sprites.ts";
import { anchorAnimations, gauges, inkFor, table } from "./svg.ts";
import type { Ink } from "./svg.ts";
import { C, CARD_INSET, compact, fillColor, foldCard, hexOf, hrow, labelled, modelColor, modelName, onOff, pxOf, textAndControls, thousands, txt, vcol, view, when } from "./ui.ts";
import type { ModelColours, TimeStyle } from "./ui.ts";
import type { Actions, CardFrame, Ui } from "./ui.ts";

export type HomeData = {
  crew: Crew; settings: Settings; ledger: LedgerState; usage: Usage;
  /** Each working agent's latest line of text, by agent id. */
  messages: Record<string, string>;
  /** Whether the app's theme is dark, as far as its theme setting says. */
  dark: boolean;
  /** A newer release than the installed one, when there is one and the check is on. */
  update?: { latest: string; installed: string; manual?: boolean };
};

const NOTES_URL = "https://github.com/adriancmurray/HaiKrew/blob/main/CHANGELOG.md";

/** The strip at the top of the home page: a newer release, its notes link, and the Update button (gone once updated). */
export function updateStrip(ui: Ui, act: Actions, u: { latest: string; installed: string; manual?: boolean }): unknown {
  const done = view.updateNote.startsWith("Updated.");
  return vcol(ui, { key: "update-strip", borderStyle: "round", borderColor: C.accent, paddingX: 2 }, [
    textAndControls(ui, [
      txt(ui, { bold: true, wrap: "wrap" }, view.updateNote || `HaiKrew ${u.latest} is available (you have ${u.installed})`),
      u.manual ? txt(ui, { dimColor: true, wrap: "wrap" }, MANUAL_UPDATE) : null,
      view.updateNote ? null : ui.Link({ href: NOTES_URL, label: "Release notes" }),
    ], [done || u.manual ? null : ui.Button({ key: "update-now", label: view.updating ? "Updating…" : "Update", variant: "primary",
      onPress: () => (view.updating ? undefined : act.update()) })]),
  ]);
}

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
  const colours = familyColours(data.settings.band);
  return vcol(ui, { width: cols }, [
    data.update ? vcol(ui, { paddingX: 2, paddingTop: 1 }, [updateStrip(ui, act, data.update)]) : null,
    ui.Svg({ source: bannerSvg(full, ink), alt: "HaiKrew", width: full, height: Math.round((full * 22) / bannerCols) }),
    vcol(ui, { paddingX: 2, paddingBottom: 1, rowGap: 2 }, [
      gate,
      controls(ui, act, frame, data.settings),
      crewCard(ui, act, frame, data.crew, data.messages, Boolean(data.settings.gate.allow_opus), colours),
      tokenCard(ui, act, frame, data.usage, data.ledger, data.crew, inner, ink, data.settings.pane.time_style as TimeStyle, colours),
      recordSection(ui, act, frame, data.ledger, data.settings, inner, ink),
      insightsSection(ui, act, frame, data.ledger, data.settings),
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
  /** A newer release: the main agent says so in a speech bubble; hovering the bubble or the main agent offers the update. */
  update?: { latest: string; run: () => unknown; manual?: boolean };
};

// ponytail: desktop rows measured at about 27 px; a different font size shifts where the hover targets sit.
const ROW_PX = 27;
// The band's height in rows; the scene is drawn to fill exactly this many.
const BAND_ROWS = 3;
// Rows at the top of the band where a hover card shows; no hover target reaches into them.
const CARD_ROWS = 2;
const LEAD_SAYS: Record<LeadState, string> = {
  working: "Working on it myself.",
  directing: "Directing the crew while I work.",
  waiting: "My turn is done; waiting on the crew.",
  resting: "Resting. Nothing is running.",
};

/**
 * The band above the prompt: the scenery behind the crew, edge to edge, and the crew on its ground, each bot acting out
 * its work. Hovering a bot shows a card with who it is and what it is doing; hovering the sun or moon at the right
 * shows a button that opens the pane. Cards and button are styles the surface applies on hover; no hook runs. Bots the
 * drawing had no room for leave a "+N" after the last one.
 */
export function crewBand(ui: Ui, crew: Crew, cols: number, dark: boolean, opts: BandOpts): unknown {
  const full = pxOf(cols);
  // The band is BAND_ROWS rows tall and the drawing fills them exactly: its width in scene pixels follows from that
  // height, so one scene pixel is one CSS pixel and the drawing is never stretched.
  const rows = BAND_ROWS;
  const height = rows * ROW_PX;
  const width = Math.max(1, Math.round((full * H) / height));
  const scene = bandDrawing(crew, width, opts);
  const toCol = (x: number): number => Math.floor((x * cols) / width);
  const toRow = (y: number): number => Math.max(0, Math.min(rows - 1, Math.floor((y * rows) / H)));
  const who = crew.working ? `${crew.working} working` : "resting";
  const svg = ui.Svg({ source: scene.svg, alt: `The crew, ${who}: one bot per agent, the main agent first`, width: full, height });
  const orb = scene.orb;
  const orbLeft = toCol(orb.x - orb.r - 1);
  const cardWidth = Math.min(orbLeft, 64);
  const cardLeft = (left: number): number => Math.max(0, Math.min(orbLeft - cardWidth, left - 1));
  // Hover targets must not overlap, or one pointer lights several cards: each runs from its own left column to the
  // next one's, the last to its bot's right edge, and none reaches the sun or moon's column.
  const spans = hoverSpans(scene.spots, toCol, orbLeft);
  const lead = leadOf(crew);
  const targets = scene.spots.map((spot, i) => {
    const { left, width: cover } = spans[i];
    // Targets start below the card rows: a card shown over another bot's target would keep both lit.
    const top = Math.min(rows - 1, Math.max(CARD_ROWS, toRow(spot.top)));
    const row = spot.id === "lead" ? undefined : crew.rows.find((r) => r.id === spot.id);
    const lines = spot.id === "lead" ? leadCard(lead, crew.working) : rowCard(row, opts.messages[spot.id]);
    return ui.Box({ key: `band-${spot.id}`, position: "absolute", left, top, width: cover, height: rows - top, children: [
      ui.Box({ position: "absolute", top: -top, left: cardLeft(left) - left, width: Math.min(cardWidth, orbLeft - cardLeft(left)), height: CARD_ROWS,
        display: "none", hover: { display: "flex" }, flexDirection: "column", paddingX: 1, backgroundColor: dark ? "#2b2a27" : "#f1efe8",
        children: [
          // The transcript button comes first, as a small icon, so a long first line can never push it out of the card.
          hrow(ui, { columnGap: 1, alignItems: "center" }, [
            row ? ui.Button({ key: `band-transcript-${spot.id}`, label: "≡", variant: "secondary", onPress: () => opts.openAgent(row) }) : null,
            spot.id === "lead" && opts.update ? updateButton(ui, opts.update) : null,
            hrow(ui, { flexShrink: 1 }, [txt(ui, { bold: true, wrap: "truncate-end" }, lines[0])]),
          ].filter((x) => x !== null)),
          txt(ui, { dimColor: true, wrap: "truncate-end" }, lines[1]),
        ] }),
    ] });
  });
  // The sun or moon: hovering it shows the open button just to its left, inside the band.
  const orbWidth = Math.max(2, toCol(orb.x + orb.r + 1) - orbLeft + 1);
  const opener = ui.Box({ key: "band-orb", position: "absolute", left: orbLeft, top: 0, width: Math.min(orbWidth, cols - orbLeft), height: rows, children: [
    // In the card rows, like the cards, so the shown button never lies over a bot's hover target.
    ui.Box({ position: "absolute", top: 0, right: orbWidth, display: "none", hover: { display: "flex" }, children: [
      ui.Button({ key: "band-open", label: `Open HaiKrew ${orb.kind === "sun" ? "☀" : "☾"}`, variant: "primary", onPress: () => opts.open() }),
    ] }),
  ] });
  const last = scene.spots[scene.spots.length - 1];
  const more = scene.overflow > 0 && last ? moreMark(ui, dark, scene.overflow, { from: toCol(last.x + last.w) + 1, limit: orbLeft, rows, cardWidth }) : null;
  const alert = opts.update && scene.bubble ? updateBubble(ui, dark, opts.update, scene.bubble, toCol) : null;
  // An explicit height, with the hover layers clipped to it, so nothing they place can make the band taller.
  return ui.Box({ key: "crew-band", flexDirection: "column", height: rows, overflow: "hidden", children: [svg, ...targets, opener, ...(more ? [more] : []), ...(alert ? [alert] : [])] });
}

/** The Update button of the band's cards: gone once the update has run. */
function updateButton(ui: Ui, u: { latest: string; run: () => unknown; manual?: boolean }): unknown {
  if (u.manual || view.updateNote.startsWith("Updated.")) return null;
  return ui.Button({ key: "band-update-now", label: view.updating ? "Updating…" : "Update", variant: "primary",
    onPress: () => (view.updating ? undefined : u.run()) });
}

/**
 * The hover target over the update bubble (scene pixels `b`, on the band's top rows, clear of every bot's target).
 * Its card covers the bubble and says which release is out, with the Update button until it has run (then the outcome).
 */
function updateBubble(ui: Ui, dark: boolean, u: { latest: string; run: () => unknown; manual?: boolean }, b: { x: number; w: number }, toCol: (x: number) => number): unknown {
  const left = toCol(b.x), width = Math.max(2, toCol(b.x + b.w) - left + 1);
  return ui.Box({ key: "band-update", position: "absolute", left, top: 0, width, height: 1, children: [
    ui.Box({ position: "absolute", top: 0, left: 0, display: "none", hover: { display: "flex" }, flexDirection: "row", columnGap: 1,
      alignItems: "center", paddingX: 1, backgroundColor: dark ? "#2b2a27" : "#f1efe8", children: [
        txt(ui, { bold: true, wrap: "wrap" }, view.updateNote || (u.manual ? `Update to ${u.latest}. ${MANUAL_UPDATE}` : `Update to ${u.latest}`)),
        updateButton(ui, u),
      ].filter((x) => x !== null) }),
  ] });
}

/**
 * The "+N" just after the last bot, for the bots the band did not draw. Hovering it shows a card on the band's top row
 * that says how many. `from` is the column past the last bot, `limit` the sun or moon's column, `cardWidth` the widest card.
 */
function moreMark(ui: Ui, dark: boolean, n: number, geo: { from: number; limit: number; rows: number; cardWidth: number }): unknown {
  const left = Math.min(geo.from, geo.limit - 1), top = geo.rows - 1;
  const cardLeft = Math.max(0, Math.min(geo.limit - geo.cardWidth, left - 1));
  return ui.Box({ key: "band-more", position: "absolute", left, top, width: Math.max(1, Math.min(4, geo.limit - left)), height: 1, children: [
    txt(ui, { dimColor: true }, `+${n}`),
    ui.Box({ position: "absolute", top: -top, left: cardLeft - left, width: Math.min(geo.cardWidth, geo.limit - cardLeft), height: 1,
      display: "none", hover: { display: "flex" }, paddingX: 1, backgroundColor: dark ? "#2b2a27" : "#f1efe8",
      children: [txt(ui, { wrap: "truncate-end" }, `${n} more ${n === 1 ? "agent" : "agents"} not drawn`)] }),
  ] });
}

/** The last band drawing made, unanchored, with the key it was made for. */
let bandCache: { key: string; scene: BandScene } | null = null;

/**
 * The band's drawing for this crew and width. The key is what the drawing shows: the time of day, the season, the moon
 * phase to two decimals, the band's settings (scenery included), and each bot's model and act. A redraw that shows the
 * same thing reuses the drawing, re-anchored to its own clock. The anchor is applied on every call, not once at the
 * draw: Chromium restarts an SVG image's animations whenever its source is set, so a source anchored at an old clock
 * would replay from that moment.
 */
function bandDrawing(crew: Crew, width: number, opts: BandOpts): BandScene {
  const look = bandLook(opts.band, opts.now);
  const lead = leadOf(crew);
  const key = JSON.stringify({
    width, bubble: Boolean(opts.update), time: look.time, season: look.season, phase: Math.round(look.phase * 100) / 100, band: opts.band,
    lead: [leadAct(lead), modelFamily(lead.model)], rows: crew.rows.map((r) => [r.id, rowAct(r), modelFamily(r.model)]),
  });
  if (!bandCache || bandCache.key !== key) bandCache = { key, scene: bandScene(crew, { width, band: opts.band, now: opts.now, bubble: Boolean(opts.update) }) };
  return { ...bandCache.scene, svg: anchorAnimations(bandCache.scene.svg, opts.now) };
}

/**
 * Column spans for the bots' hover targets, left to right and never overlapping: each runs from its own left
 * column to the next one's, the last to its bot's right edge, none past `limit` (the sun or moon's column).
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
  // Line one stays short (who and what); time, tokens and the latest line go on line two.
  const head = [r.name, r.model && r.model !== "unknown" ? modelName(r.model) : "", doing];
  const said = r.state === "working" && message ? `“${message}”` : r.task;
  const body = [fmtElapsed(r.elapsedMs), r.tokens ? `${compact(r.tokens)} tokens` : "", said].filter(Boolean).join(" · ");
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
function crewCard(ui: Ui, act: Actions, frame: CardFrame, crew: Crew, messages: Record<string, string>, allowOpus: boolean, colours: ModelColours): unknown {
  const done = crew.rows.length - crew.working;
  const note = [crew.working ? `${crew.working} working` : "", done ? `${done} finished` : ""].filter(Boolean).join(" · ");
  const latest = crew.rows.find((r) => messages[r.id]);
  const summary = crew.rows.length === 0 ? "Nobody is working right now." : latest ? `${latest.name}: “${messages[latest.id]}”` : note;
  return foldCard(ui, act, frame, "card-crew", "Your crew", note, summary, true, crew.rows.length === 0
    ? [txt(ui, { dimColor: true }, "Nobody is working right now. When Claude starts a subagent it shows up here and joins the crew above the prompt.")]
    : crew.rows.map((r) => member(ui, act, r, messages[r.id] ?? "", allowOpus, colours)));
}

/** The band's colour settings by model family, so the pane's model dots and bars match the bots in the band. */
function familyColours(band: Settings["band"]): ModelColours {
  return { haiku: String(band.haiku_color), sonnet: String(band.sonnet_color), opus: String(band.opus_color) };
}

/** The model one step up from `model` (Haiku to Sonnet, Sonnet to Opus when Opus is allowed), or "" when none. */
export function stepUp(model: string, allowOpus: boolean): string {
  const fam = modelFamily(model);
  return fam === "haiku" ? "sonnet" : fam === "sonnet" && allowOpus ? "opus" : "";
}

function member(ui: Ui, act: Actions, r: Row, message: string, allowOpus: boolean, colours: ModelColours): unknown {
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
        r.model && r.model !== "unknown" ? txt(ui, { color: modelColor(r.model, colours) }, modelName(r.model)) : null,
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
function tokenCard(ui: Ui, act: Actions, frame: CardFrame, usage: Usage, ledger: LedgerState, crew: Crew, width: number, ink: Ink, style: TimeStyle, colours: ModelColours): unknown {
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
        models.map((m) => [{ dot: modelColor(m, colours), text: modelName(m) }, { bar: sum(totals[m]) / most, color: modelColor(m, colours), label: compact(sum(totals[m])) },
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
