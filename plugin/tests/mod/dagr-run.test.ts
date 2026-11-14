/** dagr run exporter checks: every step of each scripted crew renders a document the subset validator accepts. */
import { expect, test } from "claude-code/testing";
import {
  dagrActive,
  dagrActivity,
  dagrBindReview,
  dagrCheckerVerdict,
  dagrDocument,
  dagrGeneration,
  dagrInlineVerdict,
  dagrLiveStatus,
  dagrReset,
  dagrSpawn,
  dagrStop,
} from "../../src/mod/dagr-run.ts";
import { checkRun } from "../../src/dagr-check.ts";

const SESSION = { id: "s1abcdef99", cwd: "/r" };
const CODER = "haikrew:haiku-coder";
const CHECKER = "haikrew:haiku-checker";

type Doc = { tasks: Array<Record<string, any>>; events: Array<Record<string, any>> };

/** The current document, asserted present and valid under the subset validator. */
function valid(now: number): Doc {
  const doc = dagrDocument(now);
  expect(doc).not.toBeNull();
  expect(checkRun(doc)).toEqual([]);
  return doc as unknown as Doc;
}

function task(doc: Doc, name: string): Record<string, any> {
  const found = doc.tasks.find((t) => t.owner === name);
  expect(found).toBeDefined();
  return found as Record<string, any>;
}

test("inactive until reset", () => {
  expect(dagrActive()).toBe(false);
  expect(dagrDocument(0)).toBeNull();
});

test("coder fail send-back pass", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("coder1", { name: "Pip", type: CODER, description: "build it", model: "claude-haiku-5-5" }, 1000);
  valid(1000);
  dagrActivity("coder1", 1100, false);
  valid(1100);
  dagrStop("coder1", 1500, 1600, { name: "Pip", type: CODER, model: "claude-haiku-5-5", selfVerdict: "none", reviewRequested: true });
  let doc = valid(1600);
  expect(task(doc, "Pip").state).toBe("review");
  expect(task(doc, "Pip").attempts[0]).toMatchObject({ state: "working", ended_at: "1970-01-01T00:00:01.500Z" });

  dagrSpawn("checker1", { name: "Quill", type: CHECKER, description: "check it", model: "claude-haiku-5-5" }, 1700);
  valid(1700);
  dagrBindReview("checker1", "pip", 1800);
  valid(1800);
  dagrCheckerVerdict("checker1", "Pip", "fail", 1900);
  doc = valid(1900);
  const coder1 = structuredClone(task(doc, "Pip").attempts[0]);
  expect(coder1).toMatchObject({ state: "rejected", outcome: { evidence: "reported", result: "rejected" } });
  expect(task(doc, "Quill").attempts[0]).toMatchObject({ state: "done", outcome: { evidence: "reported" } });
  expect(task(doc, "Quill").deps).toEqual([task(doc, "Pip").id]);

  dagrActivity("coder1", 2000, false);
  doc = valid(2000);
  expect(task(doc, "Pip").attempts[1]).toMatchObject({
    state: "working",
    cause: { type: "sent_back", ref: task(doc, "Quill").attempts[0].id },
  });
  expect(task(doc, "Pip").attempts[0]).toEqual(coder1);
  dagrStop("coder1", 2100, 2200, { name: "Pip", type: CODER, model: "claude-haiku-5-5", selfVerdict: "none", reviewRequested: true });
  valid(2200);

  dagrActivity("checker1", 2300, false);
  doc = valid(2300);
  expect(task(doc, "Quill").attempts[1]).toMatchObject({ state: "working", cause: { type: "followup" } });
  dagrCheckerVerdict("checker1", "Pip", "pass", 2400);
  doc = valid(2400);
  expect(task(doc, "Pip").attempts[1]).toMatchObject({ state: "done", outcome: { evidence: "reported" } });
  expect(task(doc, "Pip").attempts[0]).toEqual(coder1);
});

test("kinds from qualified types", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("s", { name: "Ann", type: "haikrew:haiku-scout", description: "look", model: "haiku" }, 10);
  valid(10);
  dagrSpawn("r", { name: "Bo", type: "haikrew:sonnet-reviewer", description: "review", model: "sonnet" }, 20);
  valid(20);
  dagrSpawn("g", { name: "Cy", type: "general-purpose", description: "do", model: "opus" }, 30);
  valid(30);
  dagrActivity("s", 40, false);
  dagrActivity("r", 40, false);
  dagrActivity("g", 40, false);
  const doc = valid(50);
  expect(task(doc, "Ann").kind).toBe("research");
  expect(task(doc, "Bo").kind).toBe("review");
  expect(task(doc, "Cy").kind).toBe("impl");
});

test("stop without review", () => {
  const cases: Array<[SelfVerdictCase, string, string]> = [
    ["pass", "done", "asserted"],
    ["fail", "failed", "asserted"],
    ["blocked", "failed", "asserted"],
    ["none", "settled_unverified", "heuristic"],
  ];
  for (const [verdict, state, evidence] of cases) {
    dagrReset(SESSION, 0);
    dagrSpawn("c", { name: "Pip", type: CODER, description: "x", model: "haiku" }, 100);
    valid(100);
    dagrActivity("c", 200, true);
    valid(200);
    dagrStop("c", 300, 400, { name: "Pip", type: CODER, model: "haiku", selfVerdict: verdict, reviewRequested: false });
    const doc = valid(500);
    expect(task(doc, "Pip").attempts[0]).toMatchObject({ state, outcome: { evidence } });
    expect(task(doc, "Pip").state).toBe(state);
  }
});

