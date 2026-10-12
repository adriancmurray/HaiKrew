/**
 * Shared pieces of the `/haikrew` pane: the element and API types it uses, the session-local view state, colours,
 * and pure text formatting. Colours are theme keys where one fits, so text follows the person's light or dark theme;
 * model colours are the crew sprites' mid tones, used for dots and bars only.
 */
import { modelFamily } from "./crew.ts";
import { HEX } from "./svg.ts";

export type Ui = Record<string, (...args: unknown[]) => unknown>;

/** What a tab may ask of the pane. pane.ts builds these as closures, since `$` never crosses an import. */
export type Actions = {
  /** Redraw the pane. */
  redraw(): void;
  /** Validate and store one setting; a refusal shows under the field `id`. */
  save(id: string, section: string, key: string, value: unknown): Promise<void>;
  /** Put a gate rule in the rules list: in place of `replaces` when given and present, else first. */
  addRule(rule: string, replaces?: string): Promise<void>;
  /** Ask the main conversation to run a finished subagent's task again on `model`. */
  retry(agent: { type: string; task: string; model: string }, model: string): Promise<void>;
};

export const TABS = [["home", "Home"], ["ledger", "Ledger"], ["settings", "Settings"]] as const;
export type Tab = (typeof TABS)[number][0];

/** Session-local view state. Module scope because the pane's handlers outlive a single render. */
export const view: {
  tab: Tab;
  section: string;
  drafts: Record<string, string>;
  errors: Record<string, string>;
  /** Open or folded, by key: fields' full help, cards, settings groups, details. */
  open: Record<string, boolean>;
  frame: number;
  cols: number;
  /** Drafts of the rule, instruction and pattern forms, by field id. */
  forms: Record<string, Record<string, string>>;
  /** The one two-press action waiting for its second press, e.g. a rule to add or an item to remove. */
  armed: string;
} = { tab: "home", section: "routing", drafts: {}, errors: {}, open: {}, frame: 0, cols: 80, forms: {}, armed: "" };

/** Theme keys the pane paints with. */
export const C = {
  ok: "success",
  bad: "error",
  warn: "warning",
  accent: "claude",
  link: "suggestion",
  muted: "inactive",
  track: "subtle",
} as const;

const MODEL_HEX: Record<string, string> = { haiku: "#9b7fc7", sonnet: "#4f9c98", opus: "#d97757", unknown: "#8a8f9c" };

/** The colour of a model's dot or bar: the crew sprite colour of its family. */
export function modelColor(model: string): string {
  return MODEL_HEX[modelFamily(model)];
}

/**
 * CSS pixels for `cols` body columns on the desktop. ponytail: measured once in the desktop app (a docked pane of
 * 49 columns drew about 560px wide); the pane reports columns, not pixels, so a different font size will be off.
 */
export function pxOf(cols: number): number {
  return Math.max(200, Math.round(cols * 11.4));
}

/** Columns the page and a card take from the pane width: page padding 2 and card border plus padding 3, each side. */
export const CARD_INSET = 10;

/** How wide a card's insides are, in columns: what a card's divider is drawn to. */
export type CardFrame = { cols: number };

/**
 * A dim rule across a card, as text: a row of line characters clipped to one row, which every surface draws.
 * ponytail: twice the columns, clipped, since a proportional font fits a varying number of them in a column.
 */
export function divider(ui: Ui, frame: CardFrame): unknown {
  return ui.Box({ height: 1, overflow: "hidden", children: [txt(ui, { dimColor: true, wrap: "wrap" }, "─".repeat(Math.max(10, frame.cols) * 2))] });
}

/**
 * An on/off switch as two joined choices, Off and On, the current one highlighted, so it reads the way the
 * model picker does. Keys are `<key>-off` and `<key>-on`; `hotkey` goes on the side that changes the state.
 */
export function onOff(ui: Ui, key: string, on: boolean, set: (value: boolean) => unknown, hotkey?: string): unknown {
  const side = (value: boolean, label: string): unknown => ui.Button({
    key: `${key}-${value ? "on" : "off"}`, label, variant: on === value ? "primary" : "secondary",
    ...(hotkey && on !== value ? { hotkey } : {}),
    onPress: () => (on === value ? undefined : set(value)),
  });
  return hrow(ui, { columnGap: 0, alignItems: "center", flexShrink: 0 }, [side(false, "Off"), side(true, "On")]);
}

/**
 * A card that folds: its title row carries a chevron (▾ open, ▸ folded); open, a rule runs under the title; folded, it shows only
 * `summary`, one line of what is inside. Open or folded is kept per card for the session; `open` is the start.
 */
export function foldCard(ui: Ui, act: Actions, frame: CardFrame, key: string, title: string, note: string, summary: string, open: boolean, children: unknown[]): unknown {
  const isOpen = view.open[key] ?? open;
  const head = textAndControls(ui, [hrow(ui, { columnGap: 2, alignItems: "center", flexWrap: "wrap" }, [txt(ui, { bold: true }, title), note ? txt(ui, { dimColor: true }, note) : null])], [
    ui.Button({ key: `${key}-toggle`, label: isOpen ? "▾" : "▸", onPress: () => {
      view.open[key] = !isOpen;
      act.redraw();
    } }),
  ]);
  // The rule hugs the title row; the card's gap then separates the head from what is inside.
  return vcol(ui, { key, borderStyle: "round", borderDimColor: true, paddingX: 2, paddingY: 1, rowGap: 1 }, [
    isOpen ? vcol(ui, {}, [head, divider(ui, frame)]) : head,
    ...(isOpen ? children : summary ? [txt(ui, { dimColor: true, wrap: "truncate-end" }, summary)] : []),
  ]);
}

