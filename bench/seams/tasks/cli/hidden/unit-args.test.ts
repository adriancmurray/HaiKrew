import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.ts";
import { isFlag } from "./cli.ts";

test("command, positionals and flags are separated", () => {
  const p = parseArgs(["build", "src", "--out=dist", "-v"]);
  assert.equal(p.command, "build");
  assert.deepEqual(p.positional, ["src"]);
  assert.deepEqual(p.flags, { out: "dist", v: true });
});
test("a bare long flag is true", () => {
  assert.equal(parseArgs(["run", "--force"]).flags.force, true);
});
test("a repeated flag keeps its last value", () => {
  assert.equal(parseArgs(["--a=1", "--a=2"]).flags.a, "2");
});
test("double dash ends option parsing", () => {
  const p = parseArgs(["--", "--x", "y"]);
  assert.equal(p.command, "--x");
  assert.deepEqual(p.positional, ["y"]);
  assert.deepEqual(p.flags, {});
});
test("a lone dash is a plain word", () => {
  assert.equal(parseArgs(["-"]).command, "-");
});
test("no arguments gives no command and nothing else", () => {
  const p = parseArgs([]);
  assert.equal(p.command, undefined);
  assert.deepEqual(p.positional, []);
  assert.deepEqual(p.flags, {});
});
test("flags may come before the command", () => {
  const p = parseArgs(["--verbose", "run"]);
  assert.equal(p.command, "run");
  assert.equal(p.flags.verbose, true);
});
test("only the first bare word is the command", () => {
  const p = parseArgs(["a", "b", "c"]);
  assert.equal(p.command, "a");
  assert.deepEqual(p.positional, ["b", "c"]);
});
test("the value is everything after the first equals sign", () => {
  assert.equal(parseArgs(["--expr=a=b"]).flags.expr, "a=b");
});
test("an empty value after equals is an empty string", () => {
  assert.equal(parseArgs(["--name="]).flags.name, "");
});
test("isFlag separates dashed tokens from plain words", () => {
  assert.equal(isFlag("-"), false);
  assert.equal(isFlag("--"), true);
  assert.equal(isFlag("-v"), true);
  assert.equal(isFlag("plain"), false);
});
test("a flag named __proto__ is an ordinary own key", () => {
  assert.deepEqual(Object.keys(parseArgs(["--__proto__"]).flags), ["__proto__"]);
});
