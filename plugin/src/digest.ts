/**
 * `haikrew digest <transcript>`: one JSON line summing up a subagent transcript of any size. The mod cannot read a file
 * over 4 MiB, and its process output has the same cap, so this streams the file line by line and prints only what recording
 * the run needs.
 */
import { createReadStream } from "node:fs";
import { isObject } from "./mod/api.ts";
import { digestScan, emptyScan, LINE_SPLIT, scanEntry } from "./mod/ledger.ts";
import type { TranscriptDigest } from "./mod/ledger.ts";

/** The digest of the JSONL file at `path`. Lines that are not JSON objects are skipped. Throws when the file cannot be read. */
export async function digestFile(path: string): Promise<TranscriptDigest> {
  const scan = emptyScan();
  let idx = 0;
  const take = (line: string): void => {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return; // a partly written line
    }
    if (isObject(entry)) scanEntry(scan, entry, idx++);
  };
  // Split as the mod's parser does. readline also ends a line at U+2028 and U+2029, which JSONL holds raw inside strings.
  let tail: string[] = [];
  for await (const chunk of createReadStream(path, "utf8")) {
    const lines = String(chunk).split(LINE_SPLIT);
    if (lines.length === 1) {
      tail.push(String(chunk));
      continue;
    }
    take(tail.join("") + lines[0]);
    for (const line of lines.slice(1, -1)) take(line);
    tail = [lines[lines.length - 1] ?? ""];
  }
  take(tail.join(""));
  return digestScan(scan);
}

/** Prints the digest of `path`. Resolves to the exit code. */
export async function digestCmd(path: string): Promise<number> {
  try {
    process.stdout.write(`${JSON.stringify(await digestFile(path))}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`haikrew digest: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
