/**
 * HaiKrew's `/haikrew` pane: three tabs (Settings, Ledger, Tokens) drawn on the terminal surface. Every `$`
 * use stays in this file; the formatting helpers take plain values only.
 */
import { SCHEMA, validate } from "../schema.ts";
import type { Field, Settings } from "../schema.ts";
import { checkChanges, mergeChanges, settingsFrom } from "./config.ts";
import { rowLine, snapshot } from "./crew.ts";
import type { LiveAgent } from "./crew.ts";
import { readState, summary, suggestions, tokenTotals } from "./ledger.ts";
import type { KeyStats, Run, Suggestion } from "./ledger.ts";
import { packCells, scene, sceneSvg, SCENE_ROWS } from "./sprites.ts";

const PANE = "haikrew";
const TABS = [["crew", "Crew"], ["settings", "Settings"], ["ledger", "Ledger"], ["tokens", "Tokens"]] as const;
type Tab = (typeof TABS)[number][0];
const SCENE_KEY = "crew-scene";
const TICK_MS = 250;
const DESKTOP_TICK_MS = 500;
/** Terminal ticks between roster redraws, so the roster refreshes about once a second. */
const ROSTER_EVERY_TICKS = 4;
/** The scene's timer while it runs; null when it is stopped. */
let stopTimer: (() => void) | null = null;
type Ui = Record<string, (...args: unknown[]) => unknown>;
type Api = Record<string, any>;


/** A Text element. Mods read its content from `children` inside the props, so the content goes there. */
function txt(ui: Ui, props: Record<string, unknown>, content: unknown): unknown {
  return ui.Text({ ...props, children: content });
}
/** Session-local view state. Module scope because the pane's handlers outlive a single render. */
const view: {
  tab: Tab;
  section: string;
  drafts: Record<string, string>;
  errors: Record<string, string>;
  frame: number;
  cols: number;
  armed: string;
} = { tab: "crew", section: "gate", drafts: {}, errors: {}, frame: 0, cols: 80, armed: "" };

/** Claude Code calls this once when the mod loads. Adds the /haikrew command at session start and draws its pane. */
export function registerPane(on: (...args: unknown[]) => void): void {
  on("session.start", async ($: Api, e: Api, next: (e: Api) => unknown) => {
    try {
      await $.command.register({ name: PANE, description: "Open the HaiKrew pane: settings, ledger, token use" });
    } catch {
      // The pane still opens through the command.run hook when registration is refused.
    }
    return next(e);
  });

  on("command.run", { command: PANE }, async ($: Api) => {
    await $.ui.open({ id: PANE, title: "HaiKrew", focus: true, closeOnEscape: true });
    return { text: "HaiKrew pane opened." };
  });

  on("ui.close", async ($: Api, e: Api, next: (e: Api) => unknown) => {
    if (e.id === PANE) halt();
    return next(e);
  });

  on("ui.render", { component: "Pane" }, async ($: Api, e: Api, next: (e: Api) => unknown) => {
    if (e.requestId !== PANE) return next(e);
    const ui = $.ui.resolve(e) as Ui;
    const cols = Math.max(20, Number(e.props?.bodyColumns) || 80);
    const surface = String(e.surface ?? "terminal");
    const body = view.tab === "crew" ? await crewTab($, ui, cols, surface)
      : view.tab === "settings" ? await settingsTab($, ui, cols)
      : view.tab === "ledger" ? await ledgerTab($, ui, cols) : await tokensTab($, ui, cols);
    return ui.Box({ borderStyle: "round", flexDirection: "column", padding: 1, width: cols, gap: 1, children: [
      txt(ui, { bold: true }, "HaiKrew"),
      ui.Box({ flexDirection: "row", columnGap: 2, children: TABS.map(([id, label], i) => ui.Button({
        key: `tab-${id}`, label: view.tab === id ? `[${i + 1} ${label}]` : `${i + 1} ${label}`,
        plain: true, hotkey: String(i + 1), onPress: () => setTab($, id),
      })) }),
      ...body,
    ] });
  });
}

function setTab($: Api, tab: Tab): void {
  view.tab = tab;
  $.ui.invalidate("ui.render");
}

