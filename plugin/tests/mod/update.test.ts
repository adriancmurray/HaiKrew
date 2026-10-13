/** Update check: version order, the plugin.json reader, the 6-hour throttle with a fake GET, and the update runner with a fake command. */
import { expect, test } from "claude-code/testing";
import { UPDATE_COMMAND, UPDATE_EVERY_MS, availableUpdate, checkUpdate, newer, resetUpdate, runUpdate, updateOutcome, versionOf } from "../../src/mod/update.ts";
import type { RunResult, UpdateIo, UpdateRecord } from "../../src/mod/update.ts";

const HOUR = 3600 * 1000;

/** An io whose stored record lives in `store`, so a second call sees what the first one saved. */
function fakeIo(now: number, store: { value: unknown }, get: UpdateIo["get"]): UpdateIo {
  return {
    now,
    load: async () => store.value,
    save: async (r: UpdateRecord) => { store.value = r; },
    get,
  };
}

test("newer orders releases and dev builds", () => {
  expect(newer("0.6.8-dev.3", "0.6.8")).toBe(true);
  expect(newer("0.6.8", "0.6.9")).toBe(true);
  expect(newer("0.6.9", "0.6.10")).toBe(true);
  expect(newer("0.6.8-dev.4", "0.6.8-dev.9")).toBe(true);
  expect(newer("0.6.8", "0.6.8-dev.1")).toBe(false);
  expect(newer("0.6.9", "0.6.8")).toBe(false);
  expect(newer("0.6.8", "0.6.8")).toBe(false);
  expect(newer("0.6.8-dev.9", "0.6.8-dev.4")).toBe(false);
  expect(newer("0.6.8", "garbage")).toBe(false);
  expect(newer("garbage", "0.6.8")).toBe(false);
  expect(newer(" 0.6.8 ", " 0.6.9 ")).toBe(true);
});

test("versionOf reads the version field and gives \"\" for anything else", () => {
  expect(versionOf('{"name":"haikrew","version":"0.6.8"}')).toBe("0.6.8");
  expect(versionOf("not json")).toBe("");
  expect(versionOf('{"version":3}')).toBe("");
  expect(versionOf("null")).toBe("");
});

test("the update check reads once, then at most every 6 hours", async () => {
  resetUpdate();
  const store: { value: unknown } = { value: null };
  let calls = 0;
  const get = async (): Promise<string> => { calls++; return JSON.stringify({ version: "0.6.9" }); };
  const first = await checkUpdate(fakeIo(1000, store, get));
  expect(first).toEqual({ latest: "0.6.9", checkedAt: 1000 });
  expect(calls).toBe(1);
  expect(await checkUpdate(fakeIo(1000 + 6 * HOUR - 60_000, store, get))).toEqual(first);
  expect(calls).toBe(1);
  expect((await checkUpdate(fakeIo(1000 + UPDATE_EVERY_MS, store, get)))?.checkedAt).toBe(1000 + UPDATE_EVERY_MS);
  expect(calls).toBe(2);
});

test("a failed read is saved with the previous latest and does not throw", async () => {
  resetUpdate();
  const store: { value: unknown } = { value: { latest: "0.6.8", checkedAt: 0 } };
  let calls = 0;
  const get = async (): Promise<string> => { calls++; throw new Error("offline"); };
  const record = await checkUpdate(fakeIo(7 * HOUR, store, get));
  expect(record).toEqual({ latest: "0.6.8", checkedAt: 7 * HOUR });
  expect(store.value).toEqual({ latest: "0.6.8", checkedAt: 7 * HOUR });
  expect(calls).toBe(1);
  expect(await checkUpdate(fakeIo(8 * HOUR, store, get))).toEqual(record);
  expect(calls).toBe(1);
});

test("a failed load returns null without a request", async () => {
  resetUpdate();
  let calls = 0;
  const io: UpdateIo = {
    now: 1000,
    load: async () => { throw new Error("unreadable"); },
    save: async () => {},
    get: async () => { calls++; return "{}"; },
  };
  expect(await checkUpdate(io)).toBe(null);
  expect(calls).toBe(0);
});

test("parallel update checks share one request", async () => {
  resetUpdate();
  const store: { value: unknown } = { value: null };
  let calls = 0;
  const get = async (): Promise<string> => { calls++; return JSON.stringify({ version: "0.6.9" }); };
  const [a, b] = await Promise.all([checkUpdate(fakeIo(1, store, get)), checkUpdate(fakeIo(1, store, get))]);
  expect(calls).toBe(1);
  expect(a).toEqual({ latest: "0.6.9", checkedAt: 1 });
  expect(b).toEqual(a);
  resetUpdate();
});

test("availableUpdate offers only a newer stored version", () => {
  expect(availableUpdate("0.6.8", { latest: "0.6.9", checkedAt: 0 })).toBe("0.6.9");
  expect(availableUpdate("0.6.9", { latest: "0.6.9", checkedAt: 0 })).toBe("");
  expect(availableUpdate("0.6.8", null)).toBe("");
});

test("updateOutcome words a success, a failed run, a thrown error and an empty failure", () => {
  expect(updateOutcome({ exitCode: 0, stdout: "", stderr: "" }, "0.6.9")).toBe("Updated. Restart Claude to use 0.6.9.");
  expect(updateOutcome({ exitCode: 1, stdout: "out line", stderr: "\n  error: no network\nmore" }, "0.6.9")).toBe("error: no network");
  expect(updateOutcome({ exitCode: 1, stdout: "\nout line\n", stderr: "" }, "0.6.9")).toBe("out line");
  expect(updateOutcome({ exitCode: 2, stdout: "", stderr: "" }, "0.6.9")).toBe("claude plugin update failed (exit 2)");
  expect(updateOutcome(new Error("spawn claude ENOENT\nstack"), "0.6.9")).toBe("spawn claude ENOENT");
});

test("runUpdate runs the plugin update command and reports its outcome, or a throw", async () => {
  let argv: string[] = [];
  const ok = async (a: string[]): Promise<RunResult> => { argv = a; return { exitCode: 0, stdout: "", stderr: "" }; };
  expect(await runUpdate(ok, "0.6.9")).toBe("Updated. Restart Claude to use 0.6.9.");
  expect(argv).toEqual(UPDATE_COMMAND);
  const boom = async (): Promise<RunResult> => { throw new Error("spawn claude ENOENT\nstack"); };
  expect(await runUpdate(boom, "0.6.9")).toBe("spawn claude ENOENT");
});

test("a checkedAt in the future does not refetch before 6 real hours pass", async () => {
  resetUpdate();
  let gets = 0;
  const now = 10_000_000_000;
  const io = (at: number) => ({ now: at, load: async () => ({ latest: "1.0.0", checkedAt: now + 3600_000 }), save: async () => {}, get: async () => { gets++; return "{}"; } });
  await checkUpdate(io(now));
  expect(gets).toBe(0);
  await checkUpdate(io(now + UPDATE_EVERY_MS - 1));
  expect(gets).toBe(0);
  await checkUpdate(io(now + UPDATE_EVERY_MS + 3600_000));
  expect(gets).toBe(1);
});
