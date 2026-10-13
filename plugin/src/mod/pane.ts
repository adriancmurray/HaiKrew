/**
 * HaiKrew's `/haikrew` pane. On desktop one page (pane-home.ts): banner, gate, controls, crew, tokens, track
 * record and settings. On the terminal a gate line, a tab row and one of three tabs (Home, Ledger, Settings). Every `$` use stays in this file, since the engine follows `$` into functions
 * of this file only: it loads the data, saves settings and runs the scene's timer, and hands each tab file plain
 * values and an Actions object of closures.
 */
import type { Settings } from "../schema.ts";
import { checkChanges, mergeChanges, settingsFrom } from "./config.ts";
import { leadActivity, leadState, snapshot } from "./crew.ts";
import type { Crew, LiveAgent } from "./crew.ts";
import { mergeRescanned, readState, rescanRun, tokenTotals } from "./ledger.ts";
import { homeOf } from "./select.ts";
import type { LedgerState, Run } from "./ledger.ts";
import { AGENT_TOOLS, allowed } from "./agents.ts";
import { SCENE_KEY } from "./pane-crew.ts";
import { agentTranscript } from "./pane-agent.ts";
import type { AgentMessage } from "./pane-agent.ts";
import { crewBand, desktopView, latestLine, terminalHome, updateStrip } from "./pane-home.ts";
import { ledgerTab } from "./pane-ledger.ts";
import { settingsTab } from "./pane-settings.ts";
import { packCells, scene, SCENE_ROWS } from "./sprites.ts";
import { availableUpdate, checkUpdate, recordOf, runUpdate, versionOf } from "./update.ts";
import { C, hrow, onOff, TABS, txt, vcol, view } from "./ui.ts";
import type { Actions, Ui } from "./ui.ts";

/** The pane id and command name: "haikrew", or another name a development copy registers under. */
let PANE = "haikrew";
const TICK_MS = 250;
/** Off the terminal the scene animates itself; the timer only refreshes the roster's times and last tools. */
const DESKTOP_TICK_MS = 2000;
/** Terminal ticks between roster redraws, so the roster refreshes about once a second. */
const ROSTER_EVERY_TICKS = 4;
/** The scene's timer while it runs; null when it is stopped. */
// The slow sky tick, started once per load at session start.
let skyTimer: unknown = null;
const SKY_TICK_MS = 15 * 60 * 1000;
let stopTimer: (() => void) | null = null;
type Api = Record<string, any>;

