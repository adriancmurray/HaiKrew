import { posix } from "node:path";

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

// Resolve `rel` under `root` (an absolute posix path); refuse anything that ends up outside it.
export function safeJoin(root: string, rel: string): string {
  const base = posix.resolve(root);
  const full = posix.resolve(base, rel);
  if (full !== base && !full.startsWith(base + "/")) throw new PathError(`escapes root: ${rel}`);
  return full;
}
