/** The launcher's shell quoting: a plugin root with shell syntax reaches the script as one literal argument. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

// Each command is what the launcher rewrite writes for `haikrew verify` under the root (plugin/tests/mod/launcher.test.ts).
const CASES: [string, string][] = [
  ["/a$(id)b", "node '/a$(id)b/scripts/haikrew.mjs' verify"],
  ['/a"b', `node '/a"b/scripts/haikrew.mjs' verify`],
  ["/a'b", "node '/a'\\''b/scripts/haikrew.mjs' verify"],
  ["/with space", "node '/with space/scripts/haikrew.mjs' verify"],
];

describe("launcher quoting", () => {
  for (const [root, command] of CASES) {
    it(`passes the script path under ${root} as one literal argument`, () => {
      // Drop `node` and let bash print each argument it would hand to the script.
      const args = command.slice("node ".length);
      const r = spawnSync("bash", ["-c", `printf '%s\\n' ${args}`], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `${root}/scripts/haikrew.mjs\nverify\n`);
    });
  }
});