/** The live agent list, or none when the host refuses it. */
async function liveAgents($: Api): Promise<LiveAgent[]> {
  try {
    const list = await $.agent.list();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The Crew tab: the pixel scene (a Raster on the terminal, an Svg on desktop) over the roster of agents. */
async function crewTab($: Api, ui: Ui, cols: number, surface: string): Promise<unknown[]> {
  const crew = snapshot(await liveAgents($), Date.now());
  const { px, overflow } = scene(crew, cols, view.frame);
  view.cols = cols;
  if (crew.working > 0) startTimer($, surface === "desktop");
  const picture = surface === "desktop"
    ? ui.Svg({ source: sceneSvg(px, cols), alt: "Crew: one pixel critter per agent, the lead first" })
    : ui.Raster({ key: SCENE_KEY, columns: cols, rows: SCENE_ROWS, cells: packCells(px, cols) });
  const roster = crew.rows.length === 0
    ? [txt(ui, { dimColor: true }, "No agents working. Crew members appear here when Claude starts a subagent.")]
    : crew.rows.map((r) => txt(ui, r.state === "failed" ? { color: "red" }
      : r.state === "working" ? { color: "green" } : { dimColor: true }, rowLine(r, cols)));
  return [picture, ...(overflow > 0 ? [txt(ui, {}, `+${overflow} more`)] : []), ...roster];
}

/** Start the scene's timer unless it runs. It stops itself when no agent works, the tab is left or a blit is refused. */
function startTimer($: Api, desktop: boolean): void {
  if (stopTimer) return;
  stopTimer = $.clock.every(desktop ? DESKTOP_TICK_MS : TICK_MS, () => void tick($, desktop));
}

/** One timer period: advance the frame, repaint the scene on terminal or redraw the pane on desktop. */
async function tick($: Api, desktop: boolean): Promise<void> {
  const crew = snapshot(await liveAgents($), Date.now());
  if (crew.working === 0 || view.tab !== "crew") return halt();
  view.frame += 1;
  if (desktop) {
    $.ui.invalidate("ui.render");
    return;
  }
  const { px } = scene(crew, view.cols, view.frame);
  const reply = await $.ui.blit({ requestId: PANE, key: SCENE_KEY, cells: packCells(px, view.cols), columns: view.cols, rows: SCENE_ROWS });
  if (reply?.deny) return halt();
  if (view.frame % ROSTER_EVERY_TICKS === 0) $.ui.invalidate("ui.render");
}

/** Stop the scene's timer if it runs. */
function halt(): void {
  stopTimer?.();
  stopTimer = null;
}

/** Settings from the mod store merged over defaults. Invalid stored values keep their defaults. */
async function loadSettings($: Api): Promise<Settings> {
  return settingsFrom(await $.store.get("settings"));
}

/** Validate and store {section: {key: value}}. Returns the errors; stores only when there are none. */
async function saveSettings($: Api, changes: Record<string, Record<string, unknown>>): Promise<string[]> {
  const errors = checkChanges(changes);
  if (errors.length) return errors;
  const next = mergeChanges(await loadSettings($), changes);
  await $.store.set("settings", next);
  return [];
}

/** Save one field change, recording any refusal under the field's id, then redraw. */
async function apply($: Api, id: string, section: string, key: string, value: unknown): Promise<void> {
  const errors = await saveSettings($, { [section]: { [key]: value } });
  if (errors.length) view.errors[id] = errors.join("; ");
  else delete view.errors[id];
  $.ui.invalidate("ui.render");
}

async function settingsTab($: Api, ui: Ui, cols: number): Promise<unknown[]> {
  const settings = await loadSettings($);
  const names = Object.keys(SCHEMA);
  const section = SCHEMA[view.section] ? view.section : names[0];
  const sec = SCHEMA[section];
  const rows: unknown[] = [
    ui.Select({
      key: "section", label: "Section", value: section,
      options: names.map((n) => ({ value: n, label: SCHEMA[n].title })),
      onSelect: (v: string) => {
        view.section = v;
        $.ui.invalidate("ui.render");
      },
    }),
    txt(ui, { dimColor: true }, sec.help),
  ];
  for (const [key, field] of Object.entries(sec.fields)) {
    rows.push(fieldRow($, ui, section, key, field, settings[section][key]));
  }
  return rows;
}

function fieldRow($: Api, ui: Ui, section: string, key: string, field: Field, current: unknown): unknown {
  const id = `${section}.${key}`;
  const error = view.errors[id];
  const children = [
    txt(ui, { bold: true }, key),
    fieldControl($, ui, id, section, key, field, current),
    error ? txt(ui, { color: "red" }, error) : null,
    txt(ui, { dimColor: true }, field.help),
  ].filter((x) => x !== null);
  return ui.Box({ flexDirection: "column", children });
}

function fieldControl($: Api, ui: Ui, id: string, section: string, key: string, field: Field, current: unknown): unknown {
  if (field.type === "bool") {
    return ui.Button({
      key: id, label: current ? "on" : "off", plain: true,
      onPress: () => apply($, id, section, key, !current),
    });
  }
  if (field.type === "enum") {
    return ui.Select({
      key: id, label: key, value: current,
      options: field.choices.map((c) => ({ value: c, label: c })),
      onSelect: (v: string) => apply($, id, section, key, v),
    });
  }
  const shown = field.type === "list" ? (current as string[]).join(`${listSep(field)} `) : String(current);
  return ui.Input({
    key: id, label: key, placeholder: field.type === "list" ? "comma, separated" : "", submitLabel: "Save",
    value: view.drafts[id] ?? shown,
    onInput: (text: string) => {
      view.drafts[id] = text;
    },
    onSubmit: async (text: string) => {
      const value = parseText(field, text);
      const error = validate(section, key, value);
      if (error) {
        view.errors[id] = error;
        $.ui.invalidate("ui.render");
        return;
      }
      delete view.drafts[id];
      await apply($, id, section, key, value);
    },
  });
}

/** The typed value of an Input's text: a whole number for int (NaN when blank), items for list, else the text. */
export function parseText(field: Field, text: string): unknown {
  if (field.type === "int") return text.trim() === "" ? NaN : Number(text.trim());
  if (field.type === "list") return text.split(listSep(field)).map((s) => s.trim()).filter((s) => s !== "");
  return text;
}

/** The separator between a list field's items: its `sep` when the schema sets one, else a comma. */
function listSep(field: Field): string {
  // ponytail: Field has no `sep` yet, so this reads a property the schema does not declare and yields ",".
  return (field as { sep?: string }).sep ?? ",";
}

const LEDGER_WIDTHS = [10, 12, 8, 6, 16, 6, 10, 10, 8];
const TOKEN_WIDTHS = [12, 14, 14, 8];

/** One fixed-width line: each cell cut or padded to its width, joined by a space. */
export function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.slice(0, widths[i]).padEnd(widths[i])).join(" ").trimEnd();
}

