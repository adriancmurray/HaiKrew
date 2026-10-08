/** Squeeze tests: each summarizer on a short sample log, run() verdicts and log files, and verify(). */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const data = mkdtempSync(join(tmpdir(), "haikrew-data-"));
process.env.TMPDIR = data; // tmpdir() follows TMPDIR, so logs land under data/haikrew
after(() => {
  rmSync(data, { recursive: true, force: true });
});

const squeeze = await import("../plugin/src/squeeze.ts");

const CARGO_LOG = `error[E0425]: cannot find value \`x\` in this scope
 --> src/lib.rs:4:5
test tests::adds ... ok
test tests::breaks ... FAILED
test result: FAILED. 1 passed; 1 failed; 0 ignored
`;
const SWIFT_LOG = `Test Case 'FooTests.testA' started.
/repo/Tests/FooTests.swift:12:5: error: XCTAssertEqual failed: recorded an issue at FooTests.swift:12:5
Caught error: boom
Test run with 3 tests in 1 suite failed after 0.010 seconds.
/repo/Sources/Foo.swift:7:9: error: cannot find 'bar' in scope
`;
const PYTEST_LOG = `F.
=================== FAILURES ===================
FAILED tests/test_a.py::test_b - AssertionError: assert 1 == 2
=== 1 failed, 1 passed in 0.12s ===
`;
const JEST_LOG = ` PASS  src/a.test.ts
 FAIL  src/b.test.ts
  ✕ adds numbers (3 ms)
Tests:       1 failed, 1 passed, 2 total
`;
const GO_LOG = `--- FAIL: TestAdd (0.00s)
    a_test.go:9: want 3 got 2
FAIL
FAIL\texample.com/m\t0.012s
ok  \texample.com/n\t0.003s
`;

/** Summary lines the way run() picks them: the first summarizer whose matcher accepts cmd. */
function summarize(cmd: string, log: string): string {
  const pick = squeeze.SUMMARIZERS.find(([matches]) => matches(cmd));
  return (pick ? pick[1](log) : []).join("\n");
}

/** Run fn with process.stdout captured, returning its result and the captured text. */
function capture(fn: () => number): { code: number; out: string } {
  let out = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: fn(), out };
  } finally {
    process.stdout.write = original;
  }
}

describe("summarizers", () => {
  it("cargo", () => {
    const out = summarize("cargo test", CARGO_LOG);
    assert.match(out, /tests: 2 run, 1 failed/);
    assert.match(out, /FAILED tests::breaks/);
    assert.match(out, /error\[E0425\]: cannot find value `x` in this scope at src\/lib\.rs:4:5/);
  });

  it("swift ignores Caught error", () => {
    const out = summarize("swift test", SWIFT_LOG);
    assert.match(out, /Test run with 3 tests/);
    assert.match(out, /recorded an issue at/);
    assert.match(out, /Foo\.swift:7:9: error: cannot find 'bar' in scope/);
    assert.doesNotMatch(out, /Caught error/);
  });

  it("pytest", () => {
    const out = summarize("python3 -m pytest -q", PYTEST_LOG);
    assert.match(out, /1 failed, 1 passed in 0.12s/);
    assert.match(out, /FAILED tests\/test_a\.py::test_b - AssertionError: assert 1 == 2/);
  });

  it("jest", () => {
    const out = summarize("npm test", JEST_LOG);
    assert.match(out, /Tests:       1 failed, 1 passed, 2 total/);
    assert.match(out, /✕ adds numbers \(3 ms\)/);
    assert.match(out, /FAIL  src\/b\.test\.ts/);
  });

  it("go", () => {
    const out = summarize("go test ./...", GO_LOG);
    assert.match(out, /--- FAIL: TestAdd \(0\.00s\)/);
    assert.match(out, /FAIL\texample\.com\/m\t0\.012s/);
    assert.match(out, /ok  \texample\.com\/n\t0\.003s/);
  });

  it("generic dedupes errors and keeps the tail", () => {
    const out = summarize("make", "compiling\nerror: missing header\nerror: missing header\nlinking\ndone\n");
    assert.equal(out.split("error: missing header").length - 1, 1);
    assert.match(out, /done/);
  });
});

describe("run and verify", () => {
  const dir = mkdtempSync(join(tmpdir(), "haikrew-verify-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("passes and writes the full log", () => {
    const { code, out } = capture(() => squeeze.run([process.execPath, "-e", "console.log('hi')"]));
    assert.equal(code, 0);
    assert.match(out, /exit 0/);
    assert.match(out, /VERDICT: PASS/);
    const logs = join(data, "haikrew", "logs");
    assert.ok(readdirSync(logs).some((f) => readFileSync(join(logs, f), "utf8") === "hi\n"));
  });

  it("reports failure with the command's exit code", () => {
    const { code, out } = capture(() =>
      squeeze.run([process.execPath, "-e", "console.log('boom'); process.exit(3)"]));
    assert.equal(code, 3);
    assert.match(out, /VERDICT: FAIL/);
  });

  it("caps output lines", () => {
    const { out } = capture(() =>
      squeeze.run([process.execPath, "-e", "for (let i = 0; i < 100; i++) console.log('line', i)"]));
    assert.ok(out.trimEnd().split("\n").length <= squeeze.SQUEEZE_OPTIONS.maxLines);
  });

  it("verify runs the repo script", () => {
    const script = join(dir, ".haikrew", "verify");
    mkdirSync(join(dir, ".haikrew"));
    writeFileSync(script, "#!/bin/sh\necho ran-verify\n");
    chmodSync(script, 0o755);
    const { code, out } = capture(() => squeeze.verify(dir));
    assert.equal(code, 0);
    assert.match(out, /VERDICT: PASS/);
  });

  it("verify without a script or known project exits 2", () => {
    const empty = mkdtempSync(join(dir, "empty-"));
    const { code, out } = capture(() => squeeze.verify(empty));
    assert.equal(code, 2);
    assert.match(out, /no known project type/);
  });
});
