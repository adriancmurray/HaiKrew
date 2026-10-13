import type { createClient } from "./client.ts";

export async function fetchUserName(client: ReturnType<typeof createClient>, id: number): Promise<string> {
  const body = await client.get(`/users/${id}`);
  return (JSON.parse(body) as { name: string }).name;
}