/** Claude Code calls this once when the mod loads. Adds the /haikrew command (or `/<name>`) at session start and draws its pane. */
export function registerPane(on: (...args: unknown[]) => void, name = "haikrew"): void {
  PANE = name;
  on("session.start", async ($: Api, e: Api, next: (e: Api) => unknown) => {
    try {
      await $.command.register({ name: PANE, description: "Open the HaiKrew pane: crew, settings, ledger, token use" });
    } catch {
      // The pane still opens through the command.run hook when registration is refused.
    }
    const reply = await next(e);
    void repairLedger($);
    // The band has no redraw timer; this slow one lets an idle sky move on (dusk to night) and the moon change. The
    // band's SVG is cached by what it shows, so a tick that changes nothing hands the app the same picture.
    if (!skyTimer) {
      skyTimer = $.clock.every(SKY_TICK_MS, () => {
        $.ui.invalidate("ui.render");
        void loadSettings($).then((s) => startUpdateCheck($, s));
      });
    }
    const settings = await loadSettings($);
    startUpdateCheck($, settings);
    if (allowed(settings, "status") === null) await registerTools($);
    if (settings.pane.open_on_start) await $.ui.open({ id: PANE, title: "HaiKrew" });
    return reply;
  });

  on("command.run", { command: PANE }, async ($: Api) => {
    await $.ui.open({ id: PANE, title: "HaiKrew", focus: true, closeOnEscape: true });
    return { text: "HaiKrew pane opened." };
  });

  on("ui.close", async ($: Api, e: Api, next: (e: Api) => unknown) => {
    if (e.id === PANE) halt();
    return next(e);
  });

  // The crew in the band above the prompt, on the desktop: always there unless the person turned it off, and
  // stepping aside while a survey holds the band.
  on("ui.render", { component: "AbovePrompt" }, async ($: Api, e: Api, next: (e: Api) => unknown) => {
    if (e.surface === "terminal" || e.props?.hasSurvey) return next(e);
    const settings = await loadSettings($);
    if (!settings.band.show) return next(e);
    const ui = $.ui.resolve(e) as Ui;
    startUpdateCheck($, settings, true);
    const latest = await updateOf($, settings);
    const crew = snapshot(await liveAgents($), Date.now());
    crew.lead = { state: leadState(crew.working), model: String(await $.session.model().catch(() => "")), activity: leadActivity() };
    // No timer here: the band's loops run inside its SVG, and it redraws only when what it shows changes.
    return crewBand(ui, crew, Math.max(24, Number(e.props?.bodyColumns) || 80), await themeIsDark($), {
      band: settings.band, messages: await latestMessages($, crew), now: Date.now(),
      open: () => $.ui.open({ id: PANE, title: "HaiKrew", focus: true, closeOnEscape: true }),
      update: latest ? { latest: latest.latest, manual: latest.manual, run: () => actions($).update() } : undefined,
      openAgent: (row) => {
        agentInView = row.id;
        $.ui.invalidate("ui.render");
        return $.ui.open({ id: `${PANE}-agent`, title: `HaiKrew · ${row.name}`, focus: true, closeOnEscape: true });
      },
    });
  });

  on("ui.render", { component: "Pane" }, async ($: Api, e: Api, next: (e: Api) => unknown) => {
    if (e.requestId === `${PANE}-agent`) return agentPane($, e);
    if (e.requestId !== PANE) return next(e);
    const ui = $.ui.resolve(e) as Ui;
    const cols = Math.max(24, Number(e.props?.bodyColumns) || 80);
    const inner = cols - 2;
    const surface = String(e.surface ?? "terminal");
    const act = actions($);
    const settings = await loadSettings($);
    const ledger = readState(await $.store.get("ledger"));
    startUpdateCheck($, settings, true);
    const update = await updateOf($, settings);
    const crew = snapshot(await liveAgents($), Date.now());
    if (crew.working > 0 && (surface !== "terminal" || view.tab === "home")) startTimer($, surface !== "terminal");
    if (surface !== "terminal") {
      const data = { crew, settings, ledger, usage: await sessionUsage($), messages: await latestMessages($, crew), dark: await themeIsDark($), update };
      return desktopView(ui, act, data, gateLine(ui, act, Boolean(settings.gate.enabled), crew.working, ledger, true), cols);
    }
    const nav = vcol(ui, { rowGap: 1 }, [
      update ? updateStrip(ui, act, update) : null,
      gateLine(ui, act, Boolean(settings.gate.enabled), crew.working, ledger, false),
      hrow(ui, { columnGap: 1, flexWrap: "wrap" }, TABS.map(([id, label], i) => ui.Button({
        key: `tab-${id}`, label: `${i + 1} ${label}`, hotkey: String(i + 1),
        variant: view.tab === id ? "primary" : "secondary",
        onPress: () => {
          view.tab = id;
          act.redraw();
        },
      }))),
    ]);
    let body: unknown[];
    if (view.tab === "home") {
      view.cols = inner;
      body = terminalHome(ui, { crew, settings, ledger, usage: await sessionUsage($), messages: {}, dark: true }, inner);
    } else if (view.tab === "ledger") {
      body = ledgerTab(ui, act, ledger, settings, inner);
    } else {
      body = settingsTab(ui, act, settings, inner);
    }
    return vcol(ui, { paddingX: 1, width: cols, rowGap: 1 }, [nav, ...body]);
  });
}

// The subagent whose transcript the agent pane shows, set from its card in the band.
let agentInView = "";

/** The agent pane: one subagent's transcript, redrawn on the timer while it works. */
async function agentPane($: Api, e: Api): Promise<unknown> {
  const ui = $.ui.resolve(e) as Ui;
  const cols = Math.max(24, Number(e.props?.bodyColumns) || 80);
  const row = snapshot(await liveAgents($), Date.now()).rows.find((r) => r.id === agentInView);
  if (row?.state === "working") startTimer($, true);
  let messages: AgentMessage[] = [];
  try {
    messages = agentInView ? await $.session.messages({ agentId: agentInView }) : [];
  } catch {
    // Its messages cannot be read (it ended before this session started); the header still says who it was.
  }
  return vcol(ui, { paddingX: 1, width: cols }, [agentTranscript(ui, row, messages, cols - 2)]);
}

