import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry, runCli } from "./registry.ts";

const reg = createRegistry();
reg.register({
  name: "build", summary: "compile the project", flags: ["release"],
  run: (a) => `building ${a.positional[0] ?? "all"}${"release" in a.flags ? " (release)" : ""}`,
});
reg.register({ name: "test", summary: "run tests", flags: [], run: () => "ok" });
reg.register({ name: "secret", summary: "internal", flags: [], hidden: true, run: () => "hidden ok" });
reg.register({ name: "fail", summary: "always fails", flags: [], run: () => { throw new Error("disk full"); } });

const HELP = [
  "usage: tool <command> [options]",
  "",
  "commands:",
  "  build  compile the project",
  "  fail   always fails",
  "  test   run tests",
].join("\n");

test("a command gets its positionals and flags", () => {
  assert.deepEqual(runCli(["build", "app", "--release"], reg), { code: 0, output: "building app (release)" });
});
test("a command with no positional still runs", () => {
  assert.deepEqual(runCli(["build"], reg), { code: 0, output: "building all" });
});
test("an unknown flag on a registered command exits 2", () => {
  assert.deepEqual(runCli(["build", "--bogus"], reg), { code: 2, output: "unknown flag --bogus for build" });
});
test("no arguments prints the help for visible commands", () => {
  assert.deepEqual(runCli([], reg), { code: 0, output: HELP });
});
test("--help anywhere prints the same help", () => {
  assert.deepEqual(runCli(["--help"], reg), { code: 0, output: HELP });
  assert.deepEqual(runCli(["test", "--help", "--x"], reg), { code: 0, output: HELP });
});
test("a hidden command runs when named but is not listed", () => {
  assert.deepEqual(runCli(["secret"], reg), { code: 0, output: "hidden ok" });
  assert.equal(runCli([], reg).output.includes("secret"), false);
});
test("a __proto__ flag is an unknown flag", () => {
  assert.deepEqual(runCli(["build", "--__proto__"], reg), { code: 2, output: "unknown flag --__proto__ for build" });
});
test("an unregistered command exits 2", () => {
  assert.deepEqual(runCli(["deploy"], reg), { code: 2, output: "unknown command: deploy" });
});
test("a command that throws exits 1 with its message", () => {
  assert.deepEqual(runCli(["fail"], reg), { code: 1, output: "disk full" });
});
test("registering a taken name throws", () => {
  assert.throws(() => reg.register({ name: "test", summary: "again", flags: [], run: () => "" }), /duplicate/);
});
