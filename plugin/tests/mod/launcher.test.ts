/** Mod tests for the launcher rewrite and the squeeze guard's view of a rewritten command: plain functions, fake next. */
import { expect, test } from "claude-code/testing";
import { rewriteLauncher, squeeze } from "../../src/mod/guards.ts";
import type { SqueezeSettings } from "../../src/mod/guards.ts";
import type { Input } from "../../src/mod/api.ts";
import { defaults } from "../../src/schema.ts";

const ROOT = "/plugins/haikrew";
const LAUNCH = `node '${ROOT}/scripts/haikrew.mjs'`;
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

test("a redirection to a file descriptor named haikrew is not a command position", () => {
  expect(rewrite("echo hi >&haikrew")).toBe("echo hi >&haikrew");
  expect(rewrite("echo hi <&haikrew")).toBe("echo hi <&haikrew");
  expect(rewrite("echo hi >&haikrew; haikrew verify")).toBe(`echo hi >&haikrew; ${LAUNCH} verify`);
});

test("a heredoc body is never rewritten, and a launcher call before its operator still is", () => {
  const body = "cat > notes.md <<'EOF'\nhaikrew verify\nEOF";
  expect(rewrite(body)).toBe(body);
  expect(rewrite(`haikrew verify; ${body}`)).toBe(`${LAUNCH} verify; ${body}`);
  expect(rewrite("cat <<EOF && haikrew verify\nhaikrew verify\nEOF")).toBe(`cat <<EOF && ${LAUNCH} verify\nhaikrew verify\nEOF`);
});

test("a here-string has no body, so the next line is still rewritten", () => {
  expect(rewrite("cat <<< x\nhaikrew verify")).toBe(`cat <<< x\n${LAUNCH} verify`);
});

test("an unclosed quote ends the rewrite and the rest is kept as written", () => {
  expect(rewrite('haikrew verify "x')).toBe(`${LAUNCH} verify "x`);
  expect(rewrite('echo "haikrew verify')).toBe('echo "haikrew verify');
});

test("the launcher path is single-quoted, so a root with shell syntax is never expanded", () => {
  const cases: [string, string][] = [
    ["/a$(id)b", "node '/a$(id)b/scripts/haikrew.mjs' verify"],
    ['/a"b', `node '/a"b/scripts/haikrew.mjs' verify`],
    ["/a'b", "node '/a'\\''b/scripts/haikrew.mjs' verify"],
    ["/with space", "node '/with space/scripts/haikrew.mjs' verify"],
  ];
  for (const [root, want] of cases) {
    const out = rewriteLauncher("haikrew verify", root);
    expect(out).toBe(want);
  }
});

test("squeeze sees a rewritten squeeze call as already squeezed, not squeezed twice", () => {
  const all = { ...defaults().squeeze, patterns: [".*"] } as unknown as SqueezeSettings;
  const rewritten = rewrite("cd x && haikrew squeeze -- cargo test");
  expect(squeeze(all, { command: rewritten }, ROOT, passThrough)).toEqual({ next: { command: rewritten } });
  const plain = rewrite("haikrew squeeze -- cargo test");
  expect(squeeze(defaults().squeeze as unknown as SqueezeSettings, { command: plain }, ROOT, passThrough))
    .toEqual({ next: { command: plain } });
  for (const command of [
    "node '/a'\\''b/scripts/haikrew.mjs' squeeze -- make",
    "node '/with space/scripts/haikrew.mjs' squeeze -- make",
    'node "/Users/a b/haikrew/scripts/haikrew.mjs" squeeze -- make',
    `node "${ROOT}/bin/haikrew.mjs" squeeze -- make`,
  ]) {
    expect(squeeze(all, { command }, ROOT, passThrough)).toEqual({ next: { command } });
  }
});
