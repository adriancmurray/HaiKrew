import { debounce } from "./timing.ts";

export function makeSearch(run: (q: string) => void) {
  return debounce(run, 300);
}
