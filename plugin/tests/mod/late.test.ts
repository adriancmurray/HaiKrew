/** Late-failure helpers with canned git output (the real-repo fixture is tests/late.spec.ts), and the decider health check with a fake fetch. */
import { expect, test } from "claude-code/testing";
import { checkHealth, healthLine, resetHealth } from "../../src/mod/health.ts";
import { flagLate, parseLog, repoOf } from "../../src/mod/late.ts";
import type { RunGit } from "../../src/mod/late.ts";
import { readState } from "../../src/mod/ledger.ts";
import type { Run } from "../../src/mod/ledger.ts";

const run = (over: Partial<Run>): Run => ({ ts: "2026-10-10T12:00:00Z", agent_id: "a", verdict: "pass", ...over }) as Run;
const LOG = "\x01abc\x011791000000\x01Fix crash in a\n\na.ts\nb.ts\n\x01def\x011791000100\x01add c\n\nc.ts\n";

test("parseLog reads commits with their files", () => {
  expect(parseLog(LOG)).toEqual([
    { hash: "abc", ts: 1791000000000, subject: "Fix crash in a", files: ["a.ts", "b.ts"] },
    { hash: "def", ts: 1791000100000, subject: "add c", files: ["c.ts"] },
  ]);
});

test("flagLate asks git once per repo and flags only passed runs with a fix commit on their files inside the window", async () => {
  const asked: string[] = [];
  const git: RunGit = async (argv, cwd) => { asked.push(cwd + " " + argv[1]); return LOG; };
  const base = Date.parse("2026-10-10T12:00:00Z");
  const sec = Math.floor((base + 3600_000) / 1000); // one hour after the runs
  const log = `\x01abc\x01${sec}\x01Fix crash in a\n\na.ts\n\x01def\x01${sec}\x01add c\n\nc.ts\n`;
  const out = await flagLate([
    run({ agent_id: "hit", repo: "/r", files: ["a.ts"] }),
    run({ agent_id: "miss", repo: "/r", files: ["c.ts"] }), // touched, but not by a fix
    run({ agent_id: "failed", repo: "/r", files: ["a.ts"], verdict: "fail" }),
    run({ agent_id: "legacy" }), // recorded before repo/files existed
  ], base + 2 * 3600_000, 5, async (argv, cwd) => { asked.push(cwd); return log; });
  expect(asked).toEqual(["/r"]);
  expect(out.runs.filter((r) => r.late_fail).map((r) => r.agent_id)).toEqual(["hit"]);
  expect(out.runs[0].late_fail_commit).toBe("abc");
  expect((await flagLate(out.runs, base + 20 * 86_400_000, 5, git)).changed).toBe(false); // aged out of the window
});

test("repoOf stores the repo root and repo-relative paths, and nothing outside a repo", async () => {
  const git: RunGit = async (argv, cwd) => (cwd === "/work/repo/src" ? "/work/repo\n" : "");
  expect(await repoOf(["/work/repo/src/x.ts", "/work/repo/y.ts", "(shell)", "rel.ts"], git)).toEqual({ repo: "/work/repo", files: ["src/x.ts", "y.ts"] });
  expect(await repoOf(["(shell)"], git)).toEqual({});
  expect(await repoOf(["/elsewhere/x.ts"], git)).toEqual({});
});

test("old stored runs without the new fields read back unchanged", () => {
  const state = readState({ runs: [{ ts: "2026-10-10T12:00:00Z", verdict: "pass" }], buckets: [] });
  expect(state.runs[0].late_fail).toBeUndefined();
  expect(state.runs[0].repo).toBeUndefined();
});

test("decider health: one warning when it goes down, a line on the card, rechecked at most every 10 minutes, cleared on recovery", async () => {
  resetHealth();
  let up = false;
  let calls = 0;
  const get = async (): Promise<boolean> => { calls++; return up; };
  const url = "http://127.0.0.1:8790/";
  const first = await checkHealth(url, 1000, get);
  expect(first).toContain("Clef decider offline at http://127.0.0.1:8790: decisions are skipped. Start it: launchctl kickstart -k gui/$(id -u)/com.clefkit.workers-ai");
  expect(healthLine()).toContain("Offline at http://127.0.0.1:8790");
  expect(await checkHealth(url, 2000, get)).toBe("");
  expect(calls).toBe(1);
  expect(await checkHealth(url, 1000 + 10 * 60 * 1000, get)).toBe(""); // still down: no second toast
  expect(calls).toBe(2);
  up = true;
  expect(await checkHealth(url, 1000 + 21 * 60 * 1000, get)).toBe("");
  expect(healthLine()).toBe("");
  resetHealth();
  expect(await checkHealth(url, 5, async () => { throw new Error("refused"); })).toContain("offline");
  resetHealth();
});
