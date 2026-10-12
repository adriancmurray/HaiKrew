/** The review packet for a finished subagent and the one-line note that points the main conversation at it. Pure. */
import type { ReviewPlan } from "./review.ts";

export type PacketInput = {
  name: string; type: string; model: string; spec: string; report: string;
  paths: string[]; lines: number; testsPassed: boolean | null; plan: ReviewPlan;
};

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

/** Whether the report claims passing tests: pass counts with 0 fail or VERDICT: PASS is true; FAIL or fail>0 false; else null. */
export function testsClaim(report: string): boolean | null {
  const verdicts = [...report.matchAll(/VERDICT:\s*(PASS|FAIL)\b/gi)];
  const last = verdicts[verdicts.length - 1]?.[1]?.toLowerCase();
  const failN = [...report.matchAll(/\b(\d+)\s+fail(?:ed|ures?|ing)?\b/gi)].map((m) => Number(m[1]));
  const passN = [...report.matchAll(/\b(\d+)\s+pass(?:ed|ing)?\b/gi)].map((m) => Number(m[1]));
  if (last === "fail" || failN.some((n) => n > 0)) return false;
  if (last === "pass" || passN.some((n) => n > 0)) return true;
  return null;
}

/** One line for the main conversation; "" when no review is planned. */
export function reviewNote(name: string, plan: ReviewPlan, paths: string[] = [], lines = 0): string {
  if (plan.tier === "none") return "";
  const head = `HaiKrew review: ${name} finished (${paths.length} file${paths.length === 1 ? "" : "s"}, ~${lines} lines). Tier ${plan.tier}: ${plan.reasons.join("; ") || "no specific reason"}.`;
  if (plan.tier === "light") return `${head} Glance at the diff and call mcp__haikrew__record_verdict.`;
  const r = plan.reviewer;
  const who = r ? `on ${r.model} at ${r.effort} effort ` : "";
  return `${head} Launch a reviewer ${who}with prompt starting \`HAIKREW job=review name=<a name>\` and telling it to call mcp__haikrew__review_packet with agent "${name}" first.`;
}
