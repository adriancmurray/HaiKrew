/** A promise-chain mutex: tasks run one at a time, in call order, and one task's failure does not stop the next. */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Guards every read-modify-write of the ledger and the review packets in the mod store. Never call it from inside itself. */
export const ledgerLock = serial();
