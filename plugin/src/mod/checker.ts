/**
 * Defect counts from a haiku-checker's report. The checker lists its break cases on one `BROKE` line as
 * `<case> → <result>` entries separated by `;`. An entry is a defect unless its result starts with an "ok" word.
 * applyDefects() records the count on the checker's own run and on the newest run of the checked crew member.
 */
import type { LedgerState } from "./ledger.ts";
import { normName } from "./names.ts";

const LINE_SPLIT = /\r\n|\r|\n/;
const BROKE_RE = /^[\s*`]*BROKE\b(.*)$/;
// Leading separators left after the BROKE word, such as the colon in "**BROKE:**".
const BROKE_LEAD_RE = /^[\s:*`\-–—]+/;
const ARROW_SPLIT_RE = /→|->/;
const LEAD_NON_WORD_RE = /^[^\p{L}\p{N}]+/u;
const OK_RE = /^(ok|pass|passed|held|holds|fine|none|no defect|no issue|handled|correct)(?![\p{L}\p{N}-])/u;

/** True when an entry's result (text after its last arrow, or the whole entry) does not start with an ok word. */
function isDefect(entry: string): boolean {
  const parts = entry.split(ARROW_SPLIT_RE);
  const result = (parts[parts.length - 1] ?? "").trim().toLowerCase().replace(LEAD_NON_WORD_RE, "");
  return !OK_RE.test(result);
}

/** The number of defect entries on the last `BROKE` line of a checker's report. 0 when there is no such line. */
export function countDefects(report: string): number {
  let body: string | null = null;
  for (const line of report.split(LINE_SPLIT)) {
    const m = BROKE_RE.exec(line);
    if (m) body = m[1] ?? "";
  }
  if (body === null) return 0;
  return body.replace(BROKE_LEAD_RE, "").split(";")
    .filter((entry) => entry.trim() !== "" && isDefect(entry)).length;
}

/**
 * The state with `defects` stored on the run whose agent id is checkerId (as defects_found) and on the newest run whose
 * crew name matches checkedName (as checker_defects). A part with no matching run is skipped; the same state object
 * comes back when neither matches.
 */
export function applyDefects(state: LedgerState, target: { checkerId: string; checkedName: string }, defects: number): LedgerState {
  const want = normName(target.checkedName);
  let at = -1;
  if (want) {
    state.runs.forEach((r, i) => {
      if (normName(r.name ?? "") === want && (at < 0 || r.ts >= (state.runs[at]?.ts ?? ""))) at = i;
    });
  }
  const checkerHit = !!target.checkerId && state.runs.some((r) => r.agent_id === target.checkerId);
  if (!checkerHit && at < 0) return state;
  const runs = state.runs.map((r, i) => {
    let next = r;
    if (target.checkerId && r.agent_id === target.checkerId) next = { ...next, defects_found: defects };
    if (i === at) next = { ...next, checker_defects: defects };
    return next;
  });
  return { ...state, runs };
}