/** A quality bar of ten block characters for a value between 0 and 1. */
export function bar(quality: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, quality)) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/** Digits with thousands separators: 12345 -> 12,345. */
export function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

async function ledgerTab($: Api, ui: Ui, cols: number): Promise<unknown[]> {
  const state = readState(await $.store.get("ledger"));
  const { recent, by_key } = summary(state);
  if (recent.length === 0 && by_key.length === 0) {
    return [txt(ui, { dimColor: true }, "No agent runs recorded yet. Runs are added when a subagent finishes.")];
  }
  const rules = (await loadSettings($)).gate.rules as string[];
  const header = row(["Model", "Job", "Lang", "N", "Quality", "Pass", "Tok in", "Tok out", "Secs"], LEDGER_WIDTHS);
  const lines = [header, ...by_key.map(ledgerRow)].map((l) => l.slice(0, cols));
  const runs = recent.slice(0, 10).map((run) => runLine(run).slice(0, cols));
  return [
    txt(ui, { bold: true }, "By model, job and language"),
    ...lines.map((l, i) => txt(ui, { bold: i === 0, dimColor: i === 0 }, l)),
    ...suggestionRows($, ui, suggestions(state, rules), cols),
    txt(ui, { bold: true }, "Recent runs"),
    ...runs.map((l) => txt(ui, {}, l)),
  ];
}

