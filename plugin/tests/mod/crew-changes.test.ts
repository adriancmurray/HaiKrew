/** Recorded file changes: Bash writes, scratch paths, deletions, refused calls, unique names, and the ledger lock. */
import { expect, test } from "claude-code/testing";
import { noteSpawn, noteToolCall, noteToolChange, resetCrew, rowFor, touched, untrackedName } from "../../src/mod/crew.ts";
import { outsideTree, shellWrites } from "../../src/mod/shell-writes.ts";
import { serial } from "../../src/mod/serial.ts";
import { resetEffort } from "../../src/mod/effort.ts";
import { resetSeams } from "../../src/mod/seam.ts";

test("shellWrites finds file-writing commands and ignores read-only ones", () => {
  const writes = [
    "echo hi > out.txt", "echo hi >> /repo/log.txt", "cat > a.ts <<'EOF'\nx\nEOF", "ls | tee b.txt", "sed -i 's/a/b/' c.ts",
    "sed -i.bak -e 's/a/b/' c.ts", "perl -pi -e 's/a/b/' d.ts", "mv a b", "cp a b", "rm -rf build", "mkdir -p x/y", "touch z",
    "git apply fix.patch", "git checkout -- a.ts", "git restore a.ts", "git commit -m 'x'", "git mv a b", "git rm a", "patch -p1 < f.diff",
    "python3 - <<'PY'\nopen('f.txt', 'w').write('x')\nPY", "node -e \"require('fs').writeFileSync('f','x')\"", "npm test && echo done > r.txt",
  ];
  for (const c of writes) expect([c, shellWrites(c) !== null]).toEqual([c, true]);
  const reads = [
    "cat a.ts", "grep -rn foo src", "ls -la", "git status", "git diff", "git log --oneline", "node --test", "node --test tests/",
    "echo hi > /dev/null", "ls 2>&1", "ls 2>/dev/null", "echo 'a > b'", "python3 -c \"print(1)\"", "sed -n '1,5p' a.ts", "cat <<EOF\na > b\nEOF",
    "cd x && npm run build", "node script.js",
  ];
  for (const c of reads) expect([c, shellWrites(c)]).toEqual([c, null]);
});

test("shellWrites reads simple paths and leaves the rest unparsed", () => {
  expect(shellWrites("echo hi > out.txt")).toEqual(["out.txt"]);
  expect(shellWrites("cp a.ts b.ts")).toEqual(["b.ts"]);
  expect(shellWrites("sed -i 's/a/b/' src/c.ts")).toEqual(["src/c.ts"]);
  expect(shellWrites("git commit -m x")).toEqual(["<repo>"]);
  expect(shellWrites('echo hi > "$OUT"')).toEqual(["<dynamic>"]);
  expect(outsideTree("/tmp/x")).toBe(true);
  expect(outsideTree("/var/folders/xy/T/scratchpad/a")).toBe(true);
  expect(outsideTree("/var/folders/ab/T/x")).toBe(true);
  expect(outsideTree("/Users/a/repo/scratchpad/a")).toBe(true);
  expect(outsideTree("/Users/a/repo/tmp/x.ts")).toBe(false);
});

test("Bash writes count as unknown size, scratch writes and deleted lines are handled", () => {
  resetCrew();
  noteSpawn({ prompt: "x" }, { model: "haiku", agentId: "b1" }, 0);
  noteToolCall({ agentId: "b1", tool: "Bash", command: "npm test" }, 1);
  expect(touched("b1")).toEqual({ paths: [], lines: 0 });
  noteToolCall({ agentId: "b1", tool: "Bash", command: "echo x > /tmp/a.txt" }, 2);
  noteToolCall({ agentId: "b1", tool: "Write", file_path: "/tmp/session/scratchpad/n.ts", content: "a\nb" }, 3);
  expect(touched("b1")).toEqual({ paths: [], lines: 0 });
  noteToolCall({ agentId: "b1", tool: "Bash", command: "git commit -m x" }, 4);
  noteToolCall({ agentId: "b1", tool: "Bash", command: "mv a.ts b.ts" }, 5);
  expect(touched("b1")).toEqual({ paths: ["<repo>", "a.ts", "b.ts"], lines: 60 });
  noteToolCall({ agentId: "b1", tool: "Edit", file_path: "/r/a.ts", old_string: "1\n2\n3\n4", new_string: "x" }, 6);
  noteToolCall({ agentId: "b1", tool: "MultiEdit", file_path: "/r/a.ts", edits: [{ old_string: "a\nb", new_string: "" }, { old_string: "q", new_string: "1\n2\n3" }] }, 7);
  expect(touched("b1").lines).toBe(60 + 4 + 2 + 3);
});

const SETTINGS = { gate: { enabled: true, rules: [] } };

