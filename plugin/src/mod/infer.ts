/**
 * A job for a run whose spec carried no `HAIKREW job=` tag, guessed from the opening of its prompt and its agent
 * type. Inferred jobs are stored with a leading "~" so the ledger keeps them apart from tagged ones, and the pane
 * shows them as "review (inferred)". The gate reads only tags, so no rule is ever suggested for an inferred job. Pure.
 */

/** Words that name a job, checked in order against the opening of a prompt; the first match wins. */
const WORDS: Array<[string, RegExp]> = [
  ["review", /\b(review|audit|critique)\b/],
  ["test", /\b(write|add|extend)\s+(unit\s+|integration\s+)?tests?\b|\btest coverage\b/],
  ["fix", /\b(fix|debug|repair|broken|regression)\b/],
  ["refactor", /\brefactor/],
  ["docs", /\b(document|documentation|docs|readme|changelog)\b/],
  ["research", /\b(research|investigate|look up|find out|explore|survey|compare)\b/],
  ["implement", /\b(implement|add|build|create|write)\b/],
];

/** Agent types whose job is plain from the type alone. */
const TYPES: Array<[string, RegExp]> = [
  ["research", /^(explore|haiku-scout|.*scout|.*research.*)$/i],
  ["review", /review/i],
  ["plan", /^plan$/i],
  ["implement", /coder$/i],
];

/** "~<job>" from the prompt's opening (its first 600 characters) or else the agent type; "unknown" when neither says. */
export function inferJob(prompt: string, agentType: string): string {
  const head = prompt.slice(0, 600).toLowerCase();
  const byWords = WORDS.find(([, re]) => re.test(head));
  if (byWords) return `~${byWords[0]}`;
  const byType = TYPES.find(([, re]) => re.test(agentType));
  return byType ? `~${byType[0]}` : "unknown";
}

/** A job as people read it: "review", or "review (inferred)" for one HaiKrew guessed. */
export function jobLabel(job: string): string {
  return job.startsWith("~") ? `${job.slice(1)} (inferred)` : job;
}
