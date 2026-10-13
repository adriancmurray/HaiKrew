/**
 * HaiKrew mod entry point. Claude Code calls register(on) once when the mod loads.
 * agent.spawn gates subagent models and adds settings instructions, turn.step applies a subagent's effort and
 * counts its tokens for the token warning, tool.call guards git-hook bypasses, squeezes noisy Bash and guards large
 * Reads, and the SubagentStop hook records each finished subagent in the ledger and flags the end of a parallel batch.
 * Pure logic lives in src/mod. The validator forbids passing `$` across imports, so `$` is used only here and in
 * the hooks of src/mod/pane.ts (the pane and band) and src/mod/agents.ts (the agent tools).
 */
import { isObject } from "../src/mod/api.ts";
import { settingsFrom } from "../src/mod/config.ts";
import type { Api } from "../src/mod/api.ts";
import { decideSpawn, decisionFor, historyFrom, noteDecision, wasExplored } from "../src/mod/decider.ts";
import type { DecisionRecord, DeciderSettings } from "../src/mod/decider.ts";
import { tag as promptTag } from "../src/mod/select.ts";
import { effortFor, gate, resolveModel } from "../src/mod/gate.ts";
import type { Choice, GateSettings } from "../src/mod/gate.ts";
import { callerType, hookGuard, isReadOnlyType, readGuard, readOnlyGuard, squeeze, tokenLimit } from "../src/mod/guards.ts";
import type { ChecksSettings, GuardsSettings, ReadGuardSettings, SqueezeSettings } from "../src/mod/guards.ts";
import { noteEffort, stepEffort } from "../src/mod/effort.ts";
import { noteSeamStart, noteSeamStop } from "../src/mod/seam.ts";
import { activityOf, agentModel, liveUsage, modelFamily, noteMainChunk, noteMainStep, noteSpawn, noteStop, noteTokens, noteToolCall, noteToolChange, noteTurnEnd, noteSnapshot, attributedPaths, porcelainPaths, rowFor, specOf, takeSnapshot, touched, touchedBy, unattributedChanges } from "../src/mod/crew.ts";
import type { RepoSnapshot } from "../src/mod/crew.ts";
import { addRun, applyOrHold, combineUsage, finalReport, parseCheckerVerdict, readState, runFromStop, summary } from "../src/mod/ledger.ts";
import { buildPacket, reviewNote, testsClaim } from "../src/mod/packet.ts";
import { applyDefects, countDefects } from "../src/mod/checker.ts";
import { checkerBucket, sizeOf } from "../src/mod/outcomes.ts";
import { reviewPlan } from "../src/mod/review.ts";
import type { ReviewSettings } from "../src/mod/review.ts";
import { registerPane } from "../src/mod/pane.ts";
import { delegationNote, withLeadNote, withNote } from "../src/mod/delegate.ts";
import type { DelegateSettings } from "../src/mod/delegate.ts";
import { ledgerLock } from "../src/mod/serial.ts";
import { checkHealth, healthLine } from "../src/mod/health.ts";
import { flagLate, mergeLate, repoOf } from "../src/mod/late.ts";
import type { LateFields, RunGit } from "../src/mod/late.ts";
import { applyLateFile, parseLateFile, setLateOff } from "../src/mod/late-file.ts";
import { registerAgentTools } from "../src/mod/agents.ts";
import { bashPaths, checkWrite, claimSpawn, editPaths, logConflicts, newBook, stopAgent } from "../src/mod/claims.ts";
import type { BoardSettings } from "../src/mod/claims.ts";
import type { Settings } from "../src/schema.ts";

/** Set at the first agent launch: the late-failure check runs once per load (the pane owns the one session.start hook). */
let startChecked = false;

/** The file claims of this session's subagents, per repo root (see src/mod/claims.ts). */
const claimBook = newBook(Date.now);

