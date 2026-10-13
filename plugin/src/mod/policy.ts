/**
 * Model choice for a decider launch. The ledger's record of the launch's bucket (job, lang and the decider's size level)
 * decides once one model in it has enough judged runs and some model clears the target pass rate. Otherwise the decider's
 * confident pick stands, and otherwise the gate's default is kept. A choice above Haiku is sometimes run one model cheaper
 * instead, so the ledger learns what that model can do. Pure: the exploration draw is an input.
 */

/** The models, cheapest first. */
const MODELS = ["haiku", "sonnet", "opus"];

// Clef's pick is explored one model down only when Clef gives that model at least this probability: less is not worth a run.
const CLEF_EXPLORE_MIN_PROB = 0.25;

/** Where the chosen model came from: the ledger's record of the bucket, the decider's confident pick, or the gate's default. */
export type PickSource = "data" | "clef" | "default";

/** A model's record in one bucket. `late_fails` counts passes that were later found to be failures. */
export type BucketStat = { model: string; runs: number; judged: number; passes: number; late_fails: number };

/** The fields of a ledger run the policy reads. Every ledger run has them. */
export type PolicyRun = {
  model: string; job: string; lang: string; verdict: string; late_fail?: number;
  decision?: { features?: { size_level?: string } };
};

/** The bucket a launch falls in. */
export type Bucket = { job: string; lang: string; size: string };

/** The policy's settings. target_pass defaults to 0.8 and min_runs to 8. */
export type PolicyCfg = { target_pass?: number; min_runs?: number; explore_rate: number };

/** What chooseModel picked. `model` is null when the gate's default stands. */
export type PolicyPick = { model: string | null; source: PickSource; explored: boolean; reason: string };

/** `clef` is the decider's answer: its model is set only when the answer was confident, and `probs` are its model probabilities. */
export type PolicyInput = { clef: { model?: string; probs?: Record<string, number> } | null; bucketStats: BucketStat[]; explore: number; cfg: PolicyCfg };

/** The smoothed success rate of a model in a bucket: (passes - late_fails + 1) / (judged + 2). */
export function successRate(s: BucketStat): number {
  return (s.passes - s.late_fails + 1) / (s.judged + 2);
}

/** The next cheaper model, or null for haiku and for a model the policy does not know. */
function cheaper(model: string): string | null {
  const i = MODELS.indexOf(model);
  return i > 0 ? MODELS[i - 1] : null;
}

/**
 * The cheapest model whose smoothed rate reaches the target, but only once some model in the bucket has minRuns judged
 * runs. Null when there is not enough data or no model reaches the target.
 */
function fromData(stats: BucketStat[], target: number, minRuns: number): { model: string; reason: string } | null {
  if (!stats.some((s) => s.judged >= minRuns)) return null;
  for (const model of MODELS) {
    const s = stats.find((x) => x.model === model);
    if (!s) continue;
    const rate = successRate(s);
    if (rate >= target) return { model, reason: `${model} smoothed pass rate ${rate.toFixed(2)} over ${s.judged} judged runs` };
  }
  return null;
}

/**
 * The model to launch with: the ledger's pick, else Clef's confident pick, else null (the gate's default). When the
 * pick is above Haiku and `explore` is below explore_rate, the next cheaper model is picked and marked explored. A
 * Clef pick explores only when Clef gives the cheaper model at least CLEF_EXPLORE_MIN_PROB; a ledger pick always may.
 */
export function chooseModel(input: PolicyInput): PolicyPick {
  const target = input.cfg.target_pass ?? 0.8;
  const minRuns = input.cfg.min_runs ?? 8;
  const data = fromData(input.bucketStats, target, minRuns);
  const clef = input.clef?.model;
  let picked: { model: string; source: PickSource; reason: string };
  if (data) picked = { model: data.model, source: "data", reason: data.reason };
  else if (clef) picked = { model: clef, source: "clef", reason: `Clef's confident pick ${clef}` };
  else return { model: null, source: "default", explored: false, reason: "no ledger pick and no confident pick" };
  const lower = cheaper(picked.model);
  const plausible = picked.source === "data" || (lower !== null && (input.clef?.probs?.[lower] ?? 0) >= CLEF_EXPLORE_MIN_PROB);
  if (lower && plausible && input.explore < input.cfg.explore_rate) {
    return { model: lower, source: picked.source, explored: true, reason: `${picked.reason}; exploring ${lower}` };
  }
  return { model: picked.model, source: picked.source, explored: false, reason: picked.reason };
}

/**
 * The per-model record of the runs in one bucket. A run with no size level counts as size "?". late_fail is read where
 * the run carries it, else taken as 0. Runs in other buckets are left out.
 */
export function bucketStats(runs: PolicyRun[], bucket: Bucket): BucketStat[] {
  const byModel = new Map<string, BucketStat>();
  for (const r of runs) {
    if (r.job !== bucket.job || r.lang !== bucket.lang || (r.decision?.features?.size_level ?? "?") !== bucket.size) continue;
    const s = byModel.get(r.model) ?? { model: r.model, runs: 0, judged: 0, passes: 0, late_fails: 0 };
    s.runs += 1;
    if (r.verdict === "pass" || r.verdict === "fail") s.judged += 1;
    if (r.verdict === "pass") s.passes += 1;
    s.late_fails += r.late_fail ?? 0;
    byModel.set(r.model, s);
  }
  return [...byModel.values()];
}
