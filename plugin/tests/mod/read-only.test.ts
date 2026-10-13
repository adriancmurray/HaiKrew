/** Write detection (sh -c, sed -i, curl -o, dd, git repo rewrites, quoted and dynamic targets) and the read-only guard. */
import { expect, test } from "claude-code/testing";
import { shellWrites } from "../../src/mod/shell-writes.ts";
import { callerType, commandDir, readOnlyGuard, resolvePath } from "../../src/mod/guards.ts";
import type { GuardsSettings } from "../../src/mod/guards.ts";
import type { Input } from "../../src/mod/api.ts";

const ON: GuardsSettings = { read_only_agents: true };
const OFF: GuardsSettings = { read_only_agents: false };
const REPO = "/Users/a/repo";
const CHECKER = "haikrew:haiku-checker";
const passThrough = (e: Input) => ({ next: e });
const denyOf = (cfg: GuardsSettings, type: string, command: string, cwd = REPO) =>
  (readOnlyGuard(cfg, type, { command }, cwd, passThrough) as { deny?: string }).deny;

test("shellWrites reads the command inside sh -c and bash -c", () => {
  expect(shellWrites('sh -c "cp a.ts b.ts"')).toEqual(["b.ts"]);
  expect(shellWrites("bash -c 'rm -rf build'")).toEqual(["build"]);
  expect(shellWrites('cd x && bash -lc "echo hi > out.txt"')).toEqual(["out.txt"]);
  expect(shellWrites("sh -c 'cat a.ts'")).toBeNull();
});

test("shellWrites reads every file sed -i or perl -i edits", () => {
  expect(shellWrites("sed -i 's/a/b/' a.ts b.ts")).toEqual(["a.ts", "b.ts"]);
  expect(shellWrites("sed -i -e 's/a/b/' -e 's/c/d/' a.ts")).toEqual(["a.ts"]);
  expect(shellWrites("sed -i '' 's/a/b/' a.ts")).toEqual(["a.ts"]);
  expect(shellWrites("perl -pi -e 's/a/b/' d.ts e.ts")).toEqual(["d.ts", "e.ts"]);
  expect(shellWrites("sed -n '1,5p' a.ts b.ts")).toBeNull();
});

test("shellWrites reads the file curl -o or --output writes, and not a device or stdout", () => {
  expect(shellWrites("curl -sS -o out.json https://example.com/x")).toEqual(["out.json"]);
  expect(shellWrites("curl --output dl/file.bin https://example.com/x")).toEqual(["dl/file.bin"]);
  expect(shellWrites("curl -o /dev/null https://example.com/x")).toBeNull();
  expect(shellWrites("curl -o - https://example.com/x")).toBeNull();
  expect(shellWrites("curl https://example.com/x")).toBeNull();
});

test("tee and redirects ignore devices", () => {
  expect(shellWrites("echo x | tee /dev/null")).toBeNull();
  expect(shellWrites("echo x | tee out.txt")).toEqual(["out.txt"]);
  expect(shellWrites("echo x > /dev/null 2>&1")).toBeNull();
});

test("shellWrites reports repo-wide git rewrites as the repo marker", () => {
  expect(shellWrites("git reset --hard HEAD~1")).toEqual(["<repo>"]);
  expect(shellWrites("git merge feature/x")).toEqual(["<repo>"]);
  expect(shellWrites("git stash pop")).toEqual(["<repo>"]);
  expect(shellWrites("git stash apply stash@{0}")).toEqual(["<repo>"]);
  expect(shellWrites("git commit -m x")).toEqual(["<repo>"]);
  expect(shellWrites("git checkout -- a.ts")).toEqual(["<repo>"]);
  expect(shellWrites("git restore a.ts")).toEqual(["<repo>"]);
  expect(shellWrites("git -C sub commit -m x")).toEqual(["<repo>"]);
  expect(shellWrites("git -C sub status")).toBeNull();
  expect(shellWrites("git stash list")).toBeNull();
  expect(shellWrites("git reset --soft HEAD~1")).toBeNull();
});

test("shellWrites reads quoted redirect targets and marks unresolvable ones", () => {
  expect(shellWrites('echo a > "/Users/x/f"')).toEqual(["/Users/x/f"]);
  expect(shellWrites("echo a > 'my file.txt'")).toEqual(["my file.txt"]);
  expect(shellWrites('echo a > "$DIR/f"')).toEqual(["<dynamic>"]);
  expect(shellWrites("echo a > $(pwd)/f")).toEqual(["<dynamic>"]);
  expect(shellWrites("rm -rf \"$BUILD\"")).toEqual(["<dynamic>"]);
});