/** Claude Code calls this once when the mod loads, with the `on` that attaches hooks. */
export function register(on) {
  on("agent.spawn", async ($, e, next) => {
    const cfg = await loadSettings($);
    const gateCfg = cfg.gate as unknown as GateSettings;
    const cwd = await sessionCwd($);
    let choice = resolveModel(gateCfg, e, cwd);
    let record: DecisionRecord | undefined;
    let named = e;
    const dcfg = cfg.decider as unknown as DeciderSettings;
    // The check runs beside this spawn, so the spawn never waits on it: the decider call below uses the last known status.
    if (dcfg.mode !== "off") void deciderHealth($, dcfg);
    if (!startChecked) { startChecked = true; void lateFailures($, cfg).catch(() => undefined); }
    // Only a known-offline decider is skipped; an unknown one is tried, and the call's own timeout still applies.
    if (dcfg.mode !== "off" && gateCfg.enabled && healthLine() === "") {
      const found = await decide($, dcfg, gateCfg, e, choice, cwd);
      if (found) {
        ({ choice, record } = found);
        // The gate keeps a named model (and refuses Opus itself), so the decided model goes in as one. Shadow mode
        // leaves the spawn exactly as it came.
        if (dcfg.mode === "decide" && choice.model && !record?.error) named = { ...e, model: choice.model };
      }
    }
    return gate(gateCfg, named, async (passed) => {
      // The lead note rides in the spawn prompt: a subagent's first turn is then sure to carry it, with no lookup racing
      // the spawn. Forks inherit the parent's model, so they get none.
      const lead = passed.fork ? passed : { ...passed, prompt: withLeadNote(gateCfg as unknown as DelegateSettings,
        String(passed.prompt ?? ""), modelFamily(String(passed.model ?? "")), promptTag(passed.prompt, "job")) };
      // Started before the spawn, so the agent's own first writes cannot land in the snapshot.
      const snapping = repoSnapshot($, cwd);
      const reply = await next(lead);
      const snap = await snapping;
      noteSpawn(passed, reply, Date.now(), choice.rule);
      $.ui.invalidate("ui.render"); // crew changed: the band and pane redraw
      const id = typeof reply?.agentId === "string" ? reply.agentId : "";
      if (id && snap) noteSnapshot(id, snap);
      if (id) {
        claimSpawn(claimBook, cfg.board as unknown as BoardSettings, {
          id, name: rowFor(id, Date.now())?.name ?? id, task: String(passed.description ?? ""),
          parentId: passed.parentAgentId ? String(passed.parentAgentId) : null,
          root: snap?.root ?? cwd, base: cwd, owns: promptTag(passed.prompt, "owns"),
        });
        const effort = effortFor(gateCfg, choice, String(reply.model ?? passed.model ?? ""));
        if (effort) noteEffort(id, effort);
        if (record) noteDecision(id, record);
        noteSeamStart(id, cwd);
      }
      return reply;
    }, cwd);
  });

  // The main conversation's context: while the gate is on, the user's standing request to delegate (see delegate.ts).
  // A subagent gets none here: its lead note, when it has one, is in its spawn prompt (agent.spawn).
  on("prompt.context", async ($, e, next) => {
    const cfg = await loadSettings($);
    const gate = cfg.gate as unknown as DelegateSettings;
    const id = typeof e.agentId === "string" ? e.agentId : "";
    const note = id ? "" : delegationNote(gate, toolsOn(cfg));
    return next(note ? { ...e, blocks: withNote(e.blocks, note) } : e);
  });

  // The main loop's turn is over: the main agent in the band rests, or waits on a crew still working.
  on("turn.complete", async ($, e, next) => {
    const reply = await next(e);
    noteTurnEnd(String(e.turnId ?? ""));
    $.ui.invalidate("ui.render");
    return reply;
  });

  // Subagent steps only: stepEffort leaves the main loop (no agentId) and untracked agents unchanged.
  // Each subagent step also adds its usage to the agent's running total, for the token warning.
  on("turn.step", async function* ($, e, next) {
    // A main-loop step: the main agent in the band is busy until this turn completes.
    if (!e.agentId && typeof e.turnId === "string" && noteMainStep(e.turnId)) $.ui.invalidate("ui.render");
    const stepped = stepEffort(e);
    const stream = next(stepped);
    let chunk = await stream.next();
    try {
      while (!chunk.done) {
        // The main loop's text, thinking and tool calls drive the band's lead; every chunk goes on unchanged.
        if (!e.agentId && noteMainChunk(chunk.value)) $.ui.invalidate("ui.render");
        yield chunk.value;
        chunk = await stream.next();
      }
    } finally {
      // Closed early by the consumer: close the stream beneath too, as yield* would.
      await stream.return(undefined);
    }
    const result = chunk.value;
    if (e.agentId && result?.usage) {
      // The limit is the step's model and the effort it ran with (the tracked one when stepEffort set it).
      const checks = (await loadSettings($)).checks as unknown as ChecksSettings;
      const model = typeof e.model === "string" && e.model ? e.model : agentModel(String(e.agentId));
      const limit = tokenLimit(checks, model, String(stepped.effort ?? ""));
      const { total, crossed } = noteTokens(e.agentId, result.usage, limit, Date.now());
      if (crossed) {
        $.ui.toast(`HaiKrew: a subagent passed ${total.toLocaleString("en-US")} tokens (warning at ${limit.toLocaleString("en-US")})`);
        $.ui.invalidate("ui.render");
      }
    }
    return result;
  });

  // Redraw the band only when the agent's activity (what its critter shows) changes, or when it first appears.
  on("tool.call", async ($, e, next) => {
    const now = Date.now();
    const id = typeof e.agentId === "string" ? e.agentId : "";
    const before = id ? rowFor(id, now) : undefined;
    noteToolCall(e, now, false);
    const after = id ? rowFor(id, now) : undefined;
    if (after && (!before || activityOf(before) !== activityOf(after))) $.ui.invalidate("ui.render");
    const paths = editPaths(e);
    const refused = id && paths.length > 0 ? await claimWrite($, e, await callerType(() => $.agent.list(), id), paths) : null;
    if (refused) return refused;
    const reply = await next(e);
    // Changes count only once the call ran and succeeded: a refused call (`deny`) or a failed one (`isError`, e.g. an
    // Edit whose old text was not found) wrote nothing.
    if (id && !(isObject(reply) && (reply.deny || reply.isError))) {
      const shell = e.tool === "Bash" ? Number(((await loadSettings($)).review as unknown as ReviewSettings).light_lines) : 0;
      noteToolChange(e, shell || undefined);
    }
    return reply;
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const cfg = await loadSettings($);
    // The calling subagent's type; "" on the main loop, which the read-only guard never denies.
    const id = typeof e.agentId === "string" ? e.agentId : "";
    const type = id ? await callerType(() => $.agent.list(), id) : "";
    const cwd = type ? await sessionCwd($) : "";
    // The guards decide first (each with a next that passes), so a command they refuse claims nothing.
    const guarded = hookGuard(cfg.checks as unknown as ChecksSettings, e, () => null)
      ?? readOnlyGuard(cfg.guards as unknown as GuardsSettings, type, e, cwd, () => null)
      ?? squeeze(cfg.squeeze as unknown as SqueezeSettings, e, $.plugin.root, () => null);
    if (guarded) return guarded;
    const refused = await claimWrite($, e, type, bashPaths(String(e.command || "")));
    if (refused) return refused;
    return next(e);
  });

  on("tool.call", { tool: "Read" }, async ($, e, next) => {
    const cfg = await loadSettings($);
    const ranged = e.offset != null || e.limit != null;
    const text = cfg.read_guard.enabled && !ranged ? await readFile($, String(e.file_path || "")) : null;
    return readGuard(cfg.read_guard as unknown as ReadGuardSettings, e, text, next);
  });

  on("classic.SubagentStop", async ($, e, next) => {
    let run: StopRun | null = null;
    let unattributed: string[] = [];
    try {
      unattributed = await unattributedAtStop($, String(e.agent_id ?? ""));
    } catch {
      // The check never blocks a subagent from finishing.
    }
    try {
      run = await recordStop($, e, unattributed);
    } catch {
      // The ledger never blocks a subagent from finishing.
    }
    try {
      await planReview($, e, run);
    } catch {
      // A review note never blocks a subagent from finishing either.
    }
    await releaseClaims($, String(e.agent_id ?? ""));
    noteStop(String(e.agent_id ?? ""), String(e.agent_type ?? ""), run?.self_verdict ?? null, Date.now(), run?.model ?? "");
    $.ui.invalidate("ui.render"); // crew changed: the band and pane redraw
    const seam = noteSeamStop(String(e.agent_id ?? ""));
    if (seam) {
      $.ui.log(seam);
      if ((await loadSettings($)).checks.seam_check) void $.prompt.submit({ text: seam });
    }
    return next(e);
  });

  registerPane(on);
  registerAgentTools(on, "haikrew");
}

