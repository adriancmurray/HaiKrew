import test from "node:test";
import assert from "node:assert/strict";
import { listUsers, listUsersPage, ApiError } from "./users.ts";
import { usersHandler } from "./handler.ts";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `user${i + 1}` }));
const users = mk(25);
const is400 = (e: unknown) => e instanceof ApiError && e.status === 400;

test("first page", () => {
  const r = listUsersPage(users, { page: 1, pageSize: 2 });
  assert.deepEqual(r.items.map((u) => u.id), [1, 2]);
  assert.equal(r.total, 25); assert.equal(r.page, 1); assert.equal(r.pageSize, 2);
});
test("defaults are page 1, size 20", () => {
  const r = listUsersPage(users);
  assert.equal(r.items.length, 20); assert.equal(r.page, 1); assert.equal(r.pageSize, 20); assert.equal(r.total, 25);
});
test("last partial page", () => {
  assert.deepEqual(listUsersPage(users, { page: 3, pageSize: 10 }).items.map((u) => u.id), [21, 22, 23, 24, 25]);
});
test("page past the end is empty, total kept", () => {
  const r = listUsersPage(users, { page: 99, pageSize: 10 });
  assert.deepEqual(r.items, []); assert.equal(r.total, 25);
});
test("empty list", () => {
  const r = listUsersPage([], { page: 1 });
  assert.deepEqual(r.items, []); assert.equal(r.total, 0);
});
test("q filter, total counts matches", () => {
  const r = listUsersPage(users, { q: "USER2", pageSize: 3, page: 2 });
  assert.equal(r.total, 7);
  assert.deepEqual(r.items.map((u) => u.id), [22, 23, 24]);
});
test("q with unicode", () => {
  const u = [{ id: 1, name: "Zoë" }, { id: 2, name: "Zoe" }, { id: 3, name: "日本語" }];
  assert.deepEqual(listUsersPage(u, { q: "ë" }).items.map((x) => x.id), [1]);
  assert.deepEqual(listUsersPage(u, { q: "本" }).items.map((x) => x.id), [3]);
});
test("does not mutate input and returns a fresh array", () => {
  const u = mk(5); const copy = JSON.stringify(u);
  const r = listUsersPage(u, { pageSize: 50 });
  assert.equal(JSON.stringify(u), copy);
  assert.notEqual(r.items, u);
  r.items.push({ id: 99, name: "x" });
  assert.equal(u.length, 5);
});
test("items are the same user objects", () => {
  assert.equal(listUsersPage(users, { pageSize: 1 }).items[0], users[0]);
});
test("invalid page throws ApiError 400", () => {
  for (const page of [0, -1, 1.5, NaN]) assert.throws(() => listUsersPage(users, { page }), is400, String(page));
});
test("invalid pageSize throws ApiError 400", () => {
  for (const pageSize of [0, -5, 2.5, NaN]) assert.throws(() => listUsersPage(users, { pageSize }), is400, String(pageSize));
});
test("huge pageSize is fine", () => {
  assert.equal(listUsersPage(users, { pageSize: 1e9 }).items.length, 25);
});
test("handler: string params", () => {
  const r = usersHandler(users, { page: "2", pageSize: "3" });
  assert.equal(r.status, 200);
  assert.deepEqual((r.body as any).items.map((u: any) => u.id), [4, 5, 6]);
  assert.equal((r.body as any).page, 2);
});
test("handler: only pageSize", () => {
  const r = usersHandler(users, { pageSize: "5" });
  assert.equal(r.status, 200); assert.equal((r.body as any).page, 1); assert.equal((r.body as any).items.length, 5);
});
test("handler: garbage page is 400", () => {
  for (const page of ["abc", "0", "", "-1", "2.5"]) {
    const r = usersHandler(users, { page });
    assert.equal(r.status, 400, `page=${JSON.stringify(page)}`);
    assert.ok((r.body as any).error);
  }
});
test("handler: garbage pageSize is 400", () => {
  assert.equal(usersHandler(users, { pageSize: "x" }).status, 400);
  assert.equal(usersHandler(users, { page: "1", pageSize: "0" }).status, 400);
});
test("handler: no paging keeps array body", () => {
  assert.ok(Array.isArray(usersHandler(users, {}).body));
  const r = usersHandler(users, { q: "user1" });
  assert.ok(Array.isArray(r.body)); assert.equal((r.body as any[]).length, 11);
});
test("listUsers unchanged", () => { assert.equal(listUsers(users), users); });
test("large input is fast", () => {
  const big = mk(300_000); const t = Date.now();
  const r = listUsersPage(big, { page: 15000, pageSize: 20, q: "user" });
  assert.equal(r.items[0].id, 299981); assert.equal(r.total, 300000);
  assert.ok(Date.now() - t < 2000);
});