/** The closures the tabs call; each one reaches the host through this file's `$`. */
function actions($: Api): Actions {
  return {
    redraw: () => $.ui.invalidate("ui.render"),
    save: (id, section, key, value) => apply($, id, section, key, value),
    addRule: async (rule, replaces) => {
      const current = (await loadSettings($)).gate.rules as string[];
      const at = replaces ? current.indexOf(replaces) : -1;
      const next = at >= 0 ? current.map((r, i) => (i === at ? rule : r)) : [rule, ...current];
      await saveSettings($, { gate: { rules: next } });
      $.ui.invalidate("ui.render");
    },
    retry: async (agent, model) => {
      // The main conversation runs the retry, so the main model still writes the spec and checks the result.
      const task = agent.task ? ` "${agent.task}"` : "";
      await $.prompt.submit({ text: `HaiKrew: the ${agent.type} subagent${task} did not pass on ${agent.model}. ` +
        `Run the same task again as a subagent with model ${model}, then check its result.` });
      $.ui.toast(`HaiKrew: asked Claude to retry on ${model}`);
    },
    update: async () => {
      if (view.updating || typeof $.process?.run !== "function") return;
      const latest = recordOf(await $.store.get("update"))?.latest ?? "";
      view.updating = true;
      view.updateNote = "";
      $.ui.invalidate("ui.render");
      // Only on the press: the one place HaiKrew runs a command of its own.
      view.updateNote = await runUpdate((argv) => $.process.run(argv, { timeoutMs: 120_000 }), latest);
      view.updating = false;
      $.ui.invalidate("ui.render");
    },
  };
}

/** The installed version, read once from this plugin's own plugin.json; "" when it cannot be read. */
let installedVersion: string | null = null;
async function installedOf($: Api): Promise<string> {
  if (installedVersion === null) installedVersion = versionOf(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => ""));
  return installedVersion;
}

/** A newer release than the installed one, when the check is on and has found one. */
async function updateOf($: Api, settings: Settings): Promise<{ latest: string; installed: string; manual: boolean } | undefined> {
  if (!settings.pane.update_check) return undefined;
  try {
    const installed = await installedOf($);
    const latest = availableUpdate(installed, recordOf(await $.store.get("update")));
    return latest ? { latest, installed, manual: typeof $.process?.run !== "function" } : undefined;
  } catch {
    return undefined;
  }
}

let updateTried = false;
/**
 * Look for a newer release, without waiting: from session start, the slow sky timer and the first render, never from
 * an agent launch. checkUpdate throttles itself to one request per 6 hours; the pane redraws only when it asked.
 */
function startUpdateCheck($: Api, settings: Settings, once = false): void {
  if (!settings.pane.update_check || (once && updateTried)) return;
  updateTried = true;
  void (async () => {
    try {
      const before = recordOf(await $.store.get("update"))?.checkedAt;
      const get = async (url: string, ms: number): Promise<string> => {
        const r = await Promise.race([
          $.http.fetch(url),
          new Promise<never>((_, reject) => { $.clock.after(ms, () => reject(new Error("timeout"))); }),
        ]);
        return r.ok ? String(r.text) : "";
      };
      const record = await checkUpdate({ now: Date.now(), load: () => $.store.get("update"), save: (r) => $.store.set("update", r), get });
      if (record && record.checkedAt !== before) $.ui.invalidate("ui.render");
    } catch {
      // Silent: the strip simply does not show.
    }
  })();
}

/**
 * The gate's state in words and colour with its switch (hotkey g), and one line of counts. On desktop the banner
 * above carries the name, so `banner` leaves the title out.
 */
function gateLine(ui: Ui, act: Actions, on: boolean, working: number, ledger: LedgerState, banner: boolean): unknown {
  const runs = Object.values(tokenTotals(ledger)).reduce((n, t) => n + t.runs, 0);
  const counts = `${working} ${working === 1 ? "agent" : "agents"} working · ${runs} ${runs === 1 ? "run" : "runs"} recorded`;
  return vcol(ui, banner ? { alignItems: "center" } : {}, [
    hrow(ui, { justifyContent: banner ? "center" : "space-between", alignItems: "center", flexWrap: "wrap", columnGap: 2 }, [
      banner ? null : txt(ui, { bold: true, color: C.accent }, "HaiKrew"),
      hrow(ui, { columnGap: 1, alignItems: "center" }, [
        txt(ui, { bold: true, color: on ? C.ok : C.warn }, "Model gate"),
        onOff(ui, "gate-switch", on, (v) => act.save("gate.enabled", "gate", "enabled", v), "g"),
      ]),
    ].filter((x) => x !== null)),
    txt(ui, { dimColor: true, wrap: "truncate-end" }, on ? `${counts} · applies to every session`
      : "Off: subagents run on whatever model they ask for. Turn it on to route them, in every session."),
  ]);
}

/**
 * One-time repair (ledger v2): runs recorded before 0.6.3 read verdicts only from `VERDICT:` lines and left cache
 * writes out of their input. Re-read each kept run's transcript, where it is still on disk, through rescanRun.
 * Output tokens of those runs stay estimates; the transcripts do not hold final counts. A run whose transcript cannot
 * be read keeps its record. Runs once, then marks it, even when some runs were skipped.
 */
