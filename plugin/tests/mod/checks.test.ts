/**
 * Checks: the hook-bypass guard denies a git hook skip and passes the rest; the seam check flags a parallel batch once;
 * the token limit depends on the model and effort; the schema takes model=limit entries only.
 */
import { expect, test } from "claude-code/testing";
import { hookGuard, tokenLimit } from "../../src/mod/guards.ts";
import type { ChecksSettings } from "../../src/mod/guards.ts";
import { noteSeamStart, noteSeamStop, resetSeams } from "../../src/mod/seam.ts";
import { validate } from "../../src/schema.ts";
import type { Input } from "../../src/mod/api.ts";

const passThrough = (e: Input) => ({ next: e });
const LIMITS = { token_limits: ["haiku=800000", "sonnet=400000", "opus=200000"], token_effort_scale: true };
const ON: ChecksSettings = { guard_hooks: true, seam_check: true, ...LIMITS };
const OFF: ChecksSettings = { guard_hooks: false, seam_check: true, ...LIMITS };

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

test("the token limit follows the model family at medium effort", () => {
  expect(tokenLimit(LIMITS, "claude-haiku-5-5", "medium")).toBe(800000);
  expect(tokenLimit(LIMITS, "claude-sonnet-5-5", "medium")).toBe(400000);
  expect(tokenLimit(LIMITS, "claude-opus-5-5", "medium")).toBe(200000);
});

test("the token limit scales with effort, and not when scaling is off", () => {
  expect(tokenLimit(LIMITS, "haiku", "xhigh")).toBe(1600000);
  expect(tokenLimit(LIMITS, "opus", "low")).toBe(100000);
  expect(tokenLimit({ ...LIMITS, token_effort_scale: false }, "haiku", "xhigh")).toBe(800000);
  expect(tokenLimit(LIMITS, "opus")).toBe(200000);
});

test("an unknown model takes the smallest positive limit, and a model with 0 or none never warns", () => {
  expect(tokenLimit(LIMITS, "gpt-5", "medium")).toBe(200000);
  expect(tokenLimit({ ...LIMITS, token_limits: ["haiku=0", "sonnet=400000", "opus=200000"] }, "haiku", "high")).toBe(0);
  expect(tokenLimit({ ...LIMITS, token_limits: ["sonnet=400000"] }, "opus", "high")).toBe(0);
  expect(tokenLimit({ ...LIMITS, token_limits: ["haiku=0"] }, "gpt-5", "high")).toBe(0);
});

test("the token limit is a whole number after scaling", () => {
  expect(tokenLimit({ ...LIMITS, token_limits: ["opus=1001"] }, "opus", "low")).toBe(501);
});

test("the schema takes model=limit entries for the token limits and rejects others", () => {
  expect(validate("checks", "token_limits", ["haiku=900000"])).toBe(null);
  expect(typeof validate("checks", "token_limits", ["gpt=5"])).toBe("string");
  expect(typeof validate("checks", "token_limits", ["haiku"])).toBe("string");
});
