/** Result of splitting argv. `command` is absent when no bare word was given. */
export interface Parsed {
  command?: string;
  positional: string[];
  flags: Record<string, string | true>;
}

/** A runnable command. `flags` lists the long flag names it accepts, without dashes. */
export interface Command {
  name: string;
  summary: string;
  flags: string[];
  run: (args: Parsed) => string;
}

/** True for a token that starts with a dash and has more after it, such as `-v` or `--name`. */
export function isFlag(token: string): boolean {
  return token.startsWith("-") && token.length > 1;
}