type SelfVerdictCase = "pass" | "fail" | "blocked" | "none";

test("duplicate stop", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("c", { name: "Pip", type: CODER, description: "x", model: "haiku" }, 100);
  dagrActivity("c", 200, false);
  const stop = { name: "Pip", type: CODER, model: "haiku", selfVerdict: "pass" as const, reviewRequested: false };
  dagrStop("c", 300, 400, stop);
  const first = valid(500);
  dagrStop("c", 300, 600, stop);
  const second = valid(700);
  expect({ ...second, generated_at: "" }).toEqual({ ...first, generated_at: "" });
});

test("late verdict after resume", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("c", { name: "Pip", type: CODER, description: "x", model: "haiku" }, 100);
  dagrActivity("c", 200, false);
  dagrSpawn("k", { name: "Quill", type: CHECKER, description: "check", model: "haiku" }, 250);
  valid(250);
  dagrActivity("k", 260, false);
  dagrStop("c", 300, 400, { name: "Pip", type: CODER, model: "haiku", selfVerdict: "none", reviewRequested: true });
  valid(300);
  dagrBindReview("k", "Pip", 450);
  valid(450);
  dagrActivity("c", 500, false);
  let doc = valid(500);
  expect(task(doc, "Pip").attempts[0]).toMatchObject({ state: "settled_unverified", outcome: { evidence: "heuristic" } });
  expect(task(doc, "Pip").attempts[1]).toMatchObject({ state: "working" });

  dagrCheckerVerdict("k", "Pip", "pass", 600);
  doc = valid(600);
  expect(task(doc, "Pip").attempts[1]).toMatchObject({ state: "working" });
  expect(doc.events.at(-1)).toMatchObject({ type: "note" });
});

test("ambiguous verdict stays unlinked", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("a", { name: "Pip", type: CODER, description: "one", model: "haiku" }, 100);
  dagrActivity("a", 200, false);
  dagrStop("a", 300, 400, { name: "Pip", type: CODER, model: "haiku", selfVerdict: "none", reviewRequested: true });
  valid(400);
  dagrSpawn("b", { name: "Pip", type: CODER, description: "two", model: "haiku" }, 450);
  valid(450);
  dagrActivity("b", 500, false);
  dagrStop("b", 550, 600, { name: "Pip", type: CODER, model: "haiku", selfVerdict: "none", reviewRequested: true });
  valid(600);
  dagrSpawn("k", { name: "Quill", type: CHECKER, description: "check", model: "haiku" }, 650);
  valid(650);
  dagrActivity("k", 700, false);
  dagrCheckerVerdict("k", "Pip", "pass", 800);
  const doc = valid(900);
  const pips = doc.tasks.filter((t) => t.owner === "Pip");
  expect(pips.map((t) => t.state)).toEqual(["review", "review"]);
  expect(task(doc, "Quill").state).toBe("done");
});

test("inline verdict", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("c", { name: "Pip", type: CODER, description: "x", model: "haiku" }, 100);
  valid(100);
  dagrActivity("c", 200, false);
  dagrStop("c", 300, 400, { name: "Pip", type: CODER, model: "haiku", selfVerdict: "none", reviewRequested: true });
  dagrInlineVerdict("Pip", "fail", 500);
  const doc = valid(600);
  expect(task(doc, "Pip").attempts[0]).toMatchObject({ state: "rejected", outcome: { evidence: "reported" } });
  expect(doc.events.at(-1)).toMatchObject({ type: "attempt_settled", actor: "main agent" });
});

test("runtime killed", () => {
  dagrReset(SESSION, 0);
  dagrSpawn("c", { name: "Pip", type: CODER, description: "x", model: "haiku" }, 100);
  dagrActivity("c", 200, false);
  dagrLiveStatus("c", "completed", 250);
  expect(task(valid(260), "Pip").state).toBe("working");
  dagrLiveStatus("c", "killed", 300);
  const doc = valid(400);
  expect(task(doc, "Pip").attempts[0]).toMatchObject({ state: "failed", outcome: { evidence: "heuristic" } });
});

test("activity before spawn", () => {
  dagrReset(SESSION, 0);
  dagrActivity("c", 100, true);
  valid(100);
  dagrSpawn("c", { name: "Pip", type: CODER, description: "later", model: "haiku" }, 200);
  const doc = valid(300);
  expect(doc.tasks.length).toBe(1);
  expect(task(doc, "Pip").title).toBe("haiku-coder: later");
});

test("reset bumps generation", () => {
  const before = dagrGeneration();
  expect(dagrReset(SESSION, 0)).toBe(before + 1);
  expect(dagrGeneration()).toBe(before + 1);
  expect(dagrReset(SESSION, 0)).toBe(before + 2);
});
