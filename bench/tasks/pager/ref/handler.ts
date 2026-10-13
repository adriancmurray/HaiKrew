import { ApiError, listUsers, listUsersPage } from "./users.ts";
import type { User } from "./users.ts";

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

export function usersHandler(users: User[], query: Record<string, string>) {
  try {
    if (query.page !== undefined || query.pageSize !== undefined) {
      return { status: 200, body: listUsersPage(users, { q: query.q, page: num(query.page), pageSize: num(query.pageSize) }) as unknown };
    }
    return { status: 200, body: listUsers(users, { q: query.q }) as unknown };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: { error: e.message } as unknown };
    throw e;
  }
}
