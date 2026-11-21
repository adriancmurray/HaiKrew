/** dagr-check tests: a valid base run, one mutation per rule, and the herdr-swarm dagr producer examples. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkRun } from "../plugin/src/dagr-check.ts";

const EXAMPLES = join(homedir(), "repos", "herdr-swarm", "skills", "dagr-producer", "examples");

/** A valid run: one done task with one attempt, and one queued task that depends on it. */
function base(): any {
  return {
    dagr: 3,
    run: { id: "run-1", title: "test run", started_at: "2026-11-13T09:00:00Z" },
    generated_at: "2026-11-13T09:10:00Z",
    projects: [],
    tasks: [
      {
        id: "a-1",
        title: "impl",
        kind: "impl",
        state: "done",
        deps: [],
        attempts: [
          {
            id: "a-1·a1",
            n: 1,
            cause: { type: "initial" },
            state: "done",
            started_at: "2026-11-13T09:01:00Z",
            ended_at: "2026-11-13T09:05:00Z",
            outcome: { result: "done", evidence: "reported" },
          },
        ],
      },
      { id: "a-2", title: "review", kind: "review", state: "queued", deps: ["a-1"], attempts: [] },
    ],
    events: [
      { at: "2026-11-13T09:01:00Z", type: "attempt_started", task: "a-1", attempt: "a-1·a1" },
      { at: "2026-11-13T09:05:00Z", type: "attempt_settled", task: "a-1", attempt: "a-1·a1" },
    ],
  };
}

/** A deep copy of the base run with one mutation applied. */
function mutate(fn: (doc: any) => void): unknown {
  const doc = base();
  fn(doc);
  return doc;
}

/** Asserts a finding that starts with the given JSON path. */
function assertFinding(doc: unknown, path: string): void {
  const findings = checkRun(doc);
  assert.ok(findings.length >= 1, "expected at least one finding");
  assert.ok(
    findings.some((f) => f.startsWith(`${path}: `)),
    `no finding at ${path}: ${findings.join(" | ")}`,
  );
}

/** Removes every `locator` key, and the `run.orchestrator` field, in place. */
function stripHerdr(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(stripHerdr);
  } else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "locator") delete record[key];
      else stripHerdr(record[key]);
    }
  }
}

function loadExample(name: string): unknown {
  const doc = JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
  stripHerdr(doc);
  delete doc.run?.orchestrator;
  return doc;
}

