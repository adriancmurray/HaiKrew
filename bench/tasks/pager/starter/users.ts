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
