import type { Command } from "./cli.ts";

/** Usage text for the visible commands, sorted by name and padded to the longest name. */
export function renderHelp(commands: Command[]): string {
  const shown = commands
    .filter((c) => !c.hidden)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const width = Math.max(0, ...shown.map((c) => c.name.length));
  const rows = shown.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return ["usage: tool <command> [options]", "", "commands:", ...rows].join("\n");
}
