/**
 * Selector matching for the gate: which rules and instruction entries apply to a spawn. Pure: the spawn and its
 * folder come in as values, so no Node APIs are needed.
 */
import type { Input } from "./api.ts";

/** What a selector can match against: the job, language, agent type, description (lowercased) and folder of a spawn. */
export type SelectCtx = { job: string; lang: string; type: string; desc: string; cwd: string };

/** The value of `key=` on the first line of a prompt that starts with `HAIKREW `, or "" when there is none. */
export function tag(prompt: unknown, key: string): string {
  const first = String(prompt ?? "").split("\n")[0];
  if (!first.startsWith("HAIKREW ")) return "";
  return new RegExp(`\\b${key}=(\\S+)`).exec(first)?.[1] ?? "";
}

/** The selector context for a spawn started in `cwd`. */
export function ctxFrom(e: Input, cwd: string): SelectCtx {
  return {
    job: tag(e.prompt, "job"),
    lang: tag(e.prompt, "lang"),
    type: String(e.subagentType ?? ""),
    desc: String(e.description ?? "").toLowerCase(),
    cwd,
  };
}

// ponytail: no $.env access, so the home folder is inferred from the session's own path (macOS and Linux only).
/** The "/Users/<name>" or "/home/<name>" prefix of `path`, or "" when it has none. */
export function homeOf(path: string): string {
  return /^\/(Users|home)\/[^/]+/.exec(path)?.[0] ?? "";
}

/** Glob to an anchored regex: `**` spans folders, `*` one segment, `?` one character. */
function globRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**", i)) {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** True when the glob (a leading "~" expands to the home folder) matches `cwd` or one of its ancestor folders. */
export function globMatch(glob: string, cwd: string): boolean {
  const home = homeOf(cwd);
  if (glob.startsWith("~") && home === "") return false;
  const pattern = (glob.startsWith("~") ? home + glob.slice(1) : glob).replace(/\/+$/, "");
  const re = globRegex(pattern);
  let folder = cwd.replace(/\/+$/, "");
  while (folder !== "") {
    if (re.test(folder)) return true;
    const cut = folder.lastIndexOf("/");
    if (cut <= 0) break;
    folder = folder.slice(0, cut);
  }
  return false;
}

/** True when one `kind:value` term matches the context: job, lang and type exact, desc a substring, cwd a glob. */
export function termMatch(term: string, ctx: SelectCtx): boolean {
  const colon = term.indexOf(":");
  if (colon < 0) return false;
  const kind = term.slice(0, colon);
  const value = term.slice(colon + 1);
  if (kind === "job") return ctx.job === value;
  if (kind === "lang") return ctx.lang === value;
  if (kind === "type") return ctx.type === value;
  if (kind === "desc") return ctx.desc.includes(value.toLowerCase());
  if (kind === "cwd") return globMatch(value, ctx.cwd);
  return false;
}

/** True when every `+`-joined term of the selector matches. */
export function selectorMatch(selector: string, ctx: SelectCtx): boolean {
  return selector.split("+").every((term) => termMatch(term, ctx));
}

/** A rule split into its selector, model and optional `@effort` suffix. */
export type ParsedRule = { selector: string; model: string; effort?: string };

/** Splits `selector=model[@effort]` at the last "=", then the optional effort at "@". */
export function parseRule(rule: string): ParsedRule {
  const eq = rule.lastIndexOf("=");
  const selector = rule.slice(0, eq);
  const rhs = rule.slice(eq + 1);
  const at = rhs.indexOf("@");
  if (at < 0) return { selector, model: rhs };
  return { selector, model: rhs.slice(0, at), effort: rhs.slice(at + 1) };
}

/** The texts of the `selector: text` instruction entries whose selector matches, in order. */
export function instructionsFor(entries: string[], ctx: SelectCtx): string[] {
  const texts: string[] = [];
  for (const entry of entries) {
    const sep = entry.indexOf(": ");
    if (sep < 0) continue;
    if (selectorMatch(entry.slice(0, sep), ctx)) texts.push(entry.slice(sep + 2));
  }
  return texts;
}

/** The prompt with the instruction texts appended as a list, or the prompt unchanged when there are none. */
export function withInstructions(prompt: string, texts: string[]): string {
  if (texts.length === 0) return prompt;
  return `${prompt}\n\nInstructions from HaiKrew settings:\n- ${texts.join("\n- ")}`;
}
