/** dagr-publish tests: atomic write of a valid run, refusal of invalid runs and symlinked .dagr, and the CLI without dagr on PATH. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import { publishRun } from "../plugin/src/dagr-publish.ts";

const BIN = fileURLToPath(new URL("../plugin/scripts/haikrew.mjs", import.meta.url));
const T = "2026-11-13T10:00:00.000Z";

/** The smallest run checkRun accepts: no tasks and no events. */
function validRun(): Record<string, unknown> {
  return { dagr: 3, run: { id: "r", title: "t", started_at: T }, generated_at: T, projects: [], tasks: [], events: [] };
}

describe("publishRun", () => {
  let cwd: string;
  let outside: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "haikrew-publish-"));
    outside = mkdtempSync(join(tmpdir(), "haikrew-outside-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("writes a valid run", () => {
    const json = JSON.stringify(validRun());
    const result = publishRun(cwd, json);
    const path = join(cwd, ".dagr", "haikrew.json");
    assert.deepEqual(result, { ok: true, path });
    assert.equal(readFileSync(path, "utf8"), json);
  });

  it("keeps the previous file on an invalid run", () => {
    const dir = join(cwd, ".dagr");
    mkdirSync(dir);
    const path = join(dir, "haikrew.json");
    writeFileSync(path, "previous");
    const result = publishRun(cwd, JSON.stringify({ ...validRun(), dagr: 2 }));
    assert.equal(result.ok, false);
    assert.equal(readFileSync(path, "utf8"), "previous");
    assert.deepEqual(readdirSync(dir), ["haikrew.json"]);
  });

  it("refuses a symlinked .dagr and writes nothing into the target", () => {
    symlinkSync(outside, join(cwd, ".dagr"));
    const result = publishRun(cwd, JSON.stringify(validRun()));
    assert.deepEqual(result, { ok: false, reason: ".dagr is a symlink" });
    assert.deepEqual(readdirSync(outside), []);
  });

  it("hides a .dagr it creates from git, and leaves an existing .dagr without a .gitignore", () => {
    assert.equal(publishRun(cwd, JSON.stringify(validRun())).ok, true);
    assert.equal(readFileSync(join(cwd, ".dagr", ".gitignore"), "utf8"), "*\n");
    mkdirSync(join(outside, ".dagr"));
    assert.equal(publishRun(outside, JSON.stringify(validRun())).ok, true);
    assert.equal(existsSync(join(outside, ".dagr", ".gitignore")), false);
  });

  it("never touches run.json", () => {
    const dir = join(cwd, ".dagr");
    mkdirSync(dir);
    writeFileSync(join(dir, "run.json"), "sentinel");
    const result = publishRun(cwd, JSON.stringify(validRun()));
    assert.equal(result.ok, true);
    assert.equal(readFileSync(join(dir, "run.json"), "utf8"), "sentinel");
  });

  it("works without dagr on PATH", () => {
    const json = JSON.stringify(validRun());
    const proc = spawnSync(process.execPath, [BIN, "dagr-publish", json], {
      cwd,
      env: { PATH: dirname(process.execPath) },
      encoding: "utf8",
    });
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(existsSync(join(cwd, ".dagr", "haikrew.json")), true);
  });
});
