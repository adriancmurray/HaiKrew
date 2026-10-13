/** The review packet for a finished subagent and the one-line note that points the main conversation at it. Pure. */
import { CHECKER_AGENT, REVIEWER_AGENT } from "./review.ts";
import type { ReviewPlan } from "./review.ts";

export type PacketInput = {
  name: string; type: string; model: string; spec: string; report: string;
  paths: string[]; lines: number; testsPassed: boolean | null; plan: ReviewPlan;
};

/** How a note reaches the main conversation: whether HaiKrew's review tools are on (default on), and the packet text to carry when they are off. */
export type NoteOptions = { toolsOn?: boolean; packet?: string };

/** A fence longer than any backtick run in `text`, so the text cannot close it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

/** The markdown a reviewer reads first. */
export function buildPacket(o: PacketInput): string {
  const tests = o.testsPassed === null ? "none claimed" : o.testsPassed ? "claims tests pass" : "claims tests fail";
  return [
    `# Review packet: ${o.name}`,
    "",
    `Agent: ${o.name} (${o.type}, ${o.model})`,
    `Tier: ${o.plan.tier}${o.plan.reasons.length ? ` (${o.plan.reasons.join("; ")})` : ""}`,
    "",
    "## Original spec",
    fenced(o.spec),
    "",
    "## The agent's final report",
    fenced(o.report),
    "",
    `## Files changed (~${o.lines} lines)`,
    o.paths.length ? o.paths.map((p) => `- ${p}`).join("\n") : "- none recorded",
    "",
    `## Test claim\n${tests}`,
    "",
    "## Instructions",
    "Check the work against the spec: read the changed files and run the repo's checks yourself; do not trust the report.",
    `End your reply with exactly one line \`VERDICT: PASS for ${o.name}\` or \`VERDICT: FAIL for ${o.name}\` followed by the reasons.`,
  ].join("\n");
}

// A verdict line, or a count of failed or passed tests ("2 failing", "12 passed").
const MARKER = /VERDICT:\s*(PASS|FAIL)\b|\b(\d+)\s+(fail(?:ed|ures?|ing)?|pass(?:ed|ing)?)\b/gi;

/**
 * Whether the report claims passing tests, read from its last marker: a VERDICT line or a non-zero count of
 * passed or failed tests. A zero count says nothing. True for pass, false for fail, null when no marker says either.
 */
export function testsClaim(report: string): boolean | null {
  let claim: boolean | null = null;
  for (const m of report.matchAll(MARKER)) {
    if (m[1] !== undefined) claim = m[1].toLowerCase() === "pass";
    else if (Number(m[2]) > 0) claim = (m[3] ?? "").toLowerCase().startsWith("pass");
  }
  return claim;
}

/**
 * The instruction for a light change checked by a checker agent. The checker reads the packet itself when tools are on;
 * when they are off, the packet travels in the note.
 */
function checkerAction(name: string, toolsOn: boolean, packet: string): string {
  const start = `Launch a checker with subagent_type \`${CHECKER_AGENT}\` and prompt starting \`HAIKREW job=check name=<a name>\``;
  const naming = toolsOn ? `, naming agent "${name}" to check` : `, naming agent "${name}" to check, and put this review packet in its prompt:\n\n${packet}`;
  return `${start}${naming}. On its VERDICT, a FAIL means fix the work or re-run it on the next model up before building on it.`;
}

/** The instruction after a note's head: what the main conversation does for the tier. Tools off: no tool names; the packet travels in the note. */
function action(name: string, plan: ReviewPlan, toolsOn: boolean, packet: string): string {
  if (plan.reviewer === "inline") {
    const risky = "Review the risky hunks yourself (public API, security, concurrency, permissions, data loss)";
    return toolsOn
      ? `${risky}, then call mcp__haikrew__record_verdict. No subagent review for this one.`
      : `${risky} and say in your reply whether the change passes. No subagent review for this one.`;
  }
  if (plan.tier === "light" && plan.reviewer?.agent) return checkerAction(name, toolsOn, packet);
  if (plan.tier === "light") {
    return toolsOn
      ? "Glance at the diff and call mcp__haikrew__record_verdict."
      : "Glance at the diff and say in your reply whether it passes.";
  }
  const who = plan.reviewer ? ` on ${plan.reviewer.model} at ${plan.reviewer.effort} effort` : "";
  const start = `Launch a reviewer with subagent_type \`${REVIEWER_AGENT}\`${who} and prompt starting \`HAIKREW job=review name=<a name>\``;
  return toolsOn
    ? `${start} and telling it to call mcp__haikrew__review_packet with agent "${name}" first.`
    : `${start} and put this review packet in its prompt:\n\n${packet}`;
}

/** One line for the main conversation; "" when no review is planned. */
export function reviewNote(name: string, plan: ReviewPlan, paths: string[] = [], lines = 0, o: NoteOptions = {}): string {
  if (plan.tier === "none") return "";
  const head = `HaiKrew review: ${name} finished (${paths.length} file${paths.length === 1 ? "" : "s"}, ~${lines} lines). Tier ${plan.tier}: ${plan.reasons.join("; ") || "no specific reason"}.`;
  return `${head} ${action(name, plan, o.toolsOn ?? true, o.packet ?? "")}`;
}
