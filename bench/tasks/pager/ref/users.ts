export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type User = { id: number; name: string };

export function listUsers(users: User[], opts: { q?: string } = {}): User[] {
  const q = opts.q?.toLowerCase();
  return q ? users.filter((u) => u.name.toLowerCase().includes(q)) : users;
}

export function listUsersPage(users: User[], opts: { q?: string; page?: number; pageSize?: number } = {}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, "invalid page");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new ApiError(400, "invalid pageSize");
  const all = listUsers(users, { q: opts.q });
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize };
}
