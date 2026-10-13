import test from "node:test";
import assert from "node:assert/strict";
import { createClient, HttpError } from "./client.ts";
import { fetchUserName } from "./users.ts";

const ok = (body = "ok") => ({ status: 200, body });
const st = (status: number) => ({ status, body: "" });
function script(steps: Array<() => { status: number; body: string } | never>) {
  let n = 0; const urls: string[] = [];
  const f = async (url: string) => { urls.push(url); const s = steps[Math.min(n++, steps.length - 1)]; return s(); };
  return { f, calls: () => n, urls };
}
function sleeper() { const delays: number[] = []; return { sleep: async (ms: number) => { delays.push(ms); }, delays }; }
const boom = () => { throw new Error("ECONNRESET"); };

test("default: no retries, one attempt", async () => {
  const s = script([() => st(500)]);
  await assert.rejects(createClient(s.f).get("/x"), (e: any) => e instanceof HttpError && e.status === 500);
  assert.equal(s.calls(), 1);
});
test("retries:2 means three attempts total", async () => {
  const s = script([() => st(500)]); const z = sleeper();
  await assert.rejects(createClient(s.f, { retries: 2, sleep: z.sleep }).get("/x"));
  assert.equal(s.calls(), 3);
});
test("delays double and there is no sleep after the last attempt", async () => {
  const s = script([() => st(502)]); const z = sleeper();
  await assert.rejects(createClient(s.f, { retries: 5, sleep: z.sleep }).get("/x"));
  assert.deepEqual(z.delays, [100, 200, 400, 800, 1600]);
  assert.equal(s.calls(), 6);
});
test("final error is the last HttpError, unwrapped", async () => {
  const s = script([() => st(500), () => st(502), () => st(503)]); const z = sleeper();
  await assert.rejects(createClient(s.f, { retries: 5, sleep: z.sleep }).get("/x"), (e: any) => e instanceof HttpError && e.status === 503);
});
test("4xx is not retried", async () => {
  const s = script([() => st(404), () => ok()]); const z = sleeper();
  await assert.rejects(createClient(s.f, { retries: 3, sleep: z.sleep }).get("/x"), (e: any) => e instanceof HttpError && e.status === 404);
  assert.equal(s.calls(), 1); assert.deepEqual(z.delays, []);
});
test("network errors are retried and the last one is rethrown as-is", async () => {
  const e1 = new Error("a"), e2 = new Error("b");
  let n = 0; const z = sleeper();
  const f = async () => { throw n++ === 0 ? e1 : e2; };
  await assert.rejects(createClient(f as any, { retries: 1, sleep: z.sleep }).get("/x"), (e) => e === e2);
  assert.deepEqual(z.delays, [100]);
});
test("synchronously throwing fetcher counts as network error", async () => {
  let n = 0; const z = sleeper();
  const f = (() => { if (n++ < 1) boom(); return Promise.resolve(ok("fine")); }) as any;
  assert.equal(await createClient(f, { retries: 2, sleep: z.sleep }).get("/x"), "fine");
});
test("non-Error rejections are retried", async () => {
  let n = 0; const z = sleeper();
  const f = async () => { if (n++ < 2) throw "nope"; return ok("done"); };
  assert.equal(await createClient(f as any, { retries: 2, sleep: z.sleep }).get("/x"), "done");
});
test("succeeds after failures and returns the body", async () => {
  const s = script([() => st(500), boom, () => ok("body")]); const z = sleeper();
  assert.equal(await createClient(s.f, { retries: 5, sleep: z.sleep }).get("/x"), "body");
  assert.deepEqual(z.delays, [100, 200]);
});
test("same url on each attempt", async () => {
  const s = script([() => st(500), () => ok()]); const z = sleeper();
  await createClient(s.f, { retries: 1, sleep: z.sleep }).get("/same");
  assert.deepEqual(s.urls, ["/same", "/same"]);
});
test("each get starts its backoff from 100ms", async () => {
  const s = script([() => st(500), () => ok()]); const z = sleeper();
  const c = createClient(s.f, { retries: 3, sleep: z.sleep });
  let n = 0;
  const f2 = async () => (n++ % 2 === 0 ? st(500) : ok());
  const c2 = createClient(f2, { retries: 3, sleep: z.sleep });
  await c2.get("/a"); await c2.get("/b");
  assert.deepEqual(z.delays, [100, 100]);
  void c;
});
test("concurrent gets are independent", async () => {
  const counts: Record<string, number> = {}; const z = sleeper();
  const f = async (u: string) => { counts[u] = (counts[u] ?? 0) + 1; return counts[u] < 3 ? st(500) : ok(u); };
  const c = createClient(f, { retries: 2, sleep: z.sleep });
  assert.deepEqual(await Promise.all([c.get("/a"), c.get("/b")]), ["/a", "/b"]);
});
test("sleep is awaited before the next attempt", async () => {
  const order: string[] = [];
  const f = async () => { order.push("fetch"); return order.length < 2 ? st(500) : ok(); };
  const sleep = async () => { order.push("sleep-start"); await new Promise((r) => setTimeout(r, 10)); order.push("sleep-end"); };
  await createClient(f, { retries: 1, sleep }).get("/x");
  assert.deepEqual(order, ["fetch", "sleep-start", "sleep-end", "fetch"]);
});
test("retries:0 with sleep never sleeps", async () => {
  const z = sleeper();
  await assert.rejects(createClient(async () => st(500), { retries: 0, sleep: z.sleep }).get("/x"));
  assert.deepEqual(z.delays, []);
});
test("default sleep is a real timer and works", async () => {
  let n = 0; const t = Date.now();
  const c = createClient(async () => (n++ < 1 ? st(500) : ok("late")), { retries: 1 });
  assert.equal(await c.get("/x"), "late");
  assert.ok(Date.now() - t >= 90);
});
test("fetchUserName still works, with and without retries", async () => {
  const f = async () => ok('{"name":"grace"}');
  assert.equal(await fetchUserName(createClient(f), 1), "grace");
  assert.equal(await fetchUserName(createClient(f, { retries: 2 }), 1), "grace");
});
test("sleep that rejects propagates", async () => {
  const c = createClient(async () => st(500), { retries: 1, sleep: async () => { throw new Error("aborted"); } });
  await assert.rejects(c.get("/x"), /aborted/);
});