/** Asks the decider endpoint about a spawn the gate left to its default; null on any failure or when it does not apply. */
async function decide($: Api, dcfg: DeciderSettings, gateCfg: GateSettings, e: Record<string, unknown>, choice: Choice, cwd: string) {
  try {
    const state = readState(await $.store.get("ledger"));
    const history = historyFrom(summary(state).by_key);
    const deps = {
      ask: async (body: Record<string, unknown>) => {
        const r = await $.http.fetch(`${dcfg.url.replace(/\/+$/, "")}/v1/systemone`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`http ${r.status}`);
        try { return JSON.parse(r.text); } catch { return null; }
      },
      wait: (ms: number) => new Promise<void>((resolve) => { $.clock.after(ms, resolve); }),
      random: Math.random,
      now: Date.now,
    };
    const tags = Object.fromEntries(["job", "lang", "name"].map((k) => [k, promptTag(e.prompt, k)]).filter(([, v]) => v));
    return await decideSpawn(deps, dcfg, gateCfg, e, choice, cwd, history, tags, state.runs);
  } catch {
    return null;
  }
}

/** git (any command) through the mod's process runner; its stdout, or "" on any failure. */
function gitOf($: Api, unavailable?: { value: boolean }): RunGit {
  return async (argv, cwd) => {
    try {
      const r = await $.process.run(argv, { cwd, timeoutMs: 15000 });
      return r.exitCode === 0 ? r.stdout : "";
    } catch {
      // $.process is CLI only (and must never be read as a value): a throw means this surface has no process runner.
      if (unavailable) unavailable.value = true;
      return "";
    }
  };
}

