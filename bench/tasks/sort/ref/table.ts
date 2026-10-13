export type Cell = string | number | null | undefined;
export type Row = Record<string, Cell>;
export type Dir = "asc" | "desc";
export type SortKey = { key: string; dir?: Dir };

function cmp(a: Cell, b: Cell): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function sortRows(rows: Row[], key: string | SortKey[], dir: Dir = "asc"): Row[] {
  const keys: SortKey[] = typeof key === "string" ? [{ key, dir }] : key;
  const specs = keys.map((k) => {
    const d = k.dir ?? "asc";
    if (d !== "asc" && d !== "desc") throw new TypeError(`bad dir: ${String(d)}`);
    return { key: k.key, sign: d === "asc" ? 1 : -1 };
  });
  return [...rows].sort((a, b) => {
    for (const s of specs) {
      const c = cmp(a[s.key], b[s.key]);
      if (c !== 0) return s.sign * c;
    }
    return 0;
  });
}
