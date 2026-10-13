import type { Parsed } from "./cli.ts";
import { isFlag } from "./cli.ts";

/** Stores a flag as an ordinary own key, so a name such as `__proto__` is not a prototype write. */
function setFlag(flags: Record<string, string | true>, name: string, value: string | true): void {
  Object.defineProperty(flags, name, { value, enumerable: true, writable: true, configurable: true });
}

/** Splits argv into a command, positionals and flags. Never throws. */
export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { positional: [], flags: {} };
  let optionsOpen = true;
  for (const token of argv) {
    if (optionsOpen && token === "--") {
      optionsOpen = false;
    } else if (optionsOpen && isFlag(token)) {
      const body = token.replace(/^--?/, "");
      const eq = body.indexOf("=");
      if (eq === -1) setFlag(out.flags, body, true);
      else setFlag(out.flags, body.slice(0, eq), body.slice(eq + 1));
    } else if (out.command === undefined) {
      out.command = token;
    } else {
      out.positional.push(token);
    }
  }
  return out;
}
