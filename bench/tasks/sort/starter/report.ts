import { sortRows } from "./table.ts";
import type { Row } from "./table.ts";

export function topByAge(rows: Row[], n = 3): Row[] {
  return sortRows(rows, "age", "desc").slice(0, n);
}
