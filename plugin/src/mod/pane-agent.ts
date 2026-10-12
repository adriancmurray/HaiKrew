/**
 * One subagent's transcript in a HaiKrew pane, opened from its card in the band above the prompt. Claude Code keeps
 * switching the main view to an agent's transcript for the person (the tasks list), so HaiKrew draws its own from
 * `$.session.messages({ agentId })`: the prompt it was given, then each message and tool call, newest last. Pure.
 */
import { fmtElapsed } from "./crew.ts";
import type { Row } from "./crew.ts";
import { C, compact, hrow, modelColor, modelName, txt, vcol } from "./ui.ts";
import type { Ui } from "./ui.ts";

/** One message as `$.session.messages` gives it: only the fields this view reads. */
export type AgentMessage = {
  role?: string;
  text?: string;
  toolUses?: Array<{ tool?: string; input?: Record<string, unknown>; text?: string; isError?: boolean }>;
};

// Messages drawn at most, the newest; older ones are counted in a line above them.
const SHOWN = 60;
const PROMPT_LINES = 8;

/** The pane's body for agent `row` (undefined once it left the roster) and its messages. */
export function agentTranscript(ui: Ui, row: Row | undefined, messages: AgentMessage[], cols: number): unknown {
  const head = row
    ? hrow(ui, { columnGap: 1, flexWrap: "wrap" }, [
      txt(ui, { bold: true }, row.name),
      row.model && row.model !== "unknown" ? txt(ui, { color: modelColor(row.model) }, modelName(row.model)) : null,
      txt(ui, row.state === "failed" ? { color: C.bad } : row.state === "working" ? { color: C.ok } : { dimColor: true }, row.state),
      txt(ui, { dimColor: true }, [fmtElapsed(row.elapsedMs), row.tokens ? `${compact(row.tokens)} tokens` : ""].filter(Boolean).join(" · ")),
    ].filter((x) => x !== null))
    : txt(ui, { dimColor: true }, "This agent has left the crew; its transcript is shown as last read.");
  if (messages.length === 0) return vcol(ui, { rowGap: 1, width: cols }, [head, txt(ui, { dimColor: true }, "No messages yet.")]);
  const [first, ...rest] = messages;
  const prompt = first.role === "user" ? (first.text ?? "").split("\n") : [];
  const shown = (first.role === "user" ? rest : messages).slice(-SHOWN);
  const hidden = (first.role === "user" ? rest : messages).length - shown.length;
  return vcol(ui, { rowGap: 1, width: cols }, [
    head,
    prompt.length ? vcol(ui, { paddingLeft: 1 }, [
      txt(ui, { bold: true, dimColor: true }, "Prompt"),
      txt(ui, { dimColor: true, wrap: "wrap" }, prompt.slice(0, PROMPT_LINES).join("\n") + (prompt.length > PROMPT_LINES ? "\n…" : "")),
    ]) : null,
    hidden > 0 ? txt(ui, { dimColor: true }, `${hidden} earlier ${hidden === 1 ? "message" : "messages"} not shown`) : null,
    ...shown.map((m, i) => message(ui, m, i)),
  ].filter((x) => x !== null));
}

/** One message: its text, then one line per tool call with what it was called on and whether it failed. */
function message(ui: Ui, m: AgentMessage, i: number): unknown {
  const lines: unknown[] = [];
  const text = (m.text ?? "").trim();
  if (text) lines.push(txt(ui, m.role === "assistant" ? { wrap: "wrap" } : { dimColor: true, wrap: "wrap" }, text));
  for (const t of m.toolUses ?? []) {
    lines.push(txt(ui, t.isError ? { color: C.bad, wrap: "truncate-end" } : { dimColor: true, wrap: "truncate-end" },
      `▸ ${t.tool ?? "tool"} ${target(t.input)}${t.isError ? " (failed)" : ""}`));
  }
  return lines.length ? vcol(ui, { key: `msg-${i}` }, lines) : null;
}

/** What a tool call was aimed at: its command, path, pattern, URL or query, cut to one line. */
export function target(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "description"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v.trim().split("\n")[0];
  }
  return "";
}
