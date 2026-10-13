/**
 * `haikrew late-failures`: flag the passed runs in the newest store file that a later fix commit touched, and write
 * the flags as JSON keyed by agent id. Reads the store file and runs git through the injected LateIo; cli.ts supplies
 * the real ones.
 */
import type { AnalyzeIo } from "./analyze.ts";
import { newestStore } from "./analyze.ts";
import { isObject } from "./mod/api.ts";
import { readState } from "./mod/ledger.ts";
import { flagLate } from "./mod/late.ts";

/** The file, in the store folder, that holds the late-failure flags. */
export const LATE_FILE_NAME = "haikrew-late.json";

/** The analyze reads and streams plus git, the file write and the clock. */
export type LateIo = AnalyzeIo & {
  git(argv: string[], cwd: string): Promise<string>;
  write(text: string): void;
  now(): number;
};

/**
 * Write {agent_id: {late_fail, late_fail_commit}} for every flagged run in the newest store file. Returns 0, or 1 when
 * there is no store file or anything fails (reported through io.err).
 */
export async function lateFailuresCmd(days: number, io: LateIo): Promise<number> {
  try {
    const path = newestStore(io.stores());
    if (!path) {
      io.err("late-failures: no store file\n");
      return 1;
    }
    const text = io.read(path);
    const stored: unknown = text === null ? undefined : JSON.parse(text);
    const state = readState(isObject(stored) ? stored.ledger : undefined);
    const { runs } = await flagLate(state.runs, io.now(), days, io.git);
    const flagged = Object.fromEntries(
      runs.filter((r) => r.late_fail).map((r) => [r.agent_id, { late_fail: true, late_fail_commit: r.late_fail_commit }]),
    );
    io.write(JSON.stringify(flagged));
    return 0;
  } catch (e) {
    io.err(`late-failures: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
