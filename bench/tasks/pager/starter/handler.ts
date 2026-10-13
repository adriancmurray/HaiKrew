import { ApiError, listUsers } from "./users.ts";
import type { User } from "./users.ts";

export function usersHandler(users: User[], query: Record<string, string>) {
  try {
    return { status: 200, body: listUsers(users, { q: query.q }) as unknown };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: { error: e.message } as unknown };
    throw e;
  }
}