// -z: paths come unquoted and NUL-separated, so spaces and non-ASCII names match the edit tool's paths.
const STATUS_ARGV = ["git", "status", "--porcelain", "-z", "-uall"];

/** `work`, or `fallback` when it has not settled in two seconds, so a git call never holds a hook up. */
function bounded<T>($: Api, work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((r) => { $.clock.after(2000, () => r(fallback)); })]);
}

/** The repo root and its `git status` paths at `cwd`; null outside a repo, or when git is unavailable or slow. */
async function repoSnapshot($: Api, cwd: string): Promise<RepoSnapshot | null> {
  const git = gitOf($);
  const work = (async () => {
    const root = (await git(["git", "rev-parse", "--show-toplevel"], cwd)).trim();
    return root ? { root, paths: porcelainPaths(await git(STATUS_ARGV, root)) } : null;
  })();
  return bounded($, work, null);
}

/** The changes since agent `id` spawned that no agent explains, read now; [] without a snapshot or when git is slow. */
async function unattributedAtStop($: Api, id: string): Promise<string[]> {
  const snap = takeSnapshot(id);
  if (!snap) return [];
  const now = await bounded<Set<string> | null>($, gitOf($)(STATUS_ARGV, snap.root).then(porcelainPaths), null);
  return now ? unattributedChanges(snap.root, snap.paths, now, attributedPaths(Date.now())) : [];
}

