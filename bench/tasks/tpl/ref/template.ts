const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function lookup(vars: unknown, path: string): unknown {
  let cur: unknown = vars;
  for (const part of path.split(".")) {
    if (cur === null || (typeof cur !== "object" && typeof cur !== "function")) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function render(tpl: string, vars: Record<string, unknown>, opts: { escape?: boolean } = {}): string {
  const esc = opts.escape !== false;
  return tpl.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g, (_m, raw: string | undefined, name: string | undefined) => {
    const v = lookup(vars, (raw ?? name) as string);
    if (v === undefined || v === null) return "";
    const s = String(v);
    return raw !== undefined || !esc ? s : s.replace(/[&<>"']/g, (c) => ESC[c]);
  });
}
