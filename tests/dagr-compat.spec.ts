/** Compatibility: every document from the scripted crews passes the real dagr check, with only W204 findings. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const DAGR = process.env.DAGR_BIN ?? "dagr";
const probe = spawnSync(DAGR, ["--help"], { encoding: "utf8" });
const dagrFound = probe.error === undefined;

const work = mkdtempSync(join(tmpdir(), "haikrew-dagr-compat-"));
after(() => {
  rmSync(work, { recursive: true, force: true });
});

const dagrRun = await import("../plugin/src/mod/dagr-run.ts");
const CODER = "haikrew:haiku-coder";
const CHECKER = "haikrew:haiku-checker";
const MODEL = "claude-haiku-5-5";

let docCount = 0;

/** Writes one document and runs the real dagr check on it; every finding must be W204. */
function assertDagrAccepts(doc: Record<string, unknown>, label: string): void {
  docCount += 1;
  const file = join(work, `${String(docCount).padStart(3, "0")}-${label}.json`);
  writeFileSync(file, JSON.stringify(doc));
  const result = spawnSync(DAGR, ["check", file, "--strict", "--json"], { encoding: "utf8" });
  assert.ok(result.status === 0 || result.status === 1, `dagr check exited ${result.status}: ${result.stderr}`);
  const findings = result.stdout.trim() === "" ? [] : JSON.parse(result.stdout) as Array<{ code: string; msg: string }>;
  const other = findings.filter((f) => f.code !== "W204");
  assert.deepEqual(other, [], `${label}: non-W204 findings`);
}

/** Replays a scripted step and checks the document it leaves behind. */
function snap(now: number, label: string): void {
  const doc = dagrRun.dagrDocument(now);
  assert.notEqual(doc, null, `${label}: no document`);
  assertDagrAccepts(doc as Record<string, unknown>, label);
}

describe("dagr compatibility", { skip: dagrFound ? false : "dagr not installed" }, () => {
  it("accepts every step of a coder fail, send-back, pass crew", () => {
    dagrRun.dagrReset({ id: "s1abcdef99", cwd: "/r" }, 0);
    dagrRun.dagrSpawn("coder1", { name: "Pip", type: CODER, description: "build it", model: MODEL }, 1000);
    snap(1000, "coder-spawned");
    dagrRun.dagrActivity("coder1", 1100, false);
    snap(1200, "coder-running");
    dagrRun.dagrStop("coder1", 1500, 1600, { name: "Pip", type: CODER, model: MODEL, selfVerdict: "none", reviewRequested: true });
    snap(1600, "coder-review");
    dagrRun.dagrSpawn("checker1", { name: "Quill", type: CHECKER, description: "check it", model: MODEL }, 1700);
    snap(1700, "checker-spawned");
    dagrRun.dagrBindReview("checker1", "Pip", 1800);
    snap(1800, "checker-bound");
    dagrRun.dagrCheckerVerdict("checker1", "Pip", "fail", 1900);
    snap(1900, "checker-fail");
    dagrRun.dagrActivity("coder1", 2000, false);
    snap(2000, "coder-resent");
    dagrRun.dagrStop("coder1", 2100, 2200, { name: "Pip", type: CODER, model: MODEL, selfVerdict: "none", reviewRequested: true });
    snap(2200, "coder-resent-review");
    dagrRun.dagrActivity("checker1", 2300, false);
    snap(2300, "checker-followup");
    dagrRun.dagrCheckerVerdict("checker1", "Pip", "pass", 2400);
    snap(2400, "checker-pass");
  });

  it("accepts every step of a crew that stops without review", () => {
    dagrRun.dagrReset({ id: "s2abcdef99", cwd: "/r" }, 0);
    for (const [id, verdict] of [["p", "pass"], ["f", "fail"], ["b", "blocked"], ["n", "none"]] as const) {
      dagrRun.dagrSpawn(id, { name: `Agent ${id}`, type: CODER, description: "task", model: MODEL }, 100);
      snap(100, `spawn-${verdict}`);
      dagrRun.dagrActivity(id, 200, true);
      snap(200, `activity-${verdict}`);
      dagrRun.dagrStop(id, 300, 400, { name: `Agent ${id}`, type: CODER, model: MODEL, selfVerdict: verdict, reviewRequested: false });
      snap(500, `stop-${verdict}`);
    }
  });
});
