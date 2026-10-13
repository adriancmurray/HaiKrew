/** `haikrew analyze` on a fixture ledger, with the store folder and the file reads faked: the report, the file pick and the exit codes. */
import { expect, test } from "claude-code/testing";
import { analyze, newestStore, report } from "../../src/analyze.ts";
import type { AnalyzeIo, StoreFile } from "../../src/analyze.ts";

const run = (verdict: string, model = "claude-haiku-5-5", extra: Record<string, unknown> = {}) => ({
  ts: "2026-10-08T09:00:00Z", session: "s", agent_id: "", agent_type: "haiku-coder", model, job: "implement", lang: "rust",
  duration_s: 10, tokens_in: 100, tokens_out: 50, cache_read: 0, cache_write: 0, tokens_estimated: true, tool_calls: 1,
  attempts: 1, verdict, quality: verdict === "pass" ? 1 : 0, ...extra,
});

/** A store file's parsed JSON with a ledger of `runs`; the default model is Sonnet, so a Haiku-passing bucket is a proposal. */
const store = (runs: unknown[]) => ({ ledger: { runs, buckets: [] }, settings: { gate: { default_model: "sonnet" } } });

/** An AnalyzeIo over fake files: `files` maps a path to its text, `stores` lists the folder. Output is collected. */
function fakeIo(files: Record<string, string>, stores: StoreFile[] = []): AnalyzeIo & { stdout: string; stderr: string } {
  const io = {
    stdout: "",
    stderr: "",
    stores: () => stores,
    read: (path: string) => (Object.hasOwn(files, path) ? files[path] : null),
    out(text: string) {
      io.stdout += text;
    },
    err(text: string) {
      io.stderr += text;
    },
  };
  return io;
}

test("analyze prints the outcome table, calibration, proposed rules and findings for a fixture ledger", () => {
  const path = "/store/haikrew_inline-fixture.json";
  const runs = [...Array.from({ length: 8 }, () => run("pass")), run("fail"), run("pass", "claude-sonnet-5-5", { tokens_in: 900, tokens_out: 100 })];
  const io = fakeIo({ [path]: JSON.stringify(store(runs)) });
  expect(analyze(path, io)).toBe(0);
  expect(io.stderr).toBe("");
  expect(io.stdout).toMatch(/^HaiKrew analyze: 10 runs kept raw in \/store\/haikrew_inline-fixture\.json, 10 judged/);
  expect(io.stdout).toContain("Outcomes by model, job, language and size");
  expect(io.stdout).toMatch(/haiku\s+implement\s+rust\s+-\s+9\s+9\s+89%/);
  expect(io.stdout).toContain("Clef calibration over 0 decided runs: 0 over-escalated, 0 under-escalated");
  expect(io.stdout).toContain("job:implement+lang:rust=haiku");
  expect(io.stdout).toContain("haiku passed 8 of 9 judged runs");
});

test("analyze lists the checker catch rate by job, language and size, and says so when no checked run has a defect count", () => {
  const path = "/store/haikrew_inline-checked.json";
  const runs = [
    run("pass", "claude-haiku-5-5", { checked_by: "Ada", checker_defects: 2 }),
    run("pass", "claude-haiku-5-5", { checked_by: "Bo", checker_defects: 0 }),
    run("pass", "claude-haiku-5-5", { checked_by: "Cy" }),
  ];
  const io = fakeIo({ [path]: JSON.stringify(store(runs)) });
  expect(analyze(path, io)).toBe(0);
  expect(io.stdout).toContain("Checker catch rate by job, language and size");
  expect(io.stdout).toMatch(/Job\s+Lang\s+Size\s+Checked\s+With defects\s+Catch rate/);
  expect(io.stdout).toMatch(/implement\s+rust\s+-\s+2\s+1\s+50%/);
  expect(report(store([run("pass")]), "fixture")).toContain(
    "Checker catch rate by job, language and size\nNo checked runs with a recorded defect count yet.",
  );
});

test("analyze reads the newest store file when no path is given", () => {
  const older = "/store/haikrew_inline-a.json";
  const newer = "/store/haikrew_inline-b.json";
  const io = fakeIo({ [older]: JSON.stringify(store([])), [newer]: JSON.stringify(store([run("pass")])) },
    [{ path: older, mtime: 1 }, { path: newer, mtime: 2 }]);
  expect(analyze("", io)).toBe(0);
  expect(io.stdout).toContain("1 runs kept raw in /store/haikrew_inline-b.json, 1 judged");
});

test("the report says there are not enough judged runs when the ledger is small, and handles an empty ledger", () => {
  expect(report(store([run("pass")]), "fixture")).toContain("1 runs kept raw in fixture, 1 judged");
  expect(report(store([run("pass")]), "fixture")).toContain("Not enough judged runs yet.");
  expect(report({}, "fixture")).toContain("No runs in the ledger yet.");
});

test("analyze exits 2 for no store file, an unreadable file, bad JSON", () => {
  const bad = "/store/haikrew_inline-bad.json";
  const io = fakeIo({ [bad]: "{not json" });
  expect(analyze("", fakeIo({}))).toBe(2);
  expect(analyze("/store/missing.json", io)).toBe(2);
  expect(analyze(bad, io)).toBe(2);
  expect(io.stderr).toContain("not JSON");
});

test("newestStore picks the haikrew_inline file with the latest modification time, and ignores other names", () => {
  expect(newestStore([
    { path: "/s/haikrew_inline-a.json", mtime: 10 },
    { path: "/s/anuki_inline-c.json", mtime: 99 },
    { path: "/s/haikrew_inline-b.json", mtime: 20 },
  ])).toBe("/s/haikrew_inline-b.json");
  expect(newestStore([{ path: "/s/anuki_inline-c.json", mtime: 99 }])).toBeNull();
});
