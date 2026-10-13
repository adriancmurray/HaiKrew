import test from "node:test";
import assert from "node:assert/strict";
import { createClient, HttpError } from "./client.ts";
import { fetchUserName } from "./users.ts";

test("get returns body", async () => {
  const c = createClient(async () => ({ status: 200, body: "hi" }));
  assert.equal(await c.get("/x"), "hi");
});
test("4xx throws HttpError", async () => {
  const c = createClient(async () => ({ status: 404, body: "" }));
  await assert.rejects(c.get("/x"), (e: any) => e instanceof HttpError && e.status === 404);
});
test("fetchUserName", async () => {
  const c = createClient(async () => ({ status: 200, body: '{"name":"ada"}' }));
  assert.equal(await fetchUserName(c, 1), "ada");
});
test("retries 5xx then succeeds", async () => {
  let n = 0; const delays: number[] = [];
  const c = createClient(async () => (++n < 3 ? { status: 503, body: "" } : { status: 200, body: "ok" }), { retries: 3, sleep: async (ms: number) => { delays.push(ms); } });
  assert.equal(await c.get("/x"), "ok");
  assert.deepEqual(delays, [100, 200]);
});
