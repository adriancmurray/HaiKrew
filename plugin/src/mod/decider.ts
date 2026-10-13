/**
 * The decider slot: asks a SystemOne-compatible endpoint (the local Clefkit server, Jev or a proxy) which model, effort
 * and review an agent launch should get. Pure: the request body, the reading of the answer and the choice (including
 * exploration of cheaper models) take their I/O as injected functions, so the hooks module only passes `$.http.fetch`.
 */
import { isObject } from "./api.ts";
import type { Input } from "./api.ts";
import type { Choice, GateSettings } from "./gate.ts";

/** The `decider` section of settings. */
export type DeciderSettings = { mode: "off" | "shadow" | "decide"; url: string; timeout_ms: number; min_confidence: number; explore_rate: number };

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
};

const MODELS = ["haiku", "sonnet", "opus"];
const EFFORTS = ["low", "medium", "high", "max"];
const PROMPT_MAX = 4000;
const HISTORY_MAX = 30;

/** The questions asked for every launch. */
const QUESTIONS = {
  model: { type: "choice", instructions: "Pick the cheapest model likely to do this task well.", criteria: {
    haiku: "A tightly specified, mechanical task: a clear edit, rename, small module or test from a list, or a lookup. Cheapest.",
    sonnet: "Ordinary implementation or review that needs judgement across several files, or a task where haiku's record is poor.",
    opus: "Design, ambiguous or security- or concurrency-sensitive work, or a hard debugging task. Most expensive.",
  } },
  effort: { type: "score", instructions: "How much reasoning effort the task needs.", criteria: [
    "low: trivial and mechanical", "medium: a normal task with a clear spec", "high: several interacting parts or subtle edge cases",
    "max: a hard problem where failure is costly",
  ] },
  needs_review: { type: "noul", instructions: "Should another agent review the result?", criteria: {
    true: "The change is large, touches sensitive code, or the chosen model has a weak record on this kind of task.",
    false: "A small, mechanical change that is easy to check by glancing at the diff.",
  } },
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

/** A score answer: the level (Clefkit's `level`, else the raw `score`) as an effort name, and its confidence. */
function readScore(a: unknown): { effort?: string; confidence: number } | null {
  if (!isObject(a)) return null;
  const level = num(a.level) ?? num(a.score);
  const effort = level !== undefined ? EFFORTS[Math.round(level)] : undefined;
  return { effort, confidence: num(a.confidence) ?? 0 };
}

/** A noul answer in any shape: a bare probability, {probability}, or {value, probability}. True when it leans true. */
function readNoul(a: unknown): boolean | undefined {
  const p = num(a);
  if (p !== undefined) return p >= 0.5;
  if (!isObject(a)) return undefined;
  const prob = num(a.probability);
  if (prob !== undefined) return prob >= 0.5;
  return typeof a.value === "boolean" ? a.value : undefined;
}

/**
 * The decision in a response, or null when nothing in it is usable. Accepts the normalised response ({answers}) and the
 * raw SystemOne answer map. Model and effort are set only when their own answer's confidence is at least minConfidence.
 */
export function readDecision(response: unknown, minConfidence: number): Decision | null {
  if (!isObject(response)) return null;
  const m = readChoice(answerOf(response, "model"));
  const s = readScore(answerOf(response, "effort"));
  const review = readNoul(answerOf(response, "needs_review"));
  if (!m?.choice && !s?.effort && review === undefined) return null;
  const confident = Boolean(m?.choice) && m!.confidence >= minConfidence;
  const out: Decision = { confident, probs: m?.probs ?? {} };
  if (confident) out.model = m!.choice;
  if (s?.effort && s.confidence >= minConfidence) out.effort = s.effort;
  if (review !== undefined) out.review = review;
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

/** What a decider call produced: the decision, the cheaper model to try instead (when exploring) and how long it took. */
export type Outcome = { decision: Decision; explore: string | null; latency_ms: number };

/** The next cheaper model, or null for haiku. */
function cheaper(model: string): string | null {
  const i = MODELS.indexOf(model);
  return i > 0 ? MODELS[i - 1] : null;
}

/**
 * Asks the endpoint. Null on an error, a timeout or an unusable answer (the caller keeps its normal behaviour).
 * Exploration: the confident model is above haiku, random() is below explore_rate, and the next cheaper model has
 * probability at least 0.25.
 */
export async function runDecider(deps: DeciderDeps, cfg: DeciderSettings, input: DeciderInput): Promise<Outcome | null> {
  const start = deps.now();
  try {
    const timeout = deps.wait(cfg.timeout_ms).then(() => "timeout" as const);
    const answer = await Promise.race([deps.ask(deciderRequest(input)), timeout]);
    if (answer === "timeout") return null;
    const decision = readDecision(answer, cfg.min_confidence);
    if (!decision) return null;
    const lower = decision.model ? cheaper(decision.model) : null;
    const explore = lower && deps.random() < cfg.explore_rate && (decision.probs[lower] ?? 0) >= 0.25 ? lower : null;
    return { decision, explore, latency_ms: Math.max(0, deps.now() - start) };
  } catch {
    return null;
  }
}

/** What the ledger keeps of one decision. `explored` in shadow mode means "would have explored". */
export type DecisionRecord = {
  mode: string; model: string; effort: string; review: boolean | null; confident: boolean; explored: boolean;
  latency_ms: number; p_model: Record<string, number>;
};

/**
 * Applies a decider outcome to a spawn the gate would give its default model (no named model, no rule). Shadow changes
 * nothing; decide sets the confident model (the cheaper one when exploring) and effort, an Opus pick becoming Sonnet
 * unless allowed. Returns the choice to use and the record to keep.
 */
export function applyOutcome(cfg: DeciderSettings, gateCfg: GateSettings, choice: Choice, o: Outcome): { choice: Choice; record: DecisionRecord } {
  const d = o.decision;
  let model = o.explore ?? d.model ?? "";
  if (model === "opus" && !gateCfg.allow_opus) model = "sonnet";
  const record: DecisionRecord = {
    mode: cfg.mode, model, effort: d.effort ?? "", review: d.review ?? null, confident: d.confident,
    explored: o.explore !== null, latency_ms: o.latency_ms, p_model: d.probs,
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

/** Asks the endpoint for a spawn that the gate left to its default, and applies the answer. Null when nothing applies. */
export async function decideSpawn(
  deps: DeciderDeps, cfg: DeciderSettings, gateCfg: GateSettings, e: Input, choice: Choice, cwd: string, history: HistoryRow[], tag: Record<string, string>,
): Promise<{ choice: Choice; record: DecisionRecord } | null> {
  if (cfg.mode === "off" || !gateCfg.enabled || !undecided(choice, e)) return null;
  const outcome = await runDecider(deps, cfg, { prompt: String(e.prompt ?? ""), tag, agentType: String(e.subagentType ?? ""), cwd, history });
  return outcome ? applyOutcome(cfg, gateCfg, choice, outcome) : null;
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
