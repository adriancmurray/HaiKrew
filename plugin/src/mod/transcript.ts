/**
 * Reading a finished agent's transcript. `$.fs.read` rejects a file over 4 MiB, and a long agent passes that easily, so a
 * read that fails falls back to the `haikrew digest` CLI, which streams the file and answers with a small summary.
 * The reader and the CLI come in as arguments.
 */
import { digestText, parseDigest } from "./ledger.ts";
import type { TranscriptDigest } from "./ledger.ts";

export type TranscriptIo = {
  /** The file's text; rejects when missing or too large. */
  read(path: string): Promise<string>;
  /** The output of `haikrew digest <path>`; rejects when the CLI cannot run here or fails. */
  digest(path: string): Promise<string>;
};

/** The transcript's digest, or null when neither route can read it. */
export async function readTranscript(io: TranscriptIo, path: string): Promise<TranscriptDigest | null> {
  let text: string;
  try {
    text = await io.read(path);
  } catch {
    try {
      return parseDigest(await io.digest(path));
    } catch {
      return null;
    }
  }
  return digestText(text);
}
