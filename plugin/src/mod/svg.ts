/**
 * SVG drawings for the pane on surfaces that draw `Svg` (desktop first): tables with bars and ring gauges. They sit
 * on the panel's own background, and a prefers-color-scheme rule inside an SVG follows the operating system rather
 * than the app, so each drawing takes an Ink chosen from the app's theme setting (see `inkFor`). Status colours
 * are mid tones that read on either background. Drawings are still images (no entrance animation), since the pane
 * redraws them on every scroll. Pure.
 */

/** Mid-tone status colours that read on light and dark backgrounds. */
export const HEX = { ok: "#3f9b5f", warn: "#c98a1b", bad: "#d0533f", accent: "#d97757", muted: "#8a8f9c" } as const;

/** Text made safe for SVG markup. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clamp(fraction: number): number {
  return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
}

/** The colours an SVG draws its words, rules and sky marks in, for one background. */
export type Ink = { dark: boolean; text: string; muted: string; line: string; star: string; ground: string; bubble: string; bubbleText: string };

/** The ink for a dark or a light panel. Stars are pale on dark and a warm amber on light, so they show on both. */
export function inkFor(dark: boolean): Ink {
  return dark
    ? { dark, text: "#ece9e2", muted: "#9a9a9f", line: "#3a3a3d", star: "#efe2c2", ground: "#4a4a4f", bubble: "#f4efe6", bubbleText: "#2a2723" }
    : { dark, text: "#2a2723", muted: "#77736b", line: "#e3dfd6", star: "#c9963f", ground: "#cfc9bd", bubble: "#ffffff", bubbleText: "#2a2723" };
}

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";

/** One table cell: text (muted, bold or coloured), a coloured dot before text, or a bar with its label. */
export type Cell =
  | { text: string; muted?: boolean; bold?: boolean; color?: string }
  | { dot: string; text: string }
  | { bar: number; color: string; label: string };

/** A column: its header, its share of the width, and whether it sits at the end. */
export type Column = { label: string; share: number; end?: boolean };

const ROW_H = 28;
const HEAD_H = 24;
const PAD = 8;

/** Text cut to roughly fit `px` at 12px, with an ellipsis. */
function clip(text: string, px: number): string {
  const max = Math.max(1, Math.floor(px / 6.8));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cellSvg(cell: Cell, x: number, w: number, y: number, end: boolean, ink: Ink): string {
  const ty = y + ROW_H / 2 + 4;
  if ("bar" in cell) {
    const bw = Math.max(12, w - 44 - PAD * 2);
    const by = y + ROW_H / 2 - 4;
    const f = clamp(cell.bar) * bw;
    return `<rect x="${x + PAD}" y="${by}" width="${bw}" height="8" rx="4" fill="${ink.line}"/>` +
      (f > 0 ? `<rect x="${x + PAD}" y="${by}" width="${Math.max(8, f).toFixed(1)}" height="8" rx="4" fill="${cell.color}"/>` : "") +
      `<text x="${x + w - PAD}" y="${ty}" text-anchor="end" font-weight="600" fill="${cell.color}">${esc(cell.label)}</text>`;
  }
  if ("dot" in cell) {
    return `<circle cx="${x + PAD + 4}" cy="${y + ROW_H / 2}" r="4" fill="${cell.dot}"/>` +
      `<text x="${x + PAD + 14}" y="${ty}" fill="${ink.text}">${esc(clip(cell.text, w - PAD - 18))}</text>`;
  }
  const fill = cell.color ?? (cell.muted ? ink.muted : ink.text);
  return `<text x="${end ? x + w - PAD : x + PAD}" y="${ty}"${end ? ` text-anchor="end"` : ""}${cell.bold ? ` font-weight="600"` : ""} ` +
    `fill="${fill}">${esc(clip(cell.text, w - PAD * 2))}</text>`;
}

/** A table `width` pixels wide: header, then rows with a hover band and a tooltip each. */
export function table(columns: Column[], rows: Cell[][], width: number, tips: string[], ink: Ink): string {
  const total = columns.reduce((s, c) => s + c.share, 0) || 1;
  const ws = columns.map((c) => (c.share / total) * width);
  const xs = ws.map((_, i) => ws.slice(0, i).reduce((s, w) => s + w, 0));
  const height = HEAD_H + rows.length * ROW_H;
  const head = columns.map((c, i) => `<text x="${c.end ? xs[i] + ws[i] - PAD : xs[i] + PAD}" y="16"${c.end ? ` text-anchor="end"` : ""} ` +
    `font-size="10.5" letter-spacing=".06em" fill="${ink.muted}">${esc(c.label.toUpperCase())}</text>`).join("");
  const body = rows.map((cells, r) => {
    const y = HEAD_H + r * ROW_H;
    return `<g class="r">${tips[r] ? `<title>${esc(tips[r])}</title>` : ""}` +
      `<rect class="hl" x="0" y="${y}" width="${width}" height="${ROW_H}" rx="6" fill="#8a8a8a" fill-opacity="0"/>` +
      cells.map((cell, i) => cellSvg(cell, xs[i], ws[i], y, columns[i].end === true, ink)).join("") +
      (r < rows.length - 1 ? `<line x1="${PAD}" x2="${width - PAD}" y1="${y + ROW_H}" y2="${y + ROW_H}" stroke="${ink.line}"/>` : "") + `</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `style="font:12px ${FONT}"><style>g.r:hover .hl{fill-opacity:.06}</style>` +
    `<line x1="0" x2="${width}" y1="${HEAD_H}" y2="${HEAD_H}" stroke="${ink.line}"/>${head}${body}</svg>`;
}

/** One ring: what it measures, how full, its colour, and the line under its label. */
export type Gauge = { label: string; fraction: number; color: string; detail: string };

/** Ring gauges in a row. Still: the pane redraws on every scroll, so an entrance animation would replay each time. */
export function gauges(items: Gauge[], width: number, ink: Ink): string {
  const cellW = Math.max(120, Math.min(170, Math.floor(width / Math.max(1, items.length))));
  const perRow = Math.max(1, Math.floor(width / cellW));
  const cellH = 132;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const parts = items.map((g, i) => {
    const cx = (i % perRow) * cellW + cellW / 2;
    const cy = Math.floor(i / perRow) * cellH + 44;
    const len = (clamp(g.fraction) * circ).toFixed(1);
    return `<g><title>${esc(`${g.label}: ${g.detail}`)}</title>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ink.line}" stroke-width="8"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${g.color}" stroke-width="8" stroke-linecap="round" ` +
      `stroke-dasharray="${len} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
      `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="17" font-weight="600" fill="${ink.text}">${Math.round(clamp(g.fraction) * 100)}%</text>` +
      `<text x="${cx}" y="${cy + r + 24}" text-anchor="middle" font-weight="600" fill="${ink.text}">${esc(clip(g.label, cellW - 8))}</text>` +
      `<text x="${cx}" y="${cy + r + 40}" text-anchor="middle" fill="${ink.muted}">${esc(clip(g.detail, cellW - 8))}</text></g>`;
  }).join("");
  const w = Math.min(width, perRow * cellW);
  const h = Math.ceil(items.length / perRow) * cellH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="font:12px ${FONT}">${parts}</svg>`;
}
