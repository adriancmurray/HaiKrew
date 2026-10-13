export function render(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : ""));
}
