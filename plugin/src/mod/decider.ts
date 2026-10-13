/**
 * The decider slot: asks a SystemOne-compatible endpoint (the local Clefkit server, Jev or a proxy) which model, effort,
 * review and task features an agent launch should get. Pure: the request body, the reading of the answer and the model
 * choice (policy.ts) take their I/O as injected functions, so the hooks module only passes `$.http.fetch`.
 */
import { isObject } from "./api.ts";
import type { Input } from "./api.ts";
import { inferJob } from "./infer.ts";
import type { Choice, GateSettings } from "./gate.ts";
import { bucketStats, chooseModel } from "./policy.ts";
import type { PickSource, PolicyPick, PolicyRun } from "./policy.ts";

/** The `decider` section of settings. */
export type DeciderSettings = { mode: "off" | "shadow" | "decide"; url: string; timeout_ms: number; min_confidence: number;
  explore_rate: number; target_pass: number; min_runs: number };

/** What the questions say about the task. Each field is set only when its answer is usable. */
export type Features = { size_level?: string; terminal_heavy?: boolean; has_tests?: boolean; spec_clarity_level?: string };

/** One ledger row the endpoint sees: how a model has done on a (job, lang). */
export type HistoryRow = { model: string; job: string; lang: string; runs: number; judged: number; pass_rate: number; median_tokens: number };

/** What the request is built from. */
export type DeciderInput = { prompt: string; tag: Record<string, string>; agentType: string; cwd: string; history: HistoryRow[] };

/** What the endpoint chose. Model and effort are set only when that answer was confident enough. */
export type Decision = {
  model?: string;
  effort?: string;
  review?: boolean;
  /** True when the model answer met the minimum confidence. */
  confident: boolean;
  /** The model question's probabilities, by model. */
  probs: Record<string, number>;
  features?: Features;
};

const MODELS = ["haiku", "sonnet", "opus"];
const EFFORTS = ["low", "medium", "high", "max"];
const SIZES = ["tiny", "small", "medium", "large"];
const CLARITY = ["vague", "partial", "clear", "exact"];
const PROMPT_MAX = 4000;
const HISTORY_MAX = 30;

/** The questions asked for every launch. The first three are the decider's original ones; the rest describe the task. */
const QUESTIONS = {
  model: { type: "choice", instructions: "Which is the cheapest model that will do this task well?", criteria: {"haiku": "The default. Writing or changing code toward a clear spec or goal, even across several files: implementing, refactoring, tests, fixes with a known cause, search and lookups. Haiku writes code about as well as Sonnet. Cheapest.", "sonnet": "Long terminal-driven work (environment setup, builds, CI, shell debugging with many commands), debugging with an unknown cause, an unclear spec, trade-offs between approaches, or a task Haiku already failed.", "opus": "Rare. Open-ended design with no spec at all, or a task Sonnet already failed. Hard or sensitive topics alone (concurrency, security, unsafe code) do not need Opus when the goal is clear. Most expensive."} },
  effort: { type: "score", instructions: "How much reasoning effort the task needs.", criteria: ["low: mechanical, nothing to weigh.", "medium: the normal level, enough for nearly every task, hard ones included.", "high: many interacting constraints that must all be held at once, where medium has already struggled.", "max: almost never; only when explicitly asked for."] },
  needs_review: { type: "noul", instructions: "Should another agent review the result?", criteria: {"true": "The change touches security, concurrency, data loss or a public contract, or is large.", "false": "A mistake would be cheap to see in the diff and to undo."} },
  size: { type: "score", instructions: "How large is the change the task asks for?", criteria: ["tiny: under 20 lines changed.", "small: under 100 lines.", "medium: under 400 lines.", "large: 400 lines or more."] },
  terminal_heavy: { type: "noul", instructions: "Does the task need many shell commands, builds or environment work?", criteria: {"true": "Many shell commands: builds, installs, servers, CI or other environment work.", "false": "Little shell work: mostly reading and writing files."} },
  has_tests: { type: "noul", instructions: "Does the spec name tests, or a verify command that checks the result?", criteria: {"true": "The spec names tests to write or run, or a command that checks the result.", "false": "Nothing in the spec checks the result beyond reading the diff."} },
  spec_clarity: { type: "score", instructions: "How exact is the spec?", criteria: ["vague: a goal with no detail on what to change.", "partial: a goal and some detail, with gaps left to guess.", "clear: what to change and where, with few gaps.", "exact: every file, name and expected result given."] },
};

