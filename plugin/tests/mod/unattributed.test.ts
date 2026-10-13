/** Unattributed changes: porcelain paths, the spawn-to-stop diff, the snapshot cap, and files_by's edit/shell split. */
import { expect, test } from "claude-code/testing";
import { attributedPaths, noteStop, noteSnapshot, noteToolCall, porcelainPaths, resetCrew, takeSnapshot, touchedBy, unattributedChanges, UNATTRIBUTED_MAX } from "../../src/mod/crew.ts";

test("porcelain -z output gives each changed path unquoted, a rename's new name only", () => {
  const text = " M src/a b.ts\0?? new/ü.ts\0R  new/c.ts\0old.ts\0?? d.ts\0";
  expect([...porcelainPaths(text)].sort()).toEqual(["d.ts", "new/c.ts", "new/ü.ts", "src/a b.ts"]);
  expect([...porcelainPaths("")]).toEqual([]);
});

test("a new change no agent's edits or shell writes explain is unattributed; known and pre-existing ones are not", () => {
  const before = new Set(["dirty.ts"]);
  const after = new Set(["dirty.ts", "agent.ts", "shell.txt", "script-out.json", "other.ts"]);
  expect(unattributedChanges("/repo", before, after, ["/repo/agent.ts", "shell.txt"])).toEqual(["other.ts", "script-out.json"]);
  // An absolute path outside the repo explains nothing inside it.
  expect(unattributedChanges("/repo", new Set(), new Set(["x.ts"]), ["/elsewhere/x.ts"])).toEqual(["x.ts"]);
});

test("unattributed changes are capped", () => {
  const after = new Set(Array.from({ length: UNATTRIBUTED_MAX + 5 }, (_, i) => `f${String(i).padStart(2, "0")}.ts`));
  expect(unattributedChanges("/repo", new Set(), after, []).length).toBe(UNATTRIBUTED_MAX);
});

test("touchedBy splits edit-tool files from shell writes, and a stopped agent's files stay attributed for ten minutes", () => {
  resetCrew();
  noteToolCall({ agentId: "a1", tool: "Edit", file_path: "/repo/x.ts", old_string: "a", new_string: "b" }, 1000);
  noteToolCall({ agentId: "a1", tool: "Bash", command: "echo hi > /repo/out.txt" }, 1000);
  expect(touchedBy("a1")).toEqual({ edit: ["/repo/x.ts"], shell: ["/repo/out.txt"] });
  noteStop("a1", "haiku-coder", "pass", 2000);
  expect([...attributedPaths(2000 + 9 * 60_000)].sort()).toEqual(["/repo/out.txt", "/repo/x.ts"]);
  expect(attributedPaths(2000 + 11 * 60_000)).toEqual([]);
});

test("a spawn snapshot is kept until its stop, and the store holds 50 at most", () => {
  resetCrew();
  noteSnapshot("first", { root: "/repo", paths: new Set() });
  for (let i = 0; i < 50; i++) noteSnapshot(`a${i}`, { root: "/repo", paths: new Set() });
  expect(takeSnapshot("first")).toBeUndefined();
  expect(takeSnapshot("a49")?.root).toBe("/repo");
  expect(takeSnapshot("a49")).toBeUndefined();
});
