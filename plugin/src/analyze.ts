/**
 * `haikrew analyze`: the routing outcomes and insights from the ledger, as plain text. Read-only: it reads the newest
 * haikrew_inline store file, or the file named by --store. The file reads and the output are injected (see AnalyzeIo),
 * so this module needs no Node APIs; cli.ts supplies the real ones.
 */
import { isObject } from "./mod/api.ts";
import { settingsFrom } from "./mod/config.ts";
import { insights, MIN_JUDGED, routingFrom } from "./mod/insights.ts";
import { readState } from "./mod/ledger.ts";
import { checkerCatch, outcomeStats } from "./mod/outcomes.ts";
import type { CatchRow, OutcomeRow } from "./mod/outcomes.ts";

/** A file in the store folder with its modification time in milliseconds. */
export type StoreFile = { path: string; mtime: number };

/** What the command reads and writes: the store folder's files, one file's text (null when unreadable), and the two streams. */
export type AnalyzeIo = {
  stores(): StoreFile[];
  read(path: string): string | null;
  out(text: string): void;
  err(text: string): void;
};

/** `haikrew_<source>-<hash>.json`: an inline dev install writes `haikrew_inline-…`, a marketplace install `haikrew_haikrew-…`. */
const STORE_NAME = /^haikrew_[a-z0-9]+-.*\.json$/;

/** The path of the newest HaiKrew store file among `files`, or null when there is none. */
export function newestStore(files: StoreFile[]): string | null {
  const own = files.filter((f) => STORE_NAME.test(f.path.split(/[\\/]/).pop() ?? ""));
  const newest = [...own].sort((a, b) => b.mtime - a.mtime)[0];
  return newest ? newest.path : null;
}

/** A percentage, or "-" when there is no basis for one. */
function pct(rate: number | null): string {
  return rate === null ? "-" : `${Math.round(rate * 100)}%`;
}

/** A count of tokens with thousands separators, or "-" when null. */
function tokens(n: number | null): string {
  return n === null ? "-" : Math.round(n).toLocaleString("en-US");
}

/** Lines of text in columns: each column as wide as its longest cell. */
function grid(head: string[], body: string[][]): string[] {
  const all = [head, ...body];
  const widths = head.map((_, i) => Math.max(...all.map((row) => (row[i] ?? "").length)));
  return all.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
}

function outcomeLines(rows: OutcomeRow[]): string[] {
  if (rows.length === 0) return ["No runs in the ledger yet."];
  return grid(
    ["Model", "Job", "Lang", "Size", "Runs", "Judged", "Pass", "Checked", "Checked pass", "Late", "Escalated", "Paid tok/accepted", "Haiku tok"],
    rows.map((r) => [r.model, r.job, r.lang, r.size_level || "-", String(r.runs), String(r.judged), pct(r.pass_rate), String(r.checked),
      pct(r.checked_pass_rate), String(r.late_fail), String(r.escalations), tokens(r.paid_tokens_per_accepted), tokens(r.haiku_tokens)]),
  );
}

function checkerLines(rows: CatchRow[]): string[] {
  if (rows.length === 0) return ["No checked runs with a recorded defect count yet."];
  return grid(
    ["Job", "Lang", "Size", "Checked", "With defects", "Catch rate"],
    rows.map((r) => [r.job, r.lang, r.size_level || "-", String(r.checked), String(r.with_defects), pct(r.rate)]),
  );
}

/**
 * The report for a stored object (the store file's parsed JSON) as plain text. `source` names the file in the header.
 * Pure: nothing is read beyond the object given.
 */
export function report(stored: unknown, source: string): string {
  const store = isObject(stored) ? stored : {};
  const state = readState(store.ledger);
  const ins = insights(state.runs, routingFrom(settingsFrom(store.settings)));
  const lines = [
    `HaiKrew analyze: ${state.runs.length} runs kept raw in ${source}, ${ins.judged} judged`, "",
    "Outcomes by model, job, language and size", ...outcomeLines(outcomeStats(state.runs)), "",
    "Checker catch rate by job, language and size", ...checkerLines(checkerCatch(state.runs)), "",
  ];
  if (ins.judged < MIN_JUDGED) return [...lines, "Not enough judged runs yet.", ""].join("\n");
  const cal = ins.calibration;
  lines.push(`Clef calibration over ${cal.judged} decided runs: ${cal.over} over-escalated, ${cal.under} under-escalated`, "");
  lines.push("Proposed rules");
  lines.push(...(ins.rules.length ? grid(["Rule", "Evidence"], ins.rules.map((r) => [r.rule, r.evidence])).map((l) => `  ${l}`) : ["  none"]));
  lines.push("", "Findings");
  lines.push(...(ins.findings.length ? ins.findings.map((f) => `  - ${f.text}`) : ["  none"]));
  return lines.join("\n") + "\n";
}

/**
 * Print the report for the store file at `store`, or for the newest store file when `store` is "". Returns the exit
 * code: 2 when there is no file to read or it is not JSON, else 0.
 */
export function analyze(store: string, io: AnalyzeIo): number {
  const path = store || newestStore(io.stores());
  if (!path) {
    io.err("haikrew analyze: no HaiKrew store file under ~/.claude/plugins/store (pass --store)\n");
    return 2;
  }
  const text = io.read(path);
  let stored: unknown;
  try {
    stored = text === null ? undefined : JSON.parse(text);
  } catch {
    stored = undefined;
  }
  if (stored === undefined) {
    io.err("haikrew analyze: the store file is missing or is not JSON\n");
    return 2;
  }
  io.out(report(stored, path));
  return 0;
}