/** The last folder name of a path: never the full path, which may hold a user name. */
function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * The POST body for `${url}/v1/systemone`. The state holds the first 4000 characters of the prompt, the tag, the agent
 * type, the session folder's name only, and at most 30 history rows, those with the most runs first.
 */
export function deciderRequest(input: DeciderInput): Record<string, unknown> {
  const history = [...input.history].sort((a, b) => b.runs - a.runs).slice(0, HISTORY_MAX);
  return {
    state: { task: input.prompt.slice(0, PROMPT_MAX), tag: input.tag, agent_type: input.agentType, cwd: baseName(input.cwd), history },
    questions: QUESTIONS,
  };
}

/** A finite number, else undefined. */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** The answer with this id from a normalised response (`answers`), or from a raw SystemOne one (the map itself). */
function answerOf(response: Record<string, unknown>, id: string): unknown {
  const answers = isObject(response.answers) ? response.answers : response;
  return answers[id];
}

/** A choice answer: its option (only a known model), confidence and probabilities. */
function readChoice(a: unknown): { choice?: string; confidence: number; probs: Record<string, number> } | null {
  if (!isObject(a)) return null;
  const probs: Record<string, number> = {};
  if (isObject(a.probabilities)) {
    for (const [k, v] of Object.entries(a.probabilities)) if (num(v) !== undefined) probs[k] = v as number;
  }
  const choice = typeof a.choice === "string" && MODELS.includes(a.choice) ? a.choice : undefined;
  return { choice, confidence: num(a.confidence) ?? 0, probs };
}

/** A score answer: the level (Clefkit's `level`, else the raw `score`) as its name in `names`, and its confidence. */
function readScore(a: unknown, names: string[]): { name?: string; confidence: number } | null {
  if (!isObject(a)) return null;
  const level = num(a.level) ?? num(a.score);
  const name = level !== undefined ? names[Math.round(level)] : undefined;
  return { name, confidence: num(a.confidence) ?? 0 };
}

/** A noul answer in any shape: a bare boolean or probability, {probability}, or {value, probability}. True when it leans true. */
function readNoul(a: unknown): boolean | undefined {
  if (typeof a === "boolean") return a;
  const p = num(a);
  if (p !== undefined) return p >= 0.5;
  if (!isObject(a)) return undefined;
  const prob = num(a.probability);
  if (prob !== undefined) return prob >= 0.5;
  return typeof a.value === "boolean" ? a.value : undefined;
}

/** The task features in a response, or undefined when none of their answers is usable. No confidence floor applies. */
function featuresOf(response: Record<string, unknown>): Features | undefined {
  const f: Features = {};
  const size = readScore(answerOf(response, "size"), SIZES)?.name;
  const clarity = readScore(answerOf(response, "spec_clarity"), CLARITY)?.name;
  const terminal = readNoul(answerOf(response, "terminal_heavy"));
  const tests = readNoul(answerOf(response, "has_tests"));
  if (size) f.size_level = size;
  if (clarity) f.spec_clarity_level = clarity;
  if (terminal !== undefined) f.terminal_heavy = terminal;
  if (tests !== undefined) f.has_tests = tests;
  return Object.keys(f).length ? f : undefined;
}

/**
 * The decision in a response, or null when nothing in it is usable. Accepts the normalised response ({answers}) and the
 * raw SystemOne answer map. Model and effort are set only when their own answer's confidence is at least minConfidence.
 */