test("shellWrites reads >| and >&file, but not >&1 or >&2", () => {
  expect(shellWrites("echo a >| f.txt")).toEqual(["f.txt"]);
  expect(shellWrites("echo a >& f.txt")).toEqual(["f.txt"]);
  expect(shellWrites("echo a >&2")).toBeNull();
  expect(shellWrites("echo a >&1")).toBeNull();
});

test("shellWrites reads dd's of= target", () => {
  expect(shellWrites("dd if=/dev/zero of=out.bin bs=1 count=1")).toEqual(["out.bin"]);
  expect(shellWrites("dd if=x of=/dev/null")).toBeNull();
  expect(shellWrites("dd if=x")).toBeNull();
});

test("resolvePath folds . and .. and keeps relative paths relative when the directory is unknown", () => {
  expect(resolvePath("/Users/a/repo", "src/../x.ts")).toBe("/Users/a/repo/x.ts");
  expect(resolvePath("/Users/a/repo", "/tmp/../Users/x")).toBe("/Users/x");
  expect(resolvePath("", "x.ts")).toBe("x.ts");
});

test("commandDir moves the base by a leading cd", () => {
  expect(commandDir("cd /tmp && echo a > x", REPO)).toBe("/tmp");
  expect(commandDir("cd src; cd lib && echo a", REPO)).toBe("/Users/a/repo/src/lib");
  expect(commandDir("echo a > x", REPO)).toBe(REPO);
});

test("a read-only subagent's Bash write outside temp folders is denied", () => {
  expect(denyOf(ON, CHECKER, "echo x > src/a.ts")).toBe("haikrew:haiku-checker is read-only: write to /Users/a/repo/src/a.ts refused; use a temp folder");
  expect(denyOf(ON, "Explore", "git stash pop")).toBe("Explore is read-only: write to <repo> at /Users/a/repo refused; use a temp folder");
  expect(denyOf(ON, "haikrew:sonnet-reviewer", "sed -i 's/a/b/' a.ts")).toContain("write to /Users/a/repo/a.ts refused");
  expect(denyOf(ON, CHECKER, "bash -c 'rm -rf build'")).toContain("write to /Users/a/repo/build refused");
  expect(denyOf(ON, CHECKER, "cd src && echo a > x")).toContain("write to /Users/a/repo/src/x refused");
});

test("a cd into a temp folder makes relative targets temp, and .. cannot escape it", () => {
  expect(denyOf(ON, CHECKER, "cd /tmp && echo a > x")).toBeUndefined();
  expect(denyOf(ON, CHECKER, "echo a > /tmp/../Users/x")).toContain("write to /Users/x refused");
  expect(denyOf(ON, CHECKER, "cd /tmp/../Users && echo a > x")).toContain("write to /Users/x refused");
});

test("a write target with $ or a backtick is denied with the literal-path reason", () => {
  expect(denyOf(ON, CHECKER, 'echo a > "$TMPDIR/x"')).toBe("haikrew:haiku-checker is read-only: write target not literal; use a literal temp path");
  expect(denyOf(ON, "Explore", "rm -rf $(pwd)/build")).toContain("write target not literal");
});

test("temp folders, scratchpads, reads and other agents are never denied", () => {
  expect(denyOf(ON, CHECKER, "echo x > /tmp/out.txt")).toBeUndefined();
  expect(denyOf(ON, CHECKER, "echo x > /private/var/folders/ab/T/out.txt")).toBeUndefined();
  expect(denyOf(ON, CHECKER, "echo x > /Volumes/work/s/scratchpad/out.txt")).toBeUndefined();
  expect(denyOf(ON, CHECKER, "echo x > /Users/a/repo/scratchpad/out.txt")).toBeUndefined();
  expect(denyOf(ON, CHECKER, "cat src/a.ts")).toBeUndefined();
  expect(denyOf(ON, CHECKER, "echo x > /dev/null")).toBeUndefined();
  expect(denyOf(ON, "", "echo x > src/a.ts")).toBeUndefined();
  expect(denyOf(ON, "general-purpose", "echo x > src/a.ts")).toBeUndefined();
  expect(denyOf(OFF, CHECKER, "echo x > src/a.ts")).toBeUndefined();
});

test("callerType takes the live agent list's type when the crew row has none", async () => {
  const list = async () => [{ id: "agent-zz-1", type: "haikrew:haiku-checker" }];
  expect(await callerType(list, "agent-zz-1")).toBe("haikrew:haiku-checker");
  expect(await callerType(list, "agent-zz-2")).toBe("");
  expect(await callerType(async () => { throw new Error("no list"); }, "agent-zz-1")).toBe("");
});
