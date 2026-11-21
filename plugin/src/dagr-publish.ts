/**
 * Validates a dagr v3 run document and writes it to `<cwd>/.dagr/haikrew.json` atomically.
 * Node built-ins only, so it runs without dagr or herdr installed. Never touches other files in `.dagr/`.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRun } from "./dagr-check.ts";

/** How many validator findings go into the reason; the rest would only flood stderr. */
const MAX_REASON_FINDINGS = 3;

/**
 * Parse and validate `json`, then replace `<cwd>/.dagr/haikrew.json` with it through a temp file and a rename, so a
 * reader sees either the old file or the new one. Refuses when `.dagr` is a symlink. Returns the written path, or the
 * reason nothing was written.
 */
export function publishRun(cwd: string, json: string): { ok: true; path: string } | { ok: false; reason: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const findings = checkRun(doc);
  if (findings.length > 0) return { ok: false, reason: findings.slice(0, MAX_REASON_FINDINGS).join("; ") };

  const dir = join(cwd, ".dagr");
  const target = join(dir, "haikrew.json");
  let tmp = "";
  try {
    const existing = lstatSync(dir, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink()) {
      return { ok: false, reason: ".dagr is a symlink" };
    }
    mkdirSync(dir, { recursive: true });
    // A .dagr this call made is ours to hide from git (a dirty tree would fire review checks on every write). One that
    // was already there, such as bellwether's, is left exactly as it is.
    if (!existing) writeFileSync(join(dir, ".gitignore"), "*\n", { flag: "wx" });
    tmp = join(dir, `.haikrew.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(tmp, json, { flag: "wx" });
    renameSync(tmp, target);
    return { ok: true, path: target };
  } catch (err) {
    if (tmp) {
      try {
        unlinkSync(tmp);
      } catch {
        // The temp file may never have been created; nothing else to clean up.
      }
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
