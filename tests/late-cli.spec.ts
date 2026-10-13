/** `haikrew late-failures` against a real temporary git repo, with the store file text and the write injected. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lateFailuresCmd, type LateIo } from "../plugin/src/latecli.ts";

const git = async (argv: string[], cwd: string): Promise<string> => {
  try { return execFileSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; }
};

function commit(dir: string, file: string, msg: string, when: string): void {
  writeFileSync(join(dir, file), msg);
  const opts = { cwd: dir, stdio: "ignore" as const, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } };
  execFileSync("git", ["add", "-A"], opts);
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], opts);
}

/** An io whose store folder holds `path` (none when null) and whose file reads return `text`. */
function fakeIo(path: string | null, text: string | null, written: string[], errs: string[]): LateIo {
  return {
    stores: () => (path ? [{ path, mtime: 1 }] : []),
    read: () => text,
    out: () => {},
    err: (t) => errs.push(t),
    git,
    write: (t) => written.push(t),
    now: () => Date.parse("2026-10-13T00:00:00Z"),
  };
}

test("late-failures writes the flagged passed runs of the newest store file", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "late-cli-")));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    commit(dir, "a.ts", "add a", "2026-10-10T11:00:00Z");
    commit(dir, "a.ts", "Fix crash in a", "2026-10-12T09:00:00Z");
    const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const text = JSON.stringify({ ledger: { runs: [{ ts: "2026-10-10T12:00:00Z", agent_id: "hit", verdict: "pass", repo: dir, files: ["a.ts"] }], buckets: [] } });
    const written: string[] = [];
    const errs: string[] = [];
    const code = await lateFailuresCmd(5, fakeIo(join(dir, "haikrew_inline-x.json"), text, written, errs));
    assert.equal(code, 0, errs.join(""));
    assert.deepEqual(JSON.parse(written[0]), { hit: { late_fail: true, late_fail_commit: hash } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("late-failures with no store file exits 1 and writes nothing", async () => {
  const written: string[] = [];
  const errs: string[] = [];
  assert.equal(await lateFailuresCmd(5, fakeIo(null, null, written, errs)), 1);
  assert.deepEqual(written, []);
  assert.deepEqual(errs, ["late-failures: no store file\n"]);
});
