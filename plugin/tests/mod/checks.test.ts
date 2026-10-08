/** Checks: the hook-bypass guard denies a git hook skip and passes the rest; the seam check flags a parallel batch once. */
import { expect, test } from "claude-code/testing";
import { hookGuard } from "../../src/mod/guards.ts";
import type { ChecksSettings } from "../../src/mod/guards.ts";
import { noteSeamStart, noteSeamStop, resetSeams } from "../../src/mod/seam.ts";
import type { Input } from "../../src/mod/api.ts";

const passThrough = (e: Input) => ({ next: e });
const ON: ChecksSettings = { guard_hooks: true, seam_check: true };
const OFF: ChecksSettings = { guard_hooks: false, seam_check: true };

test("the hook guard denies a command that skips git hooks", () => {
  for (const command of ["git commit --no-verify -m x", "git -c core.hooksPath=/dev/null commit", "git config core.hooksPath=x"]) {
    expect(typeof (hookGuard(ON, { command }, passThrough) as { deny?: string }).deny).toBe("string");
  }
});

test("the hook guard allows other commands and passes through when off", () => {
  expect(hookGuard(ON, { command: "echo --no-verifyx" }, passThrough)).toEqual({ next: { command: "echo --no-verifyx" } });
  expect(hookGuard(ON, { command: 'git commit -m "mentions no-verify-flag"' }, passThrough))
    .toEqual({ next: { command: 'git commit -m "mentions no-verify-flag"' } });
  expect(hookGuard(OFF, { command: "git commit --no-verify -m x" }, passThrough))
    .toEqual({ next: { command: "git commit --no-verify -m x" } });
});

test("two overlapping agents in one folder are flagged once, on the second stop", () => {
  resetSeams();
  noteSeamStart("s1", "/repo");
  noteSeamStart("s2", "/repo");
  expect(noteSeamStop("s1")).toBe(null);
  const message = noteSeamStop("s2");
  expect(message).toBe("HaiKrew seam check: 2 agents ran in parallel in /repo. Run the repo's full verify before trusting their reports.");
  noteSeamStart("s3", "/repo");
  expect(noteSeamStop("s3")).toBe(null);
});

test("sequential agents never form a batch", () => {
  resetSeams();
  noteSeamStart("q1", "/repo");
  expect(noteSeamStop("q1")).toBe(null);
  noteSeamStart("q2", "/repo");
  expect(noteSeamStop("q2")).toBe(null);
});

test("different folders are independent and an unknown stop is null", () => {
  resetSeams();
  noteSeamStart("a", "/one");
  noteSeamStart("b", "/two");
  expect(noteSeamStop("a")).toBe(null);
  expect(noteSeamStop("b")).toBe(null);
  expect(noteSeamStop("nobody")).toBe(null);
});
