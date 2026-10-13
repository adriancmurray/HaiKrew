/** Late-failure helpers with canned git output (the real-repo fixture is tests/late.spec.ts), and the decider health check with a fake fetch. */
import { expect, test } from "claude-code/testing";
import { checkHealth, healthLine, resetHealth } from "../../src/mod/health.ts";
import { applyLateFile, parseLateFile } from "../../src/mod/late-file.ts";
import { flagLate, mergeLate, parseLog, repoOf } from "../../src/mod/late.ts";
import type { RunGit } from "../../src/mod/late.ts";
import { readState } from "../../src/mod/ledger.ts";
import type { Run } from "../../src/mod/ledger.ts";

const run = (over: Partial<Run>): Run => ({ ts: "2026-10-10T12:00:00Z", agent_id: "a", self_verdict: "pass", ...over }) as Run;
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
    run({ agent_id: "failed", repo: "/r", files: ["a.ts"], self_verdict: "fail" }),
    run({ agent_id: "legacy" }), // recorded before repo/files existed
  ], base + 2 * 3600_000, 5, async (argv, cwd) => { asked.push(cwd); return log; });
  expect(asked).toEqual(["/r"]);
  expect(out.runs.filter((r) => r.late_fail).map((r) => r.agent_id)).toEqual(["hit"]);
  expect(out.runs[0].late_fail_commit).toBe("abc");
  expect((await flagLate(out.runs, base + 20 * 86_400_000, 5, git)).changed).toBe(false); // aged out of the window
});

test("repoOf stores the repo root and repo-relative paths, and nothing outside a repo", async () => {
  // git names the root and the folder's prefix itself, so a symlinked spelling of the path still resolves
  const git: RunGit = async (argv, cwd) => (cwd === "/link/repo/src" ? "/work/repo\nsrc/\n" : cwd === "/link/repo" ? "/work/repo\n\n" : "");
  expect(await repoOf(["/link/repo/src/x.ts", "/link/repo/y.ts", "(shell)", "rel.ts"], git)).toEqual({ repo: "/work/repo", files: ["src/x.ts", "y.ts"] });
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

test("the late-fail merge copies only its fields onto the fresh run, keeping a verdict that landed during the git call", async () => {
  const before = [run({ agent_id: "x", repo: "/r", files: ["a.ts"] })];
  let fresh: Run[] = before;
  const found = await flagLate(before, Date.parse("2026-10-11T00:00:00Z"), 5, async () => {
    fresh = [{ ...before[0], verdict: "fail", checked_by: "Reviewer" }]; // a checker's verdict lands while git runs
    return `\x01abc\x01${Math.floor(Date.parse("2026-10-10T13:00:00Z") / 1000)}\x01fix a\n\na.ts\n`;
  });
  const merged = mergeLate(fresh, found.runs);
  expect(merged[0].late_fail).toBe(true);
  expect(merged[0].verdict).toBe("fail");
  expect(merged[0].checked_by).toBe("Reviewer");
});

test("parallel health checks share one request and toast once", async () => {
  resetHealth();
  let calls = 0;
  const get = async (): Promise<boolean> => { calls++; return false; };
  const texts = await Promise.all([checkHealth("http://h", 1, get), checkHealth("http://h", 1, get)]);
  expect(texts.filter(Boolean).length).toBe(1);
  expect(calls).toBe(1);
  resetHealth();
});

test("the late-failure flags file is applied by agent id and merged under mergeLate", async () => {
  const file = parseLateFile('{"hit":{"late_fail":true,"late_fail_commit":"abc"}}');
  const fresh = [run({ agent_id: "hit" }), run({ agent_id: "other" })];
  const out = mergeLate(fresh, applyLateFile(fresh, file));
  expect(out.map((r) => r.late_fail)).toEqual([true, undefined]);
  expect(out[0].late_fail_commit).toBe("abc");
  expect(parseLateFile("not json")).toEqual({});
});