async function repairLedger($: Api): Promise<void> {
  try {
    if (await $.store.get("ledger_v3")) return;
    const home = homeOf(String(await $.session.cwd().catch(() => "")));
    if (!home) return;
    const root = `${home}/.claude/projects`;
    const projects = (await $.fs.list(root)).filter((p: { kind: string }) => p.kind === "dir");
    const rescanned: Run[] = [];
    for (const run of readState(await $.store.get("ledger")).runs) {
      try {
        const text = await transcriptOf($, root, projects, run);
        if (text !== null) rescanned.push(rescanRun(run, text));
      } catch {
        // Too large or unreadable: this run keeps its record.
      }
    }
    // The transcripts took a while to read, so the ledger is read again: runs stored meanwhile are kept.
    await $.store.set("ledger", mergeRescanned(readState(await $.store.get("ledger")), rescanned));
    await $.store.set("ledger_v3", true);
    $.ui.invalidate("ui.render");
  } catch {
    // The repair is tried again at the next session start.
  }
}

/** The text of a run's subagent transcript, from whichever project folder holds it; null when none does. */
async function transcriptOf($: Api, root: string, projects: Array<{ name: string }>, run: Run): Promise<string | null> {
  if (!run.session || !run.agent_id) return null;
  for (const p of projects) {
    const path = `${root}/${p.name}/${run.session}/subagents/agent-${run.agent_id}.jsonl`;
    if (await $.fs.exists(path)) return await $.fs.read(path);
  }
  return null;
}

/** How long an agent's latest line is reused before its messages are read again. */
const LINE_TTL_MS = 10_000;
/** An agent's latest line and when it was read; "" when its messages could not be read. */
type LineMemo = { at: number; line: string };
/** The latest line of each agent, by id, so a band redraw does not read every agent's messages. */
const lineMemo = new Map<string, LineMemo>();

/**
 * Each working agent's latest line of text, by id, reused for LINE_TTL_MS. An agent whose messages cannot be read is
 * left out.
 */
async function latestMessages($: Api, crew: Crew): Promise<Record<string, string>> {
  const now = Date.now();
  for (const [id, hit] of lineMemo) if (now - hit.at >= LINE_TTL_MS) lineMemo.delete(id);
  const out: Record<string, string> = {};
  for (const r of crew.rows.filter((row) => row.state === "working").slice(0, 8)) {
    const line = await cachedLine(lineMemo, r.id, now, () => readLine($, r.id));
    if (line) out[r.id] = line;
  }
  return out;
}

/** `id`'s memoised line while it is younger than LINE_TTL_MS, else `read()`'s, memoised at `now`. */
export async function cachedLine(memo: Map<string, LineMemo>, id: string, now: number, read: () => Promise<string>): Promise<string> {
  const hit = memo.get(id);
  if (hit && now - hit.at < LINE_TTL_MS) return hit.line;
  const line = await read();
  memo.set(id, { at: now, line });
  return line;
}

/** An agent's latest line of text; "" when its messages cannot be read, and the roster shows its last tool instead. */
async function readLine($: Api, id: string): Promise<string> {
  try {
    return latestLine(await $.session.messages({ agentId: id }));
  } catch {
    return "";
  }
}

/** Whether the app's theme setting is dark; true when it cannot be read or does not say light. */
async function themeIsDark($: Api): Promise<boolean> {
  try {
    const row = (await $.config.list()).find((r: { key: string }) => r.key === "theme");
    return !String(row?.value ?? "dark").toLowerCase().startsWith("light");
  } catch {
    return true;
  }
}

/** This session's usage, or nothing when the host cannot say; the token block then shows empty gauges. */
async function sessionUsage($: Api): Promise<Record<string, any>> {
  try {
    return (await $.session.usage()) ?? {};
  } catch {
    return {};
  }
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
  if (!errors.length && section === "agents" && value !== "off") await registerTools($);
  $.ui.invalidate("ui.render");
}

/** Register the agent tools; a refusal leaves them for the next session start. The pane works without them. */
async function registerTools($: Api): Promise<void> {
  for (const spec of AGENT_TOOLS) {
    try {
      await $.tool.register(spec);
    } catch {
      // Registration is refused before the session binds.
    }
  }
}

/** Start the scene's timer unless it runs. It stops itself when no agent works, the tab is left or a blit is refused. */
function startTimer($: Api, desktop: boolean): void {
  if (stopTimer) return;
  stopTimer = $.clock.every(desktop ? DESKTOP_TICK_MS : TICK_MS, () => void tick($, desktop));
}

/** One timer period: advance the frame, repaint the scene on terminal or redraw the pane on desktop. */
async function tick($: Api, desktop: boolean): Promise<void> {
  const crew = snapshot(await liveAgents($), Date.now());
  if (crew.working === 0 || (!desktop && view.tab !== "home")) {
    // One last redraw so the crew stops bobbing and the roster shows who finished.
    if (desktop) $.ui.invalidate("ui.render");
    return halt();
  }
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
