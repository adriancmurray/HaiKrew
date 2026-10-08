/** Selector checks: globs match a folder or its ancestors, terms combine with "+", rules and instructions parse. */
import { expect, test } from "claude-code/testing";
import { ctxFrom, globMatch, instructionsFor, parseRule, selectorMatch, tag, withInstructions } from "../../src/mod/select.ts";
import type { SelectCtx } from "../../src/mod/select.ts";

const HOME_CWD = "/Users/adrian/work/app/src";

/** A context with the given fields and empty defaults. */
function ctx(over: Partial<SelectCtx>): SelectCtx {
  return { job: "", lang: "", type: "", desc: "", cwd: HOME_CWD, ...over };
}

test("globMatch expands ~ to the home folder and matches a folder or its ancestors", () => {
  expect(globMatch("~/work/*", HOME_CWD)).toBe(true);
  expect(globMatch("~/work/app", HOME_CWD)).toBe(true);
  expect(globMatch("~/work/src", HOME_CWD)).toBe(false);
  expect(globMatch("~/work/app", "/Users/adrian/work/app")).toBe(true);
  expect(globMatch("/Users/adrian/work/**", HOME_CWD)).toBe(true);
});

test("globMatch: * stays within one folder, and ? is one character", () => {
  expect(globMatch("/Users/adrian/*", HOME_CWD)).toBe(true);
  expect(globMatch("/Users/*", "/Users/adrian")).toBe(true);
  expect(globMatch("/Users/adrian/*", "/Users/adrian")).toBe(false);
  expect(globMatch("/Users/adria?", "/Users/adrian")).toBe(true);
  expect(globMatch("/Users/adri?", "/Users/adrian")).toBe(false);
});

test("globMatch never matches a ~ glob when the folder has no home", () => {
  expect(globMatch("~/work/*", "/plugins/haikrew")).toBe(false);
  expect(globMatch("~", "/plugins/haikrew")).toBe(false);
});

test("selectorMatch requires every + term to match", () => {
  const task = ctx({ job: "review", lang: "ts" });
  expect(selectorMatch("job:review+lang:ts", task)).toBe(true);
  expect(selectorMatch("job:review+lang:swift", task)).toBe(false);
  expect(selectorMatch("job:review", task)).toBe(true);
  expect(selectorMatch("cwd:~/work/*", ctx({ cwd: HOME_CWD }))).toBe(true);
  expect(selectorMatch("cwd:~/work/*+type:Explore", ctx({ cwd: HOME_CWD, type: "general" }))).toBe(false);
});

test("termMatch: desc is a case-insensitive substring, type is exact", () => {
  expect(selectorMatch("desc:migration plan", ctx({ desc: "write the migration plan" }))).toBe(true);
  expect(selectorMatch("type:Explore", ctx({ type: "explore" }))).toBe(false);
});

test("parseRule splits at the last = and reads an optional @effort", () => {
  expect(parseRule("job:review=sonnet")).toEqual({ selector: "job:review", model: "sonnet" });
  expect(parseRule("job:review=sonnet@high")).toEqual({ selector: "job:review", model: "sonnet", effort: "high" });
  expect(parseRule("cwd:~/a=b/*=haiku")).toEqual({ selector: "cwd:~/a=b/*", model: "haiku" });
});

test("ctxFrom reads the job, lang, type and lowercased description", () => {
  const e = { prompt: "HAIKREW job=review lang=ts\nbody", subagentType: "Explore", description: "Check It" };
  expect(ctxFrom(e, HOME_CWD)).toEqual({ job: "review", lang: "ts", type: "Explore", desc: "check it", cwd: HOME_CWD });
  expect(tag("not a header\nHAIKREW job=review", "job")).toBe("");
});

test("instructionsFor returns matching texts in order, split at the first ': '", () => {
  const entries = ["job:review: Cite file:line.", "lang:swift: Use async.", "job:review+lang:ts: Run bun test."];
  expect(instructionsFor(entries, ctx({ job: "review", lang: "ts" })))
    .toEqual(["Cite file:line.", "Run bun test."]);
});

test("withInstructions appends the texts exactly, or leaves the prompt unchanged", () => {
  expect(withInstructions("do it", [])).toBe("do it");
  expect(withInstructions("do it", ["A.", "B."])).toBe("do it\n\nInstructions from HaiKrew settings:\n- A.\n- B.");
});