/** A row of a two-column form: a label in a fixed share of the width, its controls after it, wrapping. */
export function labelled(ui: Ui, label: string, controls: unknown[]): unknown {
  return textAndControls(ui, [txt(ui, { dimColor: true }, label)], controls, {
    row: { alignItems: "center", columnGap: 1, flexWrap: "wrap", justifyContent: "flex-start" },
    text: { width: "38%", flexGrow: 0 },
  });
}

/** The SVG colour for one of the pane's status theme keys. */
export function hexOf(key: string): string {
  return key === C.ok ? HEX.ok : key === C.warn ? HEX.warn : key === C.bad ? HEX.bad : HEX.muted;
}

/** A Text element. Mods read its content from `children` inside the props, so the content goes there. */
export function txt(ui: Ui, props: Record<string, unknown>, content: unknown): unknown {
  return ui.Text({ ...props, children: content });
}

/** A Box laid out as a row. */
export function hrow(ui: Ui, props: Record<string, unknown>, children: unknown[]): unknown {
  return ui.Box({ flexDirection: "row", ...props, children: children.filter((c) => c !== null) });
}

/** A Box laid out as a column. */
export function vcol(ui: Ui, props: Record<string, unknown>, children: unknown[]): unknown {
  return ui.Box({ flexDirection: "column", ...props, children: children.filter((c) => c !== null) });
}

/**
 * A row of text beside controls (buttons, a switch). The text box takes the room left and may shrink, so its text
 * wraps or truncates inside it; the control box keeps its size, so a long line never pushes a control out of the card.
 * `props.row` goes on the row and `props.text` on the text box, e.g. a fixed width.
 */
export function textAndControls(ui: Ui, text: unknown[], controls: unknown[], props: { row?: Record<string, unknown>; text?: Record<string, unknown> } = {}): unknown {
  return hrow(ui, { justifyContent: "space-between", alignItems: "center", columnGap: 2, ...props.row }, [
    ui.Box({ flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, ...props.text, children: text.filter((c) => c !== null) }),
    ui.Box({ flexDirection: "row", alignItems: "center", columnGap: 1, flexWrap: "wrap", flexShrink: 0, children: controls.filter((c) => c !== null) }),
  ]);
}

/** A small bold heading in the accent colour. */
export function heading(ui: Ui, text: string, note = ""): unknown {
  return hrow(ui, { columnGap: 1 }, [txt(ui, { bold: true, color: C.accent }, text), note ? txt(ui, { dimColor: true }, note) : null]);
}

/** An empty state: what is missing on one line, what to do about it dim below. */
export function empty(ui: Ui, what: string, hint: string): unknown {
  return vcol(ui, { paddingX: 1, borderStyle: "round", borderDimColor: true }, [txt(ui, {}, what), txt(ui, { dimColor: true }, hint)]);
}

/** A meter: filled cells in `color`, the rest as a dim track. */
export function meter(ui: Ui, fraction: number, width: number, color: string): unknown {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return hrow(ui, {}, [txt(ui, { color }, "█".repeat(filled)), txt(ui, { color: C.track }, "░".repeat(width - filled))]);
}

/** Green below 60%, amber below 85%, red from there: for how full something is. */
export function fillColor(fraction: number): string {
  return fraction < 0.6 ? C.ok : fraction < 0.85 ? C.warn : C.bad;
}

/** Green from 80%, amber from 50%, red below: for how often something passed. */
export function passColor(rate: number): string {
  return rate >= 0.8 ? C.ok : rate >= 0.5 ? C.warn : C.bad;
}

/** Digits with thousands separators: 12345 -> 12,345. */
export function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** A short count: 950, 12.4k, 3.1M. */
export function compact(value: number): string {
  const v = Math.round(value);
  if (Math.abs(v) < 1000) return String(v);
  if (Math.abs(v) < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

/** Seconds as 48s, 1m 12s or 2h 05m. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** A model id as people say it: claude-haiku-5-5 -> Haiku 5.5. Other names come back unchanged. */
export function modelName(model: string): string {
  const m = /^(?:claude-)?(haiku|sonnet|opus)-(\d+(?:-\d+)?)(?:-\d{8})?$/.exec(model.toLowerCase());
  if (!m) return model || "unknown";
  return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2].replace("-", ".")}`;
}

/** `text` cut to `width` with an ellipsis, or padded to it. */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);
}

/** How the pane says a time: how long until or since ("in 2 h 14 min"), the local clock ("at 18:00"), or both. */
export type TimeStyle = "relative" | "clock" | "both";

/** Milliseconds since the epoch for an ISO string or epoch seconds or milliseconds; null for anything else. */
export function toMs(value: unknown): number | null {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 1e12 ? value * 1000 : value;
}

/** A span of time in words: 45 s, 35 min, 2 h 14 min, 3 days. */
export function span(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return `${Math.max(1, Math.round(Math.abs(ms) / 1000))} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** The local clock time, with the weekday when it is not today: "6:00 PM", "Tue 6:00 PM". */
export function clock(ms: number, now: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** When something happens or happened, as `style` says: "in 2 h 14 min", "at 6:00 PM", "2 h ago", or both forms. */
export function when(value: unknown, now: number, style: TimeStyle): string {
  const ms = toMs(value);
  if (ms === null) return "at an unknown time";
  const rel = ms >= now ? `in ${span(ms - now)}` : `${span(now - ms)} ago`;
  if (style === "relative") return rel;
  if (style === "clock") return `at ${clock(ms, now)}`;
  return `${rel} (${clock(ms, now)})`;
}