/** Spawn agents `ids`, run `calls` on the first, stop every agent; returns the store and the session notes. */
async function runCrew(ctx: any, on: any, calls: any[], ids = ["w1"], slow = false) {
  resetCrew(); resetEffort(); resetSeams();
  const stored: Record<string, any> = { settings: SETTINGS };
  const notes: string[] = [];
  let next = 0;
  const transcript = (name: string) => [
    { type: "user", timestamp: "2026-10-08T09:00:00.000Z", message: { content: `HAIKREW job=implement lang=ts name=${name}\nedit it` } },
    { type: "assistant", timestamp: "2026-10-08T09:00:09.000Z", message: { id: "m1", model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "Done." }] } },
  ].map((l) => JSON.stringify(l)).join("\n");
  on("session.cwd", async () => ({ value: "/r" }));
  on("agent.spawn", async (_$: any, e: any) => ({ model: "haiku", agentId: ids[next++] }));
  on("classic.SubagentStop", async () => ({ value: null }));
  on("tool.call", async (_$: any, e: any) => (String(e.file_path).includes("denied") ? { deny: "no" } : { result: "ok" }));
  on("store.get", async (_$: any, e: any) => { if (slow) await new Promise((r) => setTimeout(r, 5)); return { value: stored[e.key] }; });
  on("store.set", async (_$: any, e: any) => { if (slow) await new Promise((r) => setTimeout(r, 5)); stored[e.key] = e.value; return { value: undefined }; });
  on("fs.read", async (_$: any, e: any) => ({ value: transcript(String(e.path).slice(1)) }));
  on("ui.invalidate", async () => ({ value: undefined }));
  on("session.append", async (_$: any, e: any, n: any) => { notes.push(JSON.stringify(e)); return n(e); });
  for (const id of ids) {
    await ctx.agent.spawn({ prompt: `HAIKREW job=implement lang=ts name=${id}\nedit`, description: "d", subagentType: "haiku-coder", parentModel: "opus", background: false, fork: false });
  }
  for (const c of calls) await ctx.tool.call({ agentId: ids[0], ...c });
  const stops = ids.map((id) => ctx.classic.SubagentStop({ agent_id: id, agent_type: "haiku-coder", agent_transcript_path: `/${id}` }));
  await Promise.all(stops);
  return { stored, notes };
}

test("a tool call a hook refused records no change, one that ran does", async (ctx: any, on: any) => {
  const { stored } = await runCrew(ctx, on, [
    { tool: "Write", file_path: "/r/denied.ts", content: "a" },
    { tool: "Write", file_path: "/r/ok.ts", content: "a\nb" },
  ]);
  const packet = JSON.stringify(stored.review_packets);
  expect(packet).toContain("/r/ok.ts");
  expect(packet).not.toContain("denied.ts");
});

test("a Bash write alone earns a review", async (ctx: any, on: any) => {
  const { stored } = await runCrew(ctx, on, [{ tool: "Bash", command: "echo x > /r/out.txt" }]);
  expect(JSON.stringify(stored.review_packets)).toContain("/r/out.txt");
});

test("two agents that stop together both reach the ledger", async (ctx: any, on: any) => {
  const { stored } = await runCrew(ctx, on, [], ["a1", "a2"], true);
  expect(stored.ledger.runs.map((r: any) => r.agent_id).sort()).toEqual(["a1", "a2"]);
});

test("a tagged name is unique among agents this session, even after the first one is gone", () => {
  resetCrew();
  const p = "HAIKREW job=fix name=Ada_Test\nx";
  noteSpawn({ prompt: p }, { model: "haiku", agentId: "a1" }, 0);
  noteSpawn({ prompt: p }, { model: "haiku", agentId: "a2" }, 0);
  noteSpawn({ prompt: p }, { model: "haiku", agentId: "a3" }, 0);
  noteSpawn({ prompt: p }, { model: "haiku", agentId: "a1" }, 0); // the same agent again keeps its name
  expect([rowFor("a1", 1)?.name, rowFor("a2", 1)?.name, rowFor("a3", 1)?.name]).toEqual(["Ada Test", "Ada Test II", "Ada Test III"]);
});

test("serial runs overlapping read-modify-writes one at a time, so none is lost", async () => {
  const lock = serial();
  let store = 0;
  const bump = (ms: number) => lock(async () => {
    const read = store;
    await new Promise((r) => setTimeout(r, ms));
    store = read + 1;
  });
  await Promise.all([bump(20), bump(1)]);
  expect(store).toBe(2);
  await lock(async () => { throw new Error("x"); }).catch(() => undefined);
  expect(await lock(async () => "after")).toBe("after");
});

test("a run with no live row is named by its prompt's tag, else by the first 8 characters of its id", () => {
  expect(untrackedName("abcdef1234", "HAIKREW job=fix name=Ada_Test\nx")).toBe("Ada Test");
  expect(untrackedName("abcdef1234", "HAIKREW job=fix\nx")).toBe("agent abcdef12");
  expect(untrackedName("abcdef1234", undefined)).toBe("agent abcdef12");
});

test("a subagent's relative write is recorded at its absolute path, from the session folder or a leading cd", () => {
  resetCrew();
  noteSpawn({ prompt: "x" }, { model: "haiku", agentId: "s1" }, 0);
  noteToolChange({ agentId: "s1", tool: "Bash", command: "echo x > tests/a.ts" }, "/r/plugin");
  noteToolChange({ agentId: "s1", tool: "Edit", file_path: "src/b.ts", old_string: "a", new_string: "b" }, "/r/plugin");
  noteToolChange({ agentId: "s1", tool: "Bash", command: "cd /r/other && echo x > c.ts" }, "/r/plugin");
  expect(touched("s1").paths.sort()).toEqual(["/r/other/c.ts", "/r/plugin/src/b.ts", "/r/plugin/tests/a.ts"]);
});
