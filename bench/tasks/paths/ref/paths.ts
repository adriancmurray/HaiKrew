export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export function normalizePath(p: string): string {
  if (typeof p !== "string") throw new TypeError("path must be a string");
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else out.push(seg);
  }
  const s = out.join("/");
  return abs ? "/" + s : s || ".";
}

export function safeJoin(root: string, rel: string): string {
  const base = normalizePath(root);
  const full = rel.startsWith("/") ? normalizePath(rel) : normalizePath(base + "/" + rel);
  if (full !== base && !full.startsWith(base === "/" ? "/" : base + "/")) throw new PathError(`escapes root: ${rel}`);
  return full;
}
