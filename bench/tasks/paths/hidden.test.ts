import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { safeJoin, PathError, normalizePath as n } from "./paths.ts";

test("collapses slashes, dots, dotdots", () => {
  assert.equal(n("/a/./b//c/../d"), "/a/b/d");
  assert.equal(n("a//b/./c"), "a/b/c");
});
test("empty and dot", () => { assert.equal(n(""), "."); assert.equal(n("."), "."); assert.equal(n("./"), "."); assert.equal(n("./."), "."); });
test("root", () => { assert.equal(n("/"), "/"); assert.equal(n("//"), "/"); assert.equal(n("///a"), "/a"); });
test("no trailing slash", () => { assert.equal(n("a/b/"), "a/b"); assert.equal(n("/a/b//"), "/a/b"); assert.equal(n("a/b/."), "a/b"); assert.equal(n("a/b/.."), "a"); });
test("relative keeps leading ..", () => {
  assert.equal(n("../a"), "../a"); assert.equal(n("a/../../b"), "../b"); assert.equal(n("../../a/b"), "../../a/b");
  assert.equal(n(".."), ".."); assert.equal(n("../.."), "../.."); assert.equal(n("a/b/../../.."), "..");
});
test("relative collapsing to nothing is dot", () => { assert.equal(n("a/.."), "."); assert.equal(n("a/b/../.."), "."); });
test("absolute cannot go above root", () => {
  assert.equal(n("/.."), "/"); assert.equal(n("/../../a"), "/a"); assert.equal(n("/a/../.."), "/");
});
test("dots inside names are not special", () => {
  assert.equal(n("a/..b/c.."), "a/..b/c.."); assert.equal(n(".hidden/./x"), ".hidden/x"); assert.equal(n("a/.../b"), "a/.../b");
});
test("unicode and spaces kept", () => {
  assert.equal(n("/日本語/./café//naïve file/../x"), "/日本語/café/x");
  assert.equal(n("😀/./😀"), "😀/😀");
});
test("backslash is an ordinary character", () => { assert.equal(n("a\\b/../c"), "c"); assert.equal(n("a\\..\\b"), "a\\..\\b"); });
test("agrees with path.posix.normalize modulo trailing slash", () => {
  const parts = ["a", "b", "..", ".", "", "c", "d"];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 400; i++) {
    const len = 1 + Math.floor(rnd() * 8);
    let s = rnd() < 0.5 ? "/" : "";
    for (let j = 0; j < len; j++) s += parts[Math.floor(rnd() * parts.length)] + "/";
    if (rnd() < 0.5) s = s.replace(/\/$/, "");
    if (s === "") continue;
    let want = posix.normalize(s);
    if (want.length > 1 && want.endsWith("/")) want = want.slice(0, -1);
    assert.equal(n(s), want, JSON.stringify(s));
  }
});
test("deep input does not blow the stack", () => {
  const deep = "a/".repeat(300_000) + "../".repeat(300_000);
  assert.equal(n(deep), ".");
  assert.equal(n("/" + "x/".repeat(200_000)).length, 1 + 2 * 200_000 - 1);
});
test("idempotent", () => { for (const s of ["/a/../b/", "../x/./y", "", "//q//"]) assert.equal(n(n(s)), n(s)); });
test("non-string throws TypeError", () => { assert.throws(() => n(undefined as any), TypeError); assert.throws(() => n(5 as any), TypeError); });
test("safeJoin: inside", () => {
  assert.equal(safeJoin("/srv/app", "a/./b/../c"), "/srv/app/a/c");
  assert.equal(safeJoin("/srv/app", ""), "/srv/app");
  assert.equal(safeJoin("/srv/app/", "x"), "/srv/app/x");
});
test("safeJoin: escapes throw PathError", () => {
  for (const rel of ["../x", "a/../../x", "..", "a/b/../../../etc"]) assert.throws(() => safeJoin("/srv/app", rel), PathError, rel);
});
test("safeJoin: sibling with shared prefix is an escape", () => {
  assert.throws(() => safeJoin("/srv/app", "../app2/x"), PathError);
});
test("safeJoin: absolute rel outside root still rejected (as before)", () => {
  assert.throws(() => safeJoin("/srv/app", "/etc/passwd"), PathError);
});
test("safeJoin: absolute rel inside root is accepted (as before)", () => {
  assert.equal(safeJoin("/srv/app", "/srv/app/x/../y"), "/srv/app/y");
});
test("safeJoin: no longer depends on cwd", () => {
  const old = process.cwd();
  try { process.chdir("/"); assert.equal(safeJoin("/srv/app", "z"), "/srv/app/z"); } finally { process.chdir(old); }
  assert.ok(!safeJoin("/srv/app", "z").startsWith(old));
});
test("safeJoin: unicode", () => { assert.equal(safeJoin("/srv/ä", "日本/../ö"), "/srv/ä/ö"); });
