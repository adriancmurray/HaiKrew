/** `haikrew patterns check`: the folder rules, the caps and their exit codes, run through the CLI launcher. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../plugin/bin/haikrew.mjs", import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), "haikrew-patterns-")));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A new empty working directory under the test root. */
function fresh(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  return dir;
}

/** Run `haikrew patterns check ...` from `cwd`. */
function check(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, "patterns", "check", ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Text of `n` lines, each ending in a newline. */
function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

describe("patterns check", () => {
  it("a missing folder exits 2 and names the absolute path", () => {
    const cwd = fresh("missing");
    const { code, out, err } = check(cwd);
    assert.equal(code, 2);
    assert.equal(out, "");
    assert.ok(err.includes(`patterns: no patterns folder at ${join(cwd, "patterns")} (pass --dir)\n`), err);
  });

  it("a path that is a file, not a folder, exits 2", () => {
    const cwd = fresh("file-not-dir");
    writeFileSync(join(cwd, "patterns"), "not a folder\n");
    const { code, err } = check(cwd);
    assert.equal(code, 2);
    assert.ok(err.includes("no patterns folder at"), err);
  });

  it("an empty folder passes", () => {
    const cwd = fresh("empty");
    mkdirSync(join(cwd, "patterns"));
    const { code, out } = check(cwd);
    assert.equal(code, 0);
    assert.equal(out, "patterns ok: 0 files within caps\n");
  });

  it("--dir resolves against the working directory, as a separate value or with =", () => {
    const cwd = fresh("dir-flag");
    mkdirSync(join(cwd, "docs", "patterns"), { recursive: true });
    writeFileSync(join(cwd, "docs", "patterns", "a.md"), "one\n");
    assert.equal(check(cwd).code, 2, "the default ./patterns is missing here");
    const spaced = check(cwd, "--dir", "docs/patterns");
    assert.equal(spaced.code, 0);
    assert.equal(spaced.out, "patterns ok: 1 files within caps\n");
    assert.equal(check(cwd, "--dir=docs/patterns").code, 0);
    assert.equal(check(join(cwd, "docs"), "--dir", "patterns").code, 0);
  });

  it("21 pattern files exit 1 with the file-count violation; --max-files 21 passes", () => {
    const cwd = fresh("many");
    mkdirSync(join(cwd, "patterns"));
    for (let i = 0; i < 21; i++) writeFileSync(join(cwd, "patterns", `p${String(i).padStart(2, "0")}.md`), "x\n");
    const { code, out } = check(cwd);
    assert.equal(code, 1);
    assert.match(out, /violation: 21 pattern files, most allowed is 20/);
    assert.equal(check(cwd, "--max-files", "21").code, 0);
  });

  it("a 41-line file exits 1 and is named; --max-lines=41 passes", () => {
    const cwd = fresh("long");
    mkdirSync(join(cwd, "patterns"));
    writeFileSync(join(cwd, "patterns", "short.md"), "one\n");
    writeFileSync(join(cwd, "patterns", "long.md"), lines(41));
    const { code, out } = check(cwd);
    assert.equal(code, 1);
    assert.match(out, /violation: long\.md: 41 lines, most allowed is 40/);
    assert.doesNotMatch(out, /short\.md/);
    assert.equal(check(cwd, "--max-lines=41").code, 0);
  });

  it("a flag without a valid value exits 2", () => {
    const cwd = fresh("bad-flags");
    mkdirSync(join(cwd, "patterns"));
    assert.equal(check(cwd, "--max-files", "many").code, 2);
    assert.equal(check(cwd, "--dir").code, 2);
    assert.equal(check(cwd, "--unknown", "1").code, 2);
  });
});