/** A Suggestions heading, then each suggestion's line and its Add rule button. Nothing is added until pressed twice. */
function suggestionRows($: Api, ui: Ui, list: Suggestion[], cols: number): unknown[] {
  if (list.length === 0) return [];
  return [
    txt(ui, { bold: true }, "Suggestions"),
    ...list.flatMap((s, i) => [
      txt(ui, {}, s.text.slice(0, cols)),
      ui.Button({
        key: `suggest-${i}`, plain: true,
        label: view.armed === s.rule ? `Press again to add ${s.rule}` : "Add rule",
        onPress: () => addSuggestion($, s.rule),
      }),
    ]),
  ];
}

/** The first press arms the rule; a second press on the same armed rule puts it first in the gate rules. */
async function addSuggestion($: Api, rule: string): Promise<void> {
  if (view.armed !== rule) {
    view.armed = rule;
    $.ui.invalidate("ui.render");
    return;
  }
  const current = (await loadSettings($)).gate.rules as string[];
  view.armed = "";
  await saveSettings($, { gate: { rules: [rule, ...current] } });
  $.ui.invalidate("ui.render");
}

function ledgerRow(r: KeyStats): string {
  const q = Number(r.quality_mean);
  return row([
    String(r.model), String(r.job), String(r.lang), thousands(Number(r.n)), `${bar(q)} ${q.toFixed(2)}`,
    `${Math.round(Number(r.pass_rate) * 100)}%`, thousands(Number(r.tokens_in_mean)),
    thousands(Number(r.tokens_out_mean)), thousands(Number(r.duration_mean)),
  ], LEDGER_WIDTHS);
}

function runLine(run: Run): string {
  return `${run.ts.slice(0, 16).replace("T", " ")}  ${run.model}  ${run.job}/${run.lang}  ${run.verdict}  q=${run.quality.toFixed(2)}`;
}

async function tokensTab($: Api, ui: Ui, cols: number): Promise<unknown[]> {
  const usage: Api = (await $.session.usage()) ?? {};
  const ctx: Api = usage.context ?? {};
  const rows: unknown[] = [
    txt(ui, { bold: true }, "This session"),
    txt(ui, {}, `Context: ${thousands(Number(ctx.tokens ?? 0))} of ${thousands(Number(ctx.window ?? 0))} tokens (${Number(ctx.percent ?? 0)}%)`),
  ];
  for (const limit of Array.isArray(usage.rateLimits) ? usage.rateLimits : []) {
    rows.push(txt(ui, {}, `${limit.kind}: ${Number(limit.percentUsed ?? 0)}% used, resets ${resetText(limit.resetsAt)}`));
  }
  if (typeof usage.cost === "number") rows.push(txt(ui, {}, `Cost: $${usage.cost.toFixed(2)}`));
  rows.push(txt(ui, { bold: true }, "Subagent tokens by model (ledger)"));
  rows.push(...ledgerTokenRows(ui, tokenTotals(readState(await $.store.get("ledger"))), cols));
  return rows;
}

/** A rate-limit reset as UTC text. Accepts an ISO string or epoch seconds or milliseconds. */
export function resetText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 16).replace("T", " ");
  if (typeof value !== "number") return "unknown";
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/** One line per model with tokens in, tokens out and runs, or a note when the ledger is empty. */
function ledgerTokenRows(ui: Ui, totals: Record<string, { tokens_in: number; tokens_out: number; runs: number }>, cols: number): unknown[] {
  const models = Object.keys(totals).sort();
  if (models.length === 0) return [txt(ui, { dimColor: true }, "No subagent runs recorded yet.")];
  const head = row(["Model", "Tok in", "Tok out", "Runs"], TOKEN_WIDTHS);
  const lines = models.map((m) => {
    const t = totals[m];
    return row([m, thousands(t.tokens_in), thousands(t.tokens_out), thousands(t.runs)], TOKEN_WIDTHS);
  });
  return [head, ...lines].map((l, i) => txt(ui, { bold: i === 0 }, l.slice(0, cols)));
}