/**
 * A run's repo and repo-relative files, and those files split by the edit tool and the shell. One repoOf call finds the
 * root; each absolute path under that root is made relative to it, so a path under a symlinked root is left out of files_by.
 */
async function locateFiles($: Api, by: { edit: string[]; shell: string[] }): Promise<LateFields & { files_by: { edit: string[]; shell: string[] } }> {
  const all: LateFields = (await bounded<LateFields | null>($, repoOf([...by.edit, ...by.shell], gitOf($)), null)) ?? {};
  const root = all.repo ? `${all.repo}/` : "";
  const relative = (paths: string[]): string[] => paths.filter((p) => root && p.startsWith(root)).map((p) => p.slice(root.length));
  return { ...all, files_by: { edit: relative(by.edit), shell: relative(by.shell) } };
}

/**
 * Flags passed runs of the last ledger.late_fail_days days that a later fix commit touched (see late.ts). With $.process
 * git runs here when the call works (CLI); otherwise the flags file `haikrew late-failures` writes is merged, and when that is missing
 * too the Insights card says detection is off.
 */
async function lateFailures($: Api, cfg: Settings): Promise<void> {
  if (!cfg.ledger.enabled) return;
  const state = readState(await $.store.get("ledger"));
  let flagged: Run[];
  const unavailable = { value: false };
  const git = gitOf($, unavailable);
  await git(["git", "--version"], "/"); // a probe, so a surface without a process runner is known even when no run needs git
  const found = unavailable.value ? { runs: state.runs, changed: false } : await flagLate(state.runs, Date.now(), Number(cfg.ledger.late_fail_days), git);
  if (!unavailable.value) {
    setLateOff(false);
    if (!found.changed) return;
    flagged = found.runs;
  } else {
    const home = await $.env.get("HOME");
    const text = home ? await readFile($, `${home}/.claude/plugins/store/haikrew-late.json`) : null;
    setLateOff(text === null);
    if (text === null) return;
    flagged = applyLateFile(state.runs, parseLateFile(text));
  }
  // Merge by agent id and time into the freshest ledger, so runs added while git ran are kept.
  await ledgerLock(async () => {
    const fresh = readState(await $.store.get("ledger"));
    await $.store.set("ledger", { ...fresh, runs: mergeLate(fresh.runs, flagged) });
  });
}

/** Checks the decider's /health (at most every 10 minutes); one toast when it is down. Never throws. */
async function deciderHealth($: Api, dcfg: DeciderSettings): Promise<void> {
  if (dcfg.mode === "off") return;
  try {
    const get = (url: string, ms: number) => Promise.race([
      $.http.fetch(url).then((r) => r.ok),
      new Promise<boolean>((resolve) => { $.clock.after(ms, () => resolve(false)); }),
    ]);
    const text = await checkHealth(dcfg.url, Date.now(), get);
    $.ui.invalidate("ui.render");
    if (text) $.ui.toast(text);
  } catch {
    // A health check never blocks a launch.
  }
}

/** The session's folder, or "" when Claude Code cannot say. */
async function sessionCwd($): Promise<string> {
  try {
    return await $.session.cwd();
  } catch {
    return "";
  }
}

/** The main conversation's model, or "" when Claude Code cannot say. */
async function sessionModel($): Promise<string> {
  try {
    return String(await $.session.model());
  } catch {
    return "";
  }
}

/** Settings from the mod store, merged over defaults. */
async function loadSettings($: Api): Promise<Settings> {
  return settingsFrom(await $.store.get("settings"));
}

/** A file's text, or null when it cannot be read (missing, or over the 4 MiB limit). */
async function readFile($: Api, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}

/**
 * Append the finished subagent's run to the ledger and return its verdict and model. Skips (returns null) when ledger.enabled
 * is off or the transcript is unreadable.
 */
