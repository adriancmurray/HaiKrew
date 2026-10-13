export type Cell = string | number | null | undefined;
export type Row = Record<string, Cell>;
export type Dir = "asc" | "desc";

function cmp(a: Cell, b: Cell): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function sortRows(rows: Row[], key: string, dir: Dir = "asc"): Row[] {
  if (dir !== "asc" && dir !== "desc") throw new TypeError(`bad dir: ${String(dir)}`);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * cmp(a[key], b[key]));
}
