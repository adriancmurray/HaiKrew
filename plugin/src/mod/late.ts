/**
 * Late failures: a run that passed but whose files a later commit in the same repo fixed, reverted or called a regression.
 * A mod can start processes ($.process.run), so the mod runs `git` itself: at recordStop the run gets its repo root and
 * repo-relative paths, and at session start one `git log --since` per repo is matched against the recent passed runs.
 * Everything but the git calls is pure: log text in, runs out.
 */
import type { Run } from "./ledger.ts";

/** What a run stores for the check; absent on runs recorded before this existed. */
export type LateFields = { repo?: string; files?: string[]; late_fail?: boolean; late_fail_commit?: string };

export type Commit = { hash: string; ts: number; subject: string; files: string[] };

/** Starts a process and returns its output (empty on failure); the mod's $.process.run behind it. */
export type RunGit = (argv: string[], cwd: string) => Promise<string>;

const FIX_RE = /\b(fix|revert|bug|broke|regress)/i;
const DAY_MS = 86_400_000;
const SEP = "\x01";
/** `git log` arguments: one header line per commit (marker, hash, unix time, subject), then its files. */
export const logArgs = (sinceMs: number): string[] =>
  ["git", "log", `--since=${Math.floor(sinceMs / 1000)}`, "--name-only", "--no-merges", `--format=${SEP}%H${SEP}%ct${SEP}%s`];

/** Commits from `git log` output made with logArgs. */
export function parseLog(text: string): Commit[] {
  const out: Commit[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(SEP)) {
      const [, hash, ct, ...subject] = line.split(SEP);
      out.push({ hash, ts: Number(ct) * 1000, subject: subject.join(SEP), files: [] });
    } else if (line && out.length) out[out.length - 1].files.push(line);
  }
  return out;
}

/** The first commit within `days` after the run that touches one of its files and reads as a fix or revert; else undefined. */
export function lateCommit(run: LateFields & { ts: string }, commits: Commit[], days: number): Commit | undefined {
  const start = Date.parse(run.ts);
  const files = new Set(run.files ?? []);
  return commits
    .filter((c) => c.ts > start && c.ts <= start + days * DAY_MS && FIX_RE.test(c.subject) && c.files.some((f) => files.has(f)))
    .sort((a, b) => a.ts - b.ts)[0];
}

/** Passed runs from the last `days` days that carry a repo and files and are not flagged yet. */
export function candidates(runs: Run[], now: number, days: number): Run[] {
  return runs.filter((r) => r.verdict === "pass" && r.repo && r.files?.length && !r.late_fail && now - Date.parse(r.ts) <= days * DAY_MS);
}

/** `runs` with late failures flagged; `changed` is false when nothing was. One git log per repo. */
export async function flagLate(runs: Run[], now: number, days: number, git: RunGit): Promise<{ runs: Run[]; changed: boolean }> {
  const hits = new Map<Run, string>();
  const byRepo = Map.groupBy(candidates(runs, now, days), (r) => r.repo as string);
  for (const [repo, list] of byRepo) {
    const since = Math.min(...list.map((r) => Date.parse(r.ts)));
    const commits = parseLog(await git(logArgs(since), repo));
    for (const r of list) {
      const hit = lateCommit(r, commits, days);
      if (hit) hits.set(r, hit.hash);
    }
  }
  return { changed: hits.size > 0, runs: runs.map((r) => (hits.has(r) ? { ...r, late_fail: true, late_fail_commit: hits.get(r) } : r)) };
}

/** The repo root and repo-relative paths for absolute changed `paths`; {} when they are not in one git repo. */
export async function repoOf(paths: string[], git: RunGit): Promise<LateFields> {
  const abs = paths.filter((p) => p.startsWith("/"));
  if (!abs.length) return {};
  const root = (await git(["git", "rev-parse", "--show-toplevel"], abs[0].slice(0, abs[0].lastIndexOf("/")) || "/")).trim();
  if (!root) return {};
  const files = abs.filter((p) => p.startsWith(root + "/")).map((p) => p.slice(root.length + 1));
  return files.length ? { repo: root, files } : {};
}