async function recordStop($: Api, e: Record<string, unknown>, unattributed: string[]): Promise<StopRun | null> {
  const cfg = await loadSettings($);
  const path = typeof e.agent_transcript_path === "string" ? e.agent_transcript_path : "";
  const transcript = cfg.ledger.enabled && path ? await readFile($, path) : null;
  if (transcript === null) return null;
  // The transcript's usage lines hold stream-start counts, so the usage counted live from each step wins when seen,
  // unless the transcript saw more input than the live count did (combineUsage).
  const parsed = runFromStop(e, transcript);
  const live = liveUsage(String(e.agent_id ?? ""));
  const run = live ? combineUsage(parsed, live) : parsed;
  const decision = decisionFor(run.agent_id);
  const entry = { ...run, ...(await locateFiles($, touchedBy(run.agent_id))), ...(unattributed.length ? { unattributed } : {}), name: rowFor(run.agent_id, Date.now())?.name, ...(decision ? { decision } : {}) };
  await ledgerLock(async () => {
    await $.store.set("ledger", addRun(readState(await $.store.get("ledger")), entry, cfg));
  });
  return { self_verdict: run.self_verdict ?? "none", model: run.model, job: run.job, lang: run.lang, report: finalReport(transcript), unattributed };
}

/**
 * After the run is recorded: a checker's verdict line settles the run it names; any other finished agent (except a review
 * or check job) gets a review plan, and a tier above none stores a packet and tells the main conversation.
 */
async function planReview($, e: Record<string, unknown>, run: StopRun | null): Promise<void> {
  if (!run) return;
  const id = String(e.agent_id ?? "");
  const name = rowFor(id, Date.now())?.name ?? id;
  const checked = parseCheckerVerdict(run.report);
  if (checked) {
    await ledgerLock(async () => {
      const defects = countDefects(run.report, checked.verdict === "fail");
      const marked = applyOrHold(readState(await $.store.get("ledger")), { name: checked.name, verdict: checked.verdict, checker: name, defects });
      await $.store.set("ledger", applyDefects(marked, { checkerId: id, checkedName: checked.name }, defects));
    });
    return;
  }
  if (run.job === "review" || run.job === "check") return;
  const cfg = await loadSettings($);
  const state = readState(await $.store.get("ledger"));
  const stats = summary(state).by_key
    .find((k) => k.model === run.model && k.job === run.job && k.lang === run.lang);
  const record = stats && Number(stats.judged) > 0 ? { judged: Number(stats.judged), passRate: Number(stats.pass_rate) } : null;
  const { paths, lines } = touched(id);
  const own = state.runs.find((r) => r.agent_id === id);
  const bucket = checkerBucket(state.runs, run.job, run.lang, own ? sizeOf(own) : "");
  const plan = reviewPlan({ checkerBucket: bucket, mainModel: await sessionModel($), job: run.job, lang: run.lang, paths, lines, testsPassed: testsClaim(run.report), model: run.model, record, explored: wasExplored(id) },
    (cfg as unknown as { review: ReviewSettings }).review, Boolean(cfg.gate.allow_opus));
  if (plan.skipped) {
    // Counted per bucket by checkerBucket, so every Nth skipped kind gets a checker again.
    await ledgerLock(async () => {
      const cur = readState(await $.store.get("ledger"));
      await $.store.set("ledger", { ...cur, runs: cur.runs.map((r) => (r.agent_id === id ? { ...r, checker_skipped: true } : r)) });
    });
  }
  if (plan.tier === "none") return;
  const packet = buildPacket({ name, type: String(e.agent_type ?? "agent"), model: run.model, spec: specOf(id), report: run.report,
    paths, lines, testsPassed: testsClaim(run.report), plan, unattributed: run.unattributed });
  // Packets are keyed by the (session-unique) name; review_packet_ids maps agent id -> name so a lookup by id finds it first.
  await ledgerLock(async () => {
    const packets = asRecord(await $.store.get("review_packets"));
    const ids = asRecord(await $.store.get("review_packet_ids"));
    for (const k of Object.keys(ids)) if (ids[k]?.toLowerCase() === name.toLowerCase() || k === id) delete ids[k];
    for (const k of Object.keys(packets)) if (k.toLowerCase() === name.toLowerCase()) delete packets[k];
    packets[name] = packet;
    ids[id] = name;
    const keep = Object.keys(packets).slice(-20); // insertion order: the newest last
    await $.store.set("review_packets", Object.fromEntries(keep.map((k) => [k, packets[k]])));
    await $.store.set("review_packet_ids", Object.fromEntries(Object.entries(ids).filter(([, n]) => keep.includes(n))));
  });
  // A resumed agent that stops again is noted once more only when its touched lines or paths grew (a deletion-only new
  // file adds a path and no lines); the packet above still updates.
  const noted = notedLines(await $.store.get("review_noted"));
  const seen = noted[id];
  if (seen && lines <= seen.lines && paths.length <= seen.paths) return;
  // Without agent tools the reviewer cannot fetch the packet, so the note carries it.
  const text = reviewNote(name, plan, paths, lines, { toolsOn: toolsOn(cfg), packet: String(packet) });
  if (!text) return;
  try {
    // A plugin's append takes the row alone; the engine stamps its origin (this plugin) and door itself.
    await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
    await ledgerLock(async () => {
      const kept = notedLines(await $.store.get("review_noted"));
      delete kept[id];
      kept[id] = { lines, paths: paths.length };
      await $.store.set("review_noted", Object.fromEntries(Object.entries(kept).slice(-200)));
    });
  } catch {
    // A refused append only loses the note, and the next stop of this agent notes it again.
  }
}

