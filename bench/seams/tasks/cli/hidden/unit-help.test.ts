import test from "node:test";
import assert from "node:assert/strict";
import { renderHelp } from "./help.ts";

const HEADER = "usage: tool <command> [options]\n\ncommands:";
const cmd = (name: string, summary: string, over = {}) => ({ name, summary, flags: [], run: () => "", ...over });

test("no commands gives only the header", () => {
  assert.equal(renderHelp([]), HEADER);
});
test("one command is one indented line", () => {
  assert.equal(renderHelp([cmd("build", "compile")]), `${HEADER}\n  build  compile`);
});
test("names are padded to the longest name", () => {
  assert.equal(
    renderHelp([cmd("build", "compile the project"), cmd("test", "run tests")]),
    `${HEADER}\n  build  compile the project\n  test   run tests`,
  );
});
test("commands are sorted by name whatever the input order", () => {
  assert.equal(renderHelp([cmd("test", "t"), cmd("build", "b")]), `${HEADER}\n  build  b\n  test   t`);
});
test("hidden commands are left out and do not widen the padding", () => {
  assert.equal(renderHelp([cmd("build", "b"), cmd("secret-long-name", "s", { hidden: true })]), `${HEADER}\n  build  b`);
});