export function readDecision(response: unknown, minConfidence: number): Decision | null {
  if (!isObject(response)) return null;
  const m = readChoice(answerOf(response, "model"));
  const s = readScore(answerOf(response, "effort"), EFFORTS);
  const review = readNoul(answerOf(response, "needs_review"));
  const features = featuresOf(response);
  if (!m?.choice && !s?.name && review === undefined && !features) return null;
  const confident = Boolean(m?.choice) && m!.confidence >= minConfidence;
  const out: Decision = { confident, probs: m?.probs ?? {} };
  if (confident) out.model = m!.choice;
  if (s?.name && s.confidence >= minConfidence) out.effort = s.name;
  if (review !== undefined) out.review = review;
  if (features) out.features = features;
  return out;
}

/** Everything runDecider needs from outside: the request, a timeout, randomness and the clock. */
export type DeciderDeps = {
  ask: (body: Record<string, unknown>) => Promise<unknown>;
  /** Resolves after the timeout. */
  wait: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
};

/** What a decider call produced: the decision and how long the call took. */
export type Outcome = { decision: Decision; latency_ms: number };

/** A decider call that gave no decision: the short reason, and how long the call took. */
export type Failure = { error: string; latency_ms: number };

/** Marks the timeout in the race, so no answer can be mistaken for it. */
const TIMED_OUT = Symbol("timed out");

/** The short reason for a thrown call: an HTTP status from the endpoint, else a fixed phrase (the error text may hold a URL). */
function failureOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  return /^http \d{3}$/.test(msg) ? msg : "request failed";
}

/**
 * Asks the endpoint. The decision, or a Failure when the call timed out, threw, or its answer had nothing usable. Either
 * way the caller keeps its normal behaviour.
 */
export async function runDecider(deps: DeciderDeps, cfg: DeciderSettings, input: DeciderInput): Promise<Outcome | Failure> {
  const start = deps.now();
  const elapsed = () => Math.max(0, deps.now() - start);
  try {
    const timeout = deps.wait(cfg.timeout_ms).then(() => TIMED_OUT);
    const answer = await Promise.race([deps.ask(deciderRequest(input)), timeout]);
    if (answer === TIMED_OUT) return { error: "timeout", latency_ms: elapsed() };
    const decision = readDecision(answer, cfg.min_confidence);
    if (!decision) return { error: "invalid response", latency_ms: elapsed() };
    return { decision, latency_ms: elapsed() };
  } catch (err) {
    return { error: failureOf(err), latency_ms: elapsed() };
  }
}

/** The four task features as the ledger keeps them: always all present, and null where the backend gave no answer. */
export type RecordFeatures = {
  size_level: string | null; spec_clarity_level: string | null; terminal_heavy: boolean | null; has_tests: boolean | null;
};

/** The task features with every key set. An unanswered level or flag is null, so it never reads as false or as a level. */
export function recordFeatures(f: Features | undefined): RecordFeatures {
  return {
    size_level: f?.size_level ?? null, spec_clarity_level: f?.spec_clarity_level ?? null,
    terminal_heavy: f?.terminal_heavy ?? null, has_tests: f?.has_tests ?? null,
  };
}

/** What the ledger keeps of one decision. `explored` in shadow mode means "would have explored". */
export type DecisionRecord = {
  mode: string; model: string; effort: string; review: boolean | null; confident: boolean; explored: boolean;
  latency_ms: number; p_model: Record<string, number>;
  /** What the questions said about the task, which picked the bucket the ledger was read from. */
  features: RecordFeatures;
  /** Whether the model came from the ledger's bucket record, the decider's confident pick, or the gate's default. */
  source: PickSource;
  reason: string;
  /** Set when the decider call failed (timeout, http 500, invalid response, ...). A failed record has no pick. */
  error?: string;
};

/**
 * Applies a decider outcome and the policy's pick to a spawn the gate would give its default model (no named model, no
 * rule). Shadow changes nothing; decide sets the picked model and the effort, an Opus pick becoming Sonnet unless
 * allowed. Returns the choice to use and the record to keep.
 */