/**
 * A subagent's write to `paths`, checked before the call runs: null to let it run, or {deny} to refuse it. A clash with
 * another live agent is logged. A warned clash that is retried goes through, and its note reaches the main conversation
 * as a review note does (a built-in tool's result is not amended here). A read-only type claims nothing; the main
 * thread never claims or clashes.
 */
async function claimWrite($, e: Record<string, unknown>, type: string, paths: string[]): Promise<{ deny: string } | null> {
  const id = typeof e.agentId === "string" ? e.agentId : "";
  if (!id || paths.length === 0) return null;
  const row = rowFor(id, Date.now());
  const writer = { id, name: row?.name ?? id, task: row?.task ?? "", readOnly: isReadOnlyType(type) };
  // Paths are absolute here: edit tools carry absolute paths, and bashPaths drops the relative ones.
  const out = checkWrite(claimBook, (await loadSettings($)).board as unknown as BoardSettings, writer, paths, "");
  try {
    await logConflicts(storeOf($), out.logged);
    for (const note of out.notes) {
      await $.session.append({ message: { type: "user", content: [{ type: "text", text: `${writer.name}: ${note}` }] } });
    }
  } catch {
    // A failed log or note never blocks the write.
  }
  return out.deny ? { deny: out.deny } : null;
}

/** A subagent stopped: its claims start their grace window and its open conflicts settle in the store. Never throws. */
async function releaseClaims($, id: string): Promise<void> {
  try {
    await logConflicts(storeOf($), stopAgent(claimBook, id));
  } catch {
    // The board never blocks a subagent from finishing.
  }
}

/** The mod store in the shape the claims log takes: `$` itself is not passed across an import. */
function storeOf($) {
  return { get: (key: string) => $.store.get(key), set: (key: string, value: unknown) => $.store.set(key, value) };
}

/** Whether models can call record_verdict (agent control "change"); "read" refuses it and "off" registers no tools. */
function toolsOn(cfg: unknown): boolean {
  return (cfg as { agents?: { control?: string } }).agents?.control === "change";
}

type StopRun = { self_verdict: string; model: string; job: string; lang: string; report: string; unattributed: string[] };

function asRecord(v: unknown): Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? { ...(v as Record<string, string>) } : {};
}

/** The review_noted store value: agent id -> touched lines and paths when that agent was last noted. */
function notedLines(v: unknown): Record<string, { lines: number; paths: number }> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? { ...(v as Record<string, { lines: number; paths: number }>) } : {};
}
