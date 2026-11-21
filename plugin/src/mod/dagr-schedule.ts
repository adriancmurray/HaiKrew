/**
 * Debounced export of the dagr run document. A change starts one timer; later changes inside that window do not move
 * it, so a busy crew is published at most once per quiet window and at least once per window while it stays busy.
 * A change during a publish marks the state dirty and schedules one follow-up when the publish settles. The
 * generation guards against a timer set before a reset (a new session) publishing the old run.
 */

let status = "";

/** The status line for the dagr export: the last publish's reason, or "" when the last publish succeeded. */
export function dagrStatus(): string {
  return status;
}

/** Set the dagr export status line (empty clears it). */
export function setDagrStatus(s: string): void {
  status = s;
}

/** The text of a failed publish, never empty so a failure is never shown as success. */
function reasonOf(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text || "publish failed";
}

/**
 * A scheduler for one export. `publish` resolves to null on success or to a reason string; `document` returns the run
 * to publish, or null when there is nothing to publish; `generation` changes whenever the run is reset.
 */
export function makeScheduler(deps: {
  after(ms: number, fn: () => void): unknown;
  publish(json: string): Promise<string | null>;
  document(): Record<string, unknown> | null;
  generation(): number;
}): { changed(debounceMs: number): void; disable(): void } {
  let seq = 0;
  let pending: { id: number; gen: number } | null = null;
  let inflight = false;
  let dirty = false;
  let disabled = false;
  let lastDebounce = 0;

  /** Start the one timer; `gen` is captured now so a reset before it fires makes it a no-op. */
  function schedule(ms: number): void {
    const id = ++seq;
    const gen = deps.generation();
    pending = { id, gen };
    deps.after(ms, () => fire(id, gen));
  }

  function fire(id: number, gen: number): void {
    if (pending === null || pending.id !== id) return;
    pending = null;
    if (disabled || gen !== deps.generation()) return;
    const doc = deps.document();
    if (doc === null) return;
    inflight = true;
    new Promise<string | null>((resolve) => resolve(deps.publish(JSON.stringify(doc))))
      .catch((e: unknown) => reasonOf(e))
      .then(settle);
  }

  function settle(reason: string | null): void {
    inflight = false;
    setDagrStatus(reason ?? "");
    if (dirty && !disabled) schedule(lastDebounce);
    dirty = false;
  }

  return {
    changed(debounceMs: number): void {
      if (disabled) return;
      lastDebounce = debounceMs;
      if (inflight) {
        dirty = true;
        return;
      }
      if (pending !== null && pending.gen === deps.generation()) return;
      schedule(debounceMs);
    },
    disable(): void {
      disabled = true;
      pending = null;
    },
  };
}
