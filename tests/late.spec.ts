/** Late failures against a real temporary git repo: the log arguments and parser work on git's actual output. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { flagLate, repoOf } from "../plugin/src/mod/late.ts";

const git = async (argv: string[], cwd: string): Promise<string> => {
  try { return execFileSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; }
};

function commit(dir: string, file: string, msg: string, when: string): void {
  writeFileSync(join(dir, file), msg);
  const opts = { cwd: dir, stdio: "ignore" as const, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } };
  execFileSync("git", ["add", "-A"], opts);
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], opts);
}

test("a passed run is a late failure when a fix commit within the window touches its file", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "late-")));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    commit(dir, "a.ts", "add a", "2026-10-10T11:00:00Z");
    commit(dir, "b.ts", "fix typo in b", "2026-10-11T11:00:00Z"); // a fix, but another file
    commit(dir, "a.ts", "tidy a", "2026-10-11T12:00:00Z"); // the file, but no fix word
    commit(dir, "a.ts", "Fix crash in a", "2026-10-12T09:00:00Z"); // hit
    commit(dir, "d.ts", "add d", "2026-10-10T13:00:00Z");
    commit(dir, "d.ts", "fix d much later", "2026-10-20T13:00:00Z"); // outside 5 days
    const run = (agent_id: string, files: string[], ts = "2026-10-10T12:00:00Z", verdict = "pass") =>
      ({ ts, agent_id, verdict, repo: dir, files }) as never;
    const runs = [run("hit", ["a.ts"]), run("far", ["d.ts"], "2026-10-10T14:00:00Z"), run("failed", ["a.ts"], undefined, "fail")];
    const out = await flagLate(runs, Date.parse("2026-10-13T00:00:00Z"), 5, git);
    assert.deepEqual(out.runs.filter((r: { late_fail?: boolean }) => r.late_fail).map((r: { agent_id: string }) => r.agent_id), ["hit"]);
    assert.match(String((out.runs[0] as { late_fail_commit?: string }).late_fail_commit), /^[0-9a-f]{40}$/);
    assert.deepEqual(await repoOf([join(dir, "sub", "x.ts"), "(shell)"], git), {});
    assert.deepEqual(await repoOf([join(dir, "x.ts")], git), { repo: dir, files: ["x.ts"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
