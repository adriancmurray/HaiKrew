import test from "node:test";
import assert from "node:assert/strict";
import { safeJoin, PathError, normalizePath } from "./paths.ts";

test("safeJoin inside", () => assert.equal(safeJoin("/srv/app", "a/b.txt"), "/srv/app/a/b.txt"));
test("safeJoin escape", () => assert.throws(() => safeJoin("/srv/app", "../x"), PathError));
test("normalize basics", () => {
  assert.equal(normalizePath("/a/./b//c/../d"), "/a/b/d");
  assert.equal(normalizePath("a/../../b"), "../b");
  assert.equal(normalizePath(""), ".");
});
