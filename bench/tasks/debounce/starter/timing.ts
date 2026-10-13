export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
}