describe("checkRun", () => {
  it("accepts the base document", () => {
    assert.deepEqual(checkRun(base()), []);
  });

  it("accepts the send-back example", (t) => {
    if (!existsSync(EXAMPLES)) return t.skip("dagr examples not found");
    assert.deepEqual(checkRun(loadExample("03-send-back.json")), []);
  });

  // HaiKrew never emits evidence "verified", so example 06's findings must all be about it.
  it("reports only verified evidence in the evidence-tiers example", (t) => {
    if (!existsSync(EXAMPLES)) return t.skip("dagr examples not found");
    const findings = checkRun(loadExample("06-evidence-tiers.json"));
    assert.ok(findings.length >= 1, "expected verified findings");
    assert.ok(findings.every((f) => f.includes("verified")), findings.join(" | "));
  });

  it("accepts review task with ended working attempt", () => {
    const doc = mutate((d) => {
      d.tasks[1].state = "review";
      d.tasks[1].attempts = [
        {
          id: "a-2·a1",
          n: 1,
          cause: { type: "initial" },
          state: "working",
          started_at: "2026-11-13T09:06:00Z",
          ended_at: "2026-11-13T09:07:00Z",
          liveness: { prompt_acknowledged: true, queued_input: 0 },
        },
      ];
    });
    assert.deepEqual(checkRun(doc), []);
  });

  it("rejects verified evidence", () => {
    const doc = mutate((d) => {
      d.tasks[0].attempts[0].outcome.evidence = "verified";
    });
    assertFinding(doc, "tasks[0].attempts[0].outcome.evidence");
  });

  it("rejects a non-object document", () => {
    assertFinding("nope", "$");
  });

  it("requires dagr 3", () => {
    assertFinding(mutate((d) => (d.dagr = 2)), "dagr");
  });

  it("requires run.title", () => {
    assertFinding(mutate((d) => delete d.run.title), "run.title");
  });

  it("requires an ISO generated_at", () => {
    assertFinding(mutate((d) => (d.generated_at = "10 am")), "generated_at");
  });

  it("requires projects to be an array", () => {
    assertFinding(mutate((d) => (d.projects = {})), "projects");
  });

  it("requires tasks to be an array", () => {
    assertFinding(mutate((d) => (d.tasks = {})), "tasks");
  });

  it("requires unique task ids", () => {
    assertFinding(mutate((d) => (d.tasks[1].id = "a-1")), "tasks[1].id");
  });

  it("requires attempt ids disjoint from task ids", () => {
    assertFinding(mutate((d) => (d.tasks[0].attempts[0].id = "a-2")), "tasks[0].attempts[0].id");
  });

  it("requires unique attempt ids", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[1].state = "working";
        d.tasks[1].attempts = [
          {
            id: "a-1·a1",
            n: 1,
            cause: { type: "initial" },
            state: "working",
            started_at: "2026-11-13T09:06:00Z",
            liveness: { prompt_acknowledged: false, queued_input: 0 },
          },
        ];
      }),
      "tasks[1].attempts[0].id",
    );
  });

  it("rejects an unknown task state", () => {
    assertFinding(mutate((d) => (d.tasks[0].state = "paused")), "tasks[0].state");
  });

  it("requires a non-empty kind", () => {
    assertFinding(mutate((d) => (d.tasks[0].kind = "")), "tasks[0].kind");
  });

  it("requires deps to name existing tasks", () => {
    assertFinding(mutate((d) => (d.tasks[1].deps = ["a-9"])), "tasks[1].deps");
  });

  it("rejects a self dependency", () => {
    assertFinding(mutate((d) => (d.tasks[1].deps = ["a-2"])), "tasks[1].deps");
  });

  it("rejects a dependency cycle", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[0].deps = ["a-2"];
      }),
      "tasks[1].deps",
    );
  });

  it("requires attempt n to be the 1-based position", () => {
    assertFinding(mutate((d) => (d.tasks[0].attempts[0].n = 2)), "tasks[0].attempts[0].n");
  });

  it("requires the first attempt cause to be initial", () => {
    assertFinding(
      mutate((d) => (d.tasks[0].attempts[0].cause = { type: "followup", ref: "a-1·a1" })),
      "tasks[0].attempts[0].cause.type",
    );
  });

  it("requires later attempts to have a non-initial cause", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[0].attempts.push({
          id: "a-1·a2",
          n: 2,
          cause: { type: "initial" },
          state: "done",
          started_at: "2026-11-13T09:06:00Z",
          ended_at: "2026-11-13T09:07:00Z",
          outcome: { result: "done", evidence: "reported" },
        });
      }),
      "tasks[0].attempts[1].cause.type",
    );
  });

  it("requires a cause ref that names a declared attempt", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[0].attempts.push({
          id: "a-1·a2",
          n: 2,
          cause: { type: "sent_back", ref: "missing" },
          state: "done",
          started_at: "2026-11-13T09:06:00Z",
          ended_at: "2026-11-13T09:07:00Z",
          outcome: { result: "done", evidence: "reported" },
        });
      }),
      "tasks[0].attempts[1].cause.ref",
    );
  });

  it("requires a cause ref to name an earlier attempt", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[0].attempts.push({
          id: "a-1·a2",
          n: 2,
          cause: { type: "followup", ref: "a-1·a2" },
          state: "done",
          started_at: "2026-11-13T09:06:00Z",
          ended_at: "2026-11-13T09:07:00Z",
          outcome: { result: "done", evidence: "reported" },
        });
      }),
      "tasks[0].attempts[1].cause.ref",
    );
  });

  it("rejects an unknown attempt state", () => {
    assertFinding(mutate((d) => (d.tasks[0].attempts[0].state = "stopped")), "tasks[0].attempts[0].state");
  });

  it("requires a terminal outcome.result that equals the state", () => {
    assertFinding(
      mutate((d) => (d.tasks[0].attempts[0].outcome.result = "failed")),
      "tasks[0].attempts[0].outcome.result",
    );
  });

  it("requires ended_at on a terminal attempt", () => {
    assertFinding(mutate((d) => delete d.tasks[0].attempts[0].ended_at), "tasks[0].attempts[0].ended_at");
  });

  it("requires ended_at not before started_at", () => {
    assertFinding(
      mutate((d) => (d.tasks[0].attempts[0].ended_at = "2026-11-13T08:59:00Z")),
      "tasks[0].attempts[0].ended_at",
    );
  });

  it("requires liveness on a working attempt", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[1].state = "working";
        d.tasks[1].attempts = [
          { id: "a-2·a1", n: 1, cause: { type: "initial" }, state: "working", started_at: "2026-11-13T09:06:00Z" },
        ];
      }),
      "tasks[1].attempts[0].liveness",
    );
  });

  it("requires queued_input to be a number", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[1].state = "working";
        d.tasks[1].attempts = [
          {
            id: "a-2·a1",
            n: 1,
            cause: { type: "initial" },
            state: "working",
            started_at: "2026-11-13T09:06:00Z",
            liveness: { prompt_acknowledged: true, queued_input: "two" },
          },
        ];
      }),
      "tasks[1].attempts[0].liveness.queued_input",
    );
  });

  it("requires last_output_at to be ISO when present", () => {
    assertFinding(
      mutate((d) => {
        d.tasks[1].state = "working";
        d.tasks[1].attempts = [
          {
            id: "a-2·a1",
            n: 1,
            cause: { type: "initial" },
            state: "working",
            started_at: "2026-11-13T09:06:00Z",
            liveness: { prompt_acknowledged: true, queued_input: 0, last_output_at: "recently" },
          },
        ];
      }),
      "tasks[1].attempts[0].liveness.last_output_at",
    );
  });

  it("requires a working task to have a working latest attempt", () => {
    assertFinding(mutate((d) => (d.tasks[0].state = "working")), "tasks[0].state");
  });

  it("requires a done task to match its latest attempt", () => {
    assertFinding(mutate((d) => (d.tasks[0].state = "rejected")), "tasks[0].state");
  });

  it("requires a failed task to have a failed or lost latest attempt", () => {
    assertFinding(mutate((d) => (d.tasks[0].state = "failed")), "tasks[0].state");
  });

  it("requires a review task to have at least one attempt", () => {
    assertFinding(mutate((d) => (d.tasks[1].state = "review")), "tasks[1].state");
  });

  it("requires a queued task to have a non-settled latest attempt", () => {
    assertFinding(mutate((d) => (d.tasks[0].state = "queued")), "tasks[0].state");
  });

  it("requires ISO event timestamps in non-decreasing order", () => {
    assertFinding(mutate((d) => (d.events[1].at = "2026-11-13T09:00:30Z")), "events[1].at");
  });

  it("rejects an unknown event type", () => {
    assertFinding(mutate((d) => (d.events[0].type = "moved")), "events[0].type");
  });

  it("requires an event task to exist", () => {
    assertFinding(mutate((d) => (d.events[0].task = "ghost")), "events[0].task");
  });

  it("requires a non-empty task title", () => {
    assertFinding(mutate((d) => (d.tasks[0].title = "")), "tasks[0]");
  });

  it("requires a task on a promoted event", () => {
    assertFinding(
      mutate((d) => {
        d.events.push({ at: "2026-11-13T09:06:00Z", type: "promoted" });
      }),
      "events[2].task",
    );
  });

  it("requires an attempt on an attempt_started event", () => {
    assertFinding(
      mutate((d) => {
        d.events[0].attempt = undefined;
      }),
      "events[0].attempt",
    );
  });

  it("requires an event attempt to exist", () => {
    assertFinding(mutate((d) => (d.events[0].attempt = "ghost·a1")), "events[0].attempt");
  });
});
