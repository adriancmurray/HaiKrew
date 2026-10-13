import test from "node:test";
import assert from "node:assert/strict";
import { listUsers, listUsersPage } from "./users.ts";
import { usersHandler } from "./handler.ts";

const users = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `user${i + 1}` }));

test("listUsers filters by q", () => {
  assert.deepEqual(listUsers(users, { q: "USER2" }).map((u) => u.id), [2, 20, 21, 22, 23, 24, 25]);
});
test("handler without paging returns array", () => {
  const r = usersHandler(users, { q: "user1" });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});
test("page 2", () => {
  const r = listUsersPage(users, { page: 2, pageSize: 10 });
  assert.equal(r.items.length, 10);
  assert.equal(r.total, 25);
  assert.equal(r.items[0].id, 11);
});
test("handler paging", () => {
  const r = usersHandler(users, { page: "3", pageSize: "10" });
  assert.equal(r.status, 200);
  assert.equal((r.body as any).items.length, 5);
});
