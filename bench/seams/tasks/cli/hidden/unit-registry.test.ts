import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry, runCli } from "./registry.ts";

const cmd = (name: string, over = {}) => ({ name, summary: `${name} summary`, flags: [], run: () => "", ...over });

test("get returns the registered command", () => {
  const reg = createRegistry();
  const c = cmd("build");
  reg.register(c);
  assert.equal(reg.get("build"), c);
});
test("get of an unknown name is undefined", () => {
  assert.equal(createRegistry().get("nope"), undefined);
});
test("registering a name twice throws a duplicate error", () => {
  const reg = createRegistry();
  reg.register(cmd("build"));
  assert.throws(() => reg.register(cmd("build")), /duplicate/);
});
test("list is sorted by name", () => {
  const reg = createRegistry();
  reg.register(cmd("zeta"));
  reg.register(cmd("alpha"));
  reg.register(cmd("mid"));
  assert.deepEqual(reg.list().map((c) => c.name), ["alpha", "mid", "zeta"]);
});
test("an unknown command exits 2 and names it", () => {
  assert.deepEqual(runCli(["nope"], createRegistry()), { code: 2, output: "unknown command: nope" });
});
test("a command receives the parsed arguments", () => {
  const reg = createRegistry();
  reg.register(cmd("echo", { run: (a: { positional: string[] }) => a.positional.join(",") }));
  assert.deepEqual(runCli(["echo", "a", "b"], reg), { code: 0, output: "a,b" });
});
test("an unknown flag exits 2 and names the flag and command", () => {
  const reg = createRegistry();
  reg.register(cmd("rm", { flags: ["force"] }));
  assert.deepEqual(runCli(["rm", "--force", "--yes"], reg), { code: 2, output: "unknown flag --yes for rm" });
});
test("a thrown error exits 1 with its message", () => {
  const reg = createRegistry();
  reg.register(cmd("boom", { run: () => { throw new Error("boom"); } }));
  assert.deepEqual(runCli(["boom"], reg), { code: 1, output: "boom" });
});
test("no arguments shows usage with exit 0", () => {
  const r = runCli([], createRegistry());
  assert.equal(r.code, 0);
  assert.ok(r.output.startsWith("usage: tool"));
});
test("--help on a command shows usage and does not run it", () => {
  const reg = createRegistry();
  reg.register(cmd("rm", { run: () => { throw new Error("ran"); } }));
  assert.equal(runCli(["rm", "--help"], reg).code, 0);
});
test("--help wins over an unknown flag", () => {
  const reg = createRegistry();
  reg.register(cmd("rm"));
  assert.equal(runCli(["rm", "--help", "--zzz"], reg).code, 0);
});
test("a hidden command still runs when named", () => {
  const reg = createRegistry();
  reg.register(cmd("secret", { hidden: true, run: () => "ok" }));
  assert.deepEqual(runCli(["secret"], reg), { code: 0, output: "ok" });
});
