export type Debounced<A extends unknown[]> = ((...args: A) => void) & { cancel(): void; flush(): void };

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number, opts: { leading?: boolean } = {}): Debounced<A> {
  const leading = opts.leading === true;
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: { args: A; self: unknown } | undefined;
  function fire() {
    const p = pending; pending = undefined;
    if (p) fn.apply(p.self, p.args);
  }
  function onTimer() { t = undefined; fire(); }
  const d = function (this: unknown, ...args: A) {
    if (t !== undefined) {
      clearTimeout(t);
      pending = { args, self: this };
    } else if (leading) {
      pending = undefined;
      fn.apply(this, args);
    } else {
      pending = { args, self: this };
    }
    t = setTimeout(onTimer, ms);
  } as Debounced<A>;
  d.cancel = () => { if (t !== undefined) clearTimeout(t); t = undefined; pending = undefined; };
  d.flush = () => {
    if (t !== undefined) clearTimeout(t);
    t = undefined;
    fire();
  };
  return d;
}