export function applyOutcome(cfg: DeciderSettings, gateCfg: GateSettings, choice: Choice, o: Outcome, pick: PolicyPick): { choice: Choice; record: DecisionRecord } {
  const d = o.decision;
  let model = pick.model ?? "";
  if (model === "opus" && !gateCfg.allow_opus) model = "sonnet";
  const record: DecisionRecord = {
    mode: cfg.mode, model, effort: d.effort ?? "", review: d.review ?? null, confident: d.confident,
    explored: pick.explored, latency_ms: o.latency_ms, p_model: d.probs,
    features: recordFeatures(d.features), source: pick.source, reason: pick.reason,
  };
  if (cfg.mode !== "decide") return { choice, record };
  const next: Choice = { ...choice };
  if (model) next.model = model;
  if (d.effort) next.effort = d.effort;
  return { choice: next, record };
}

/** Whether the gate fell back to its default model for this spawn: a model, no rule, none named by the caller. */
export function undecided(choice: Choice, e: Input): boolean {
  return Boolean(choice.model) && !choice.rule && !choice.deny && !e.model;
}

/** The record of a decider call that failed: the usual shape with no pick, so the spawn keeps the gate's default. */
function failedRecord(cfg: DeciderSettings, f: Failure): DecisionRecord {
  return {
    mode: cfg.mode, model: "", effort: "", review: null, confident: false, explored: false, latency_ms: f.latency_ms,
    p_model: {}, features: recordFeatures(undefined), source: "default", reason: `decider failed: ${f.error}`, error: f.error,
  };
}

/**
 * Asks the endpoint for a spawn that the gate left to its default, picks the model (policy.ts, from the answer and the
 * ledger's runs in the answer's bucket) and applies it. Null when the gate's default stands without a question (mode
 * off, a named model, a rule). A failed call gives the choice unchanged and a record with `error` set. The bucket's job
 * and lang are the launch's tags, else the job the ledger would infer for it.
 */
export async function decideSpawn(
  deps: DeciderDeps, cfg: DeciderSettings, gateCfg: GateSettings, e: Input, choice: Choice, cwd: string, history: HistoryRow[],
  tag: Record<string, string>, runs: PolicyRun[],
): Promise<{ choice: Choice; record: DecisionRecord } | null> {
  if (cfg.mode === "off" || !gateCfg.enabled || !undecided(choice, e)) return null;
  const prompt = String(e.prompt ?? "");
  const agentType = String(e.subagentType ?? "");
  const outcome = await runDecider(deps, cfg, { prompt, tag, agentType, cwd, history });
  if ("error" in outcome) return { choice, record: failedRecord(cfg, outcome) };
  const bucket = {
    job: tag.job || inferJob(prompt, agentType), lang: tag.lang || "unknown", size: outcome.decision.features?.size_level || "?",
  };
  const pick = chooseModel({ clef: outcome.decision, bucketStats: bucketStats(runs, bucket), explore: deps.random(), cfg });
  return applyOutcome(cfg, gateCfg, choice, outcome, pick);
}

const decided = new Map<string, DecisionRecord>();

/** Remembers the decision made for a launched agent until it stops. */
export function noteDecision(agentId: string, record: DecisionRecord): void {
  decided.set(agentId, record);
}

/** The agent's decision record, if it had one, without forgetting it (a resumed agent stops again). */
export function decisionFor(agentId: string): DecisionRecord | undefined {
  return decided.get(agentId);
}

/** True when the agent really ran a cheaper model than the decider's pick (decide mode only). */
export function wasExplored(agentId: string): boolean {
  const r = decided.get(agentId);
  return r !== undefined && r.mode === "decide" && r.explored;
}

/**
 * History rows from the ledger's per-(model, job, lang) stats.
 * ponytail: the ledger keeps token means, not medians, so median_tokens is the mean in and out; upgrade path: store a median.
 */
export function historyFrom(rows: Record<string, string | number>[]): HistoryRow[] {
  return rows.map((r) => ({
    model: String(r.model), job: String(r.job), lang: String(r.lang), runs: Number(r.n), judged: Number(r.judged),
    pass_rate: Math.round(Number(r.pass_rate) * 100) / 100, median_tokens: Math.round(Number(r.tokens_in_mean) + Number(r.tokens_out_mean)),
  }));
}
