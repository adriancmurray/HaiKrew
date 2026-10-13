/** Mod tests for verdicts held until their run is ledgered: applied on arrival with their defect count, left alone once applied, pruned by age and count. */
import { expect, test } from "claude-code/testing";
import { countDefects } from "../../src/mod/checker.ts";
import { addRun, applyChecked, applyOrHold, finalReport, parseCheckerVerdict, readState, runFromStop } from "../../src/mod/ledger.ts";
import type { LedgerState, Run } from "../../src/mod/ledger.ts";
import { PENDING_CAP, prunePending } from "../../src/mod/pending-verdicts.ts";
import { defaults } from "../../src/schema.ts";

const settings = defaults();
const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

const run = (name: string, ts: string, agentId: string): Run => ({
  ts, session: "s", agent_id: agentId, agent_type: "haiku-coder", model: "haiku", job: "build", lang: "rust",
  duration_s: 10, tokens_in: 5, tokens_out: 2, cache_read: 0, cache_write: 0, tokens_estimated: true, tool_calls: 1,
  attempts: 2, verdict: "none", quality: 0, name,
});

const transcriptOf = (text: string): string => JSON.stringify({
  type: "assistant", timestamp: "2026-10-12T10:01:00.000Z", message: { id: "m1", model: "claude-haiku-5-5", content: [{ type: "text", text }] },
});

test("a verdict held before its run is applied when the run is added, then dropped from pending", () => {
  let state = applyOrHold({ runs: [], buckets: [] }, { name: "Katherine_JSON", verdict: "pass", checker: "Rev" }, now);
  expect(state.runs).toEqual([]);
  expect(state.pending).toEqual([{ name: "katherine json", verdict: "pass", checker: "Rev", ts: now.toISOString() }]);
  state = addRun(state, run("Katherine JSON", now.toISOString(), "a1"), settings);
  expect(state.runs[0]).toMatchObject({ verdict: "pass", quality: 0.5, checked_by: "Rev" });
  expect(state.pending).toEqual([]);
});

test("a verdict after its run is applied exactly as applyChecked applies it, and nothing is held", () => {
  const state: LedgerState = { runs: [run("Ada", "2026-10-01T00:00:00Z", "a1")], buckets: [] };
  expect(applyOrHold(state, { name: "Ada", verdict: "fail", checker: "Rev" }, now)).toEqual(applyChecked(state, { name: "Ada" }, "fail", "Rev"));
  expect(applyOrHold(state, { name: "Ada", verdict: "fail", checker: "Rev" }, now)).not.toHaveProperty("pending");
});

test("a held verdict older than a day is ignored when its run arrives, and pruned", () => {
  const stale = { name: "ada", verdict: "pass" as const, checker: "Rev", ts: new Date(now.getTime() - DAY_MS - 1000).toISOString() };
  const state: LedgerState = { runs: [], buckets: [], pending: [stale] };
  const added = addRun(state, run("Ada", now.toISOString(), "a1"), settings);
  expect(added.runs[0]?.verdict).toBe("none");
  expect(added.runs[0]?.checked_by).toBeUndefined();
  expect(added.pending).toEqual([]);
  expect(prunePending([stale], now)).toEqual([]);
  expect(applyOrHold(state, { name: "Someone Else", verdict: "pass", checker: "Rev" }, now).pending).toHaveLength(1);
});

test("the held list is capped at PENDING_CAP, the oldest verdicts going first", () => {
  let state: LedgerState = { runs: [], buckets: [] };
  for (let i = 0; i <= PENDING_CAP; i++) state = applyOrHold(state, { name: `agent ${i}`, verdict: "pass", checker: "Rev" }, now);
  expect(state.pending).toHaveLength(PENDING_CAP);
  expect(state.pending?.[0]?.name).toBe("agent 1");
  expect(state.pending?.at(-1)?.name).toBe(`agent ${PENDING_CAP}`);
});

test("a name that never gets a run does not break later runs, and survives a store round trip", () => {
  const held = applyOrHold({ runs: [], buckets: [] }, { name: "ledger-post-restart", verdict: "pass", checker: "Rev" }, now);
  const stored = readState(JSON.parse(JSON.stringify(held)));
  expect(stored.pending?.map((p) => p.name)).toEqual(["ledger-post-restart"]);
  const state = addRun(stored, run("Ada", now.toISOString(), "a1"), settings);
  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]).toMatchObject({ verdict: "none" });
  expect(state.pending?.map((p) => p.name)).toEqual(["ledger-post-restart"]);
});

test("a reviewer's hand-back read before the target row is applied when the row arrives, as the hook path does", () => {
  const handBack = transcriptOf("Checked the change.\nVERDICT: FAIL for Edsger_Docstra - tests red.");
  let state: LedgerState = { runs: [], buckets: [] };
  const reviewer = runFromStop({ agent_id: "rev1", agent_type: "haiku-checker" }, handBack);
  state = addRun(state, { ...reviewer, name: "Reviewer X" }, settings);
  const report = finalReport(handBack);
  const checked = parseCheckerVerdict(report);
  expect(checked).toEqual({ verdict: "fail", name: "edsger docstra" });
  if (checked) state = applyOrHold(state, { name: checked.name, verdict: checked.verdict, checker: "Reviewer X" }, now);
  expect(state.pending).toHaveLength(1);
  const target = runFromStop({ agent_id: "t1", agent_type: "haiku-coder" }, transcriptOf("Done.\nVERDICT: PASS"));
  state = addRun(state, { ...target, name: "Edsger Docstra", attempts: 1 }, settings);
  expect(state.runs.find((r) => r.agent_id === "t1")).toMatchObject({ verdict: "fail", quality: 0, checked_by: "Reviewer X" });
  expect(state.pending).toEqual([]);
});

test("a FAIL hand-back with defects read before the target row gives the row its checker_defects", () => {
  const handBack = "Checked the change.\nBROKE: empty input → throws; long input → ok\nVERDICT: FAIL for Edsger_Docstra - tests red.";
  const checked = parseCheckerVerdict(handBack);
  const defects = countDefects(handBack, checked?.verdict === "fail");
  expect(defects).toBe(1);
  let state: LedgerState = { runs: [], buckets: [] };
  if (checked) state = applyOrHold(state, { name: checked.name, verdict: checked.verdict, checker: "Reviewer X", defects }, now);
  expect(state.pending?.[0]).toMatchObject({ name: "edsger docstra", defects: 1 });
  const target = runFromStop({ agent_id: "t1", agent_type: "haiku-coder" }, transcriptOf("Done.\nVERDICT: PASS"));
  state = addRun(state, { ...target, name: "Edsger Docstra", attempts: 1 }, settings);
  expect(state.runs.find((r) => r.agent_id === "t1")).toMatchObject({ verdict: "fail", checked_by: "Reviewer X", checker_defects: 1 });
  expect(state.pending).toEqual([]);
});
