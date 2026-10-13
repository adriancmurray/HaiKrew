import type { Command, RunResult } from "./cli.ts";
import { parseArgs } from "./args.ts";
import { renderHelp } from "./help.ts";

/** A set of commands keyed by name. */
export interface Registry {
  register(cmd: Command): void;
  get(name: string): Command | undefined;
  list(): Command[];
}

/** A registry that rejects duplicate names and lists commands sorted by name. */
export function createRegistry(): Registry {
  const byName = new Map<string, Command>();
  return {
    register(cmd) {
      if (byName.has(cmd.name)) throw new Error(`duplicate command: ${cmd.name}`);
      byName.set(cmd.name, cmd);
    },
    get: (name) => byName.get(name),
    list: () => [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
}

/** Parses argv, shows help or runs the named command, and reports an exit code and output. */
export function runCli(argv: string[], registry: Registry): RunResult {
  const parsed = parseArgs(argv);
  if (parsed.command === undefined || "help" in parsed.flags) {
    return { code: 0, output: renderHelp(registry.list()) };
  }
  const cmd = registry.get(parsed.command);
  if (!cmd) return { code: 2, output: `unknown command: ${parsed.command}` };
  const unknown = Object.keys(parsed.flags).find((f) => f !== "help" && !cmd.flags.includes(f));
  if (unknown !== undefined) return { code: 2, output: `unknown flag --${unknown} for ${cmd.name}` };
  try {
    return { code: 0, output: cmd.run(parsed) };
  } catch (e) {
    return { code: 1, output: e instanceof Error ? e.message : String(e) };
  }
}
