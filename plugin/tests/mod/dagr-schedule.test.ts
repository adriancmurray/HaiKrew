/** dagr export scheduling with a fake clock: debounce, coalescing, generation guard, disable, status, settings group. */
import { expect, test } from "claude-code/testing";
import { dagrStatus, makeScheduler, setDagrStatus } from "../../src/mod/dagr-schedule.ts";
import { GROUPS } from "../../src/mod/pane-settings.ts";
import { defaults } from "../../src/schema.ts";

/** Let pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A clock whose timers fire in due order during tick(), with promise callbacks flushed after each one. */
function fakeClock() {
  let now = 0;
  const timers: { due: number; fn: () => void }[] = [];
  return {
    after(ms: number, fn: () => void): void {
      timers.push({ due: now + ms, fn });
    },
    async tick(ms: number): Promise<void> {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        now = due.due;
        due.fn();
        await flush();
      }
      now = end;
    },
  };
}

test("sustained activity publishes at least six times in 10 seconds", async () => {
  const clock = fakeClock();
  let publishes = 0;
  const s = makeScheduler({
    after: clock.after,
    publish: async () => {
      publishes++;
      return null;
    },
    document: () => ({ dagr: 3 }),
    generation: () => 0,
  });
  for (let t = 0; t < 10000; t += 200) {
    s.changed(1500);
    await clock.tick(200);
  }
  expect(publishes).toBeGreaterThanOrEqual(6);
});

test("changes during a publish coalesce into one follow-up after the debounce", async () => {
  const clock = fakeClock();
  const published: string[] = [];
  let resolveLast: (v: string | null) => void = () => {};
  const s = makeScheduler({
    after: clock.after,
    publish: (json) => {
      published.push(json);
      return new Promise((r) => {
        resolveLast = r;
      });
    },
    document: () => ({ dagr: 3 }),
    generation: () => 0,
  });
  s.changed(1500);
  await clock.tick(1500);
  expect(published.length).toBe(1);
  for (let i = 0; i < 5; i++) s.changed(1500);
  resolveLast(null);
  await flush();
  await clock.tick(1500);
  expect(published.length).toBe(2);
  await clock.tick(5000);
  expect(published.length).toBe(2);
});

test("a timer set before a generation bump does not publish", async () => {
  const clock = fakeClock();
  let publishes = 0;
  let gen = 0;
  const s = makeScheduler({
    after: clock.after,
    publish: async () => {
      publishes++;
      return null;
    },
    document: () => ({ dagr: 3 }),
    generation: () => gen,
  });
  s.changed(1500);
  gen = 1;
  await clock.tick(3000);
  expect(publishes).toBe(0);
});

test("a change after a generation bump publishes under the new generation", async () => {
  const clock = fakeClock();
  let publishes = 0;
  let gen = 0;
  const s = makeScheduler({
    after: clock.after,
    publish: async () => {
      publishes++;
      return null;
    },
    document: () => ({ dagr: 3 }),
    generation: () => gen,
  });
  s.changed(1500);
  gen = 1;
  s.changed(1500);
  await clock.tick(3000);
  expect(publishes).toBe(1);
});

test("disable stops publishing, including a pending timer", async () => {
  const clock = fakeClock();
  let publishes = 0;
  const s = makeScheduler({
    after: clock.after,
    publish: async () => {
      publishes++;
      return null;
    },
    document: () => ({ dagr: 3 }),
    generation: () => 0,
  });
  s.changed(1500);
  s.disable();
  await clock.tick(3000);
  s.changed(1500);
  await clock.tick(3000);
  expect(publishes).toBe(0);
});

test("status follows the publish result, and a rejected publish is a reason", async () => {
  const clock = fakeClock();
  setDagrStatus("");
  const results: Array<string | null | Error> = ["boom", null, new Error("gone")];
  const s = makeScheduler({
    after: clock.after,
    publish: async () => {
      const next = results.shift() ?? null;
      if (next instanceof Error) throw next;
      return next;
    },
    document: () => ({ dagr: 3 }),
    generation: () => 0,
  });
  s.changed(250);
  await clock.tick(250);
  expect(dagrStatus()).toBe("boom");
  s.changed(250);
  await clock.tick(250);
  expect(dagrStatus()).toBe("");
  s.changed(250);
  await clock.tick(250);
  expect(dagrStatus()).toBe("gone");
  setDagrStatus("");
});

test("the general group shows the dagr section, which defaults to off with a 1500 ms debounce", () => {
  const general = GROUPS.find((g) => g.id === "general");
  expect((general?.sections as readonly string[]).includes("dagr")).toBe(true);
  expect(defaults().dagr).toEqual({ enabled: false, debounce_ms: 1500 });
});
