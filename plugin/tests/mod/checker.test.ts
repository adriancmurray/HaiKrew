/** Mod tests for checker reports: BROKE line defect counts, and recording them on the checker and checked runs. */
import { expect, test } from "claude-code/testing";
import { applyDefects, countDefects } from "../../src/mod/checker.ts";
import type { LedgerState, Run } from "../../src/mod/ledger.ts";

const run = (over: Partial<Run>): Run => ({
  ts: "2026-10-08T09:00:00Z", session: "s", agent_id: "a-" + (over.ts ?? "2026-10-08T09:00:00Z"), agent_type: "haiku-checker",
  model: "claude-haiku-5-5", job: "check", lang: "rust", duration_s: 10, tokens_in: 100, tokens_out: 50, cache_read: 0,
  cache_write: 0, tokens_estimated: true, tool_calls: 1, attempts: 1, verdict: "pass", quality: 1, ...over,
});

test("countDefects is 0 when every BROKE entry holds", () => {
  expect(countDefects("BROKE: empty input → ok; big file → pass; unicode → handled")).toBe(0);
});

test("countDefects counts the entries whose result is not an ok word", () => {
  const report = "Checked three cases.\nBROKE: empty input → ok; big file → drops rows; unicode → crashes\nVERDICT: PASS";
  expect(countDefects(report)).toBe(2);
});

test("countDefects accepts the -> arrow", () => {
  expect(countDefects("BROKE: a -> defect; b -> held; c -> no issue")).toBe(1);
});

test("countDefects reads a markdown-wrapped BROKE line", () => {
  expect(countDefects("  **BROKE:** a → ok; b → **panic**")).toBe(1);
});

test("countDefects is 0 when there is no BROKE line", () => {
  expect(countDefects("All cases held.\nVERDICT: PASS for Ada Lovebytes")).toBe(0);
});

test("countDefects uses the last BROKE line", () => {
  expect(countDefects("BROKE: a → broken\nmore text\nBROKE: a → ok")).toBe(0);
});

test("applyDefects sets defects_found on the checker's run and checker_defects on the newest same-named run", () => {
  const state: LedgerState = { buckets: [], runs: [
    run({ agent_id: "checker-1", name: "Bo", ts: "2026-10-08T12:00:00Z" }),
    run({ agent_id: "a2", name: "Marie_Curl", ts: "2026-10-08T09:00:00Z" }),
    run({ agent_id: "a3", name: "marie curl", ts: "2026-10-08T10:00:00Z" }),
    run({ agent_id: "a4", name: "Ada Lovebytes", ts: "2026-10-08T11:00:00Z" }),
  ] };
  const next = applyDefects(state, { checkerId: "checker-1", checkedName: "Marie Curl" }, 2);
  expect(next.runs[0]?.defects_found).toBe(2);
  expect(next.runs[0]?.checker_defects).toBeUndefined();
  expect(next.runs[1]?.checker_defects).toBeUndefined();
  expect(next.runs[2]?.checker_defects).toBe(2);
  expect(next.runs[3]?.checker_defects).toBeUndefined();
  expect(next.runs[3]?.defects_found).toBeUndefined();
});

test("applyDefects returns the same state when neither the checker nor the checked name matches", () => {
  const state: LedgerState = { buckets: [], runs: [run({ agent_id: "a1", name: "Ada Lovebytes" })] };
  expect(applyDefects(state, { checkerId: "missing", checkedName: "Nobody" }, 1)).toBe(state);
});

test("an ok word must be a whole word: 'pass-through bug' and 'passive' are defects", () => {
  expect(countDefects("BROKE  a → pass-through bug; b → passive leak; c → ok")).toBe(2);
});

test("an entry whose result is more than a bare ok word is a defect", () => {
  expect(countDefects("BROKE: x → ok but throws on empty")).toBe(1);
});

test("a result naming a failure is a defect even when it starts with ok", () => {
  expect(countDefects("BROKE: a → ok, hangs; b → ok (timeout); c → fails quietly")).toBe(3);
});

test("a FAIL verdict counts at least one defect, even when the BROKE line is none or missing", () => {
  expect(countDefects("BROKE: none", true)).toBe(1);
  expect(countDefects("All cases held.", true)).toBe(1);
  expect(countDefects("BROKE: a → ok", true)).toBe(1);
  expect(countDefects("BROKE: a → x; b → y", true)).toBe(2);
  expect(countDefects("BROKE: none")).toBe(0);
});
