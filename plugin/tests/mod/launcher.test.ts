/** Mod tests for the launcher rewrite and the squeeze guard's view of a rewritten command: plain functions, fake next. */
import { expect, test } from "claude-code/testing";
import { rewriteLauncher, squeeze } from "../../src/mod/guards.ts";
import type { SqueezeSettings } from "../../src/mod/guards.ts";
import type { Input } from "../../src/mod/api.ts";
import { defaults } from "../../src/schema.ts";

const ROOT = "/plugins/haikrew";
const LAUNCH = `node "${ROOT}/scripts/haikrew.mjs"`;
const rewrite = (command: string) => rewriteLauncher(command, ROOT);
const passThrough = (e: Input) => ({ next: e });

test("a bare haikrew command word is rewritten to the launcher path", () => {
  expect(rewrite("haikrew verify")).toBe(`${LAUNCH} verify`);
  expect(rewrite("haikrew squeeze -- cargo test")).toBe(`${LAUNCH} squeeze -- cargo test`);
  expect(rewrite("cd /x && haikrew verify")).toBe(`cd /x && ${LAUNCH} verify`);
  expect(rewrite("npm test && haikrew analyze")).toBe(`npm test && ${LAUNCH} analyze`);
  expect(rewrite("false || haikrew verify")).toBe(`false || ${LAUNCH} verify`);
  expect(rewrite("cat log | haikrew squeeze -- wc")).toBe(`cat log | ${LAUNCH} squeeze -- wc`);
  expect(rewrite("echo a; haikrew verify")).toBe(`echo a; ${LAUNCH} verify`);
  expect(rewrite("cd x\nhaikrew verify")).toBe(`cd x\n${LAUNCH} verify`);
  expect(rewrite("CI=1 haikrew verify")).toBe(`CI=1 ${LAUNCH} verify`);
  expect(rewrite("(haikrew verify)")).toBe(`(${LAUNCH} verify)`);
});

test("arguments and trailing whitespace after the launcher stay as written", () => {
  expect(rewrite("haikrew verify haikrew")).toBe(`${LAUNCH} verify haikrew`);
  expect(rewrite("haikrew verify  ")).toBe(`${LAUNCH} verify  `);
});

test("haikrew inside quotes, paths, other words or after a non-command word is left alone", () => {
  for (const command of [
    "echo haikrew",
    "echo haikrew && echo ok",
    "echo A=1 haikrew",
    "cat .haikrew/verify",
    "ls ~/.claude/plugins/store/haikrew-late.json",
    'git commit -m "haikrew verify"',
    "echo 'haikrew verify'",
    "cat /haikrew",
    "haikrew.mjs verify",
    "node ./plugin/scripts/haikrew.mjs verify",
    "cat a\\ haikrew verify",
  ]) {
    expect(rewrite(command)).toBe(command);
  }
});

test("an unclosed quote ends the rewrite and the rest is kept as written", () => {
  expect(rewrite('haikrew verify "x')).toBe(`${LAUNCH} verify "x`);
  expect(rewrite('echo "haikrew verify')).toBe('echo "haikrew verify');
});

test("a root with spaces is quoted, so the launcher path still runs", () => {
  expect(rewriteLauncher("haikrew verify", "/Users/a b/haikrew")).toBe('node "/Users/a b/haikrew/scripts/haikrew.mjs" verify');
});

test("squeeze sees a rewritten squeeze call, or an older bin/ one, as already squeezed", () => {
  const cfg = { ...defaults().squeeze, patterns: [".*"] } as unknown as SqueezeSettings;
  const rewritten = rewrite("cd x && haikrew squeeze -- cargo test");
  expect(squeeze(cfg, { command: rewritten }, ROOT, passThrough)).toEqual({ next: { command: rewritten } });
  const spaced = 'node "/Users/a b/haikrew/scripts/haikrew.mjs" squeeze -- make';
  expect(squeeze(cfg, { command: spaced }, ROOT, passThrough)).toEqual({ next: { command: spaced } });
  const older = `node "${ROOT}/bin/haikrew.mjs" squeeze -- make`;
  expect(squeeze(cfg, { command: older }, ROOT, passThrough)).toEqual({ next: { command: older } });
});
