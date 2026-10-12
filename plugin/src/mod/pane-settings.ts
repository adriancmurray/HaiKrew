/**
 * The Settings tab: three groups (Routing, Guards, General), each a stack of section cards with their own switch;
 * each field has a readable label, a one-line summary and a control that fits its type. Lists are edited one entry per row. Storage and validation are
 * unchanged: pane.ts loads and stores them, and every save goes through the schema.
 */
import { SCHEMA, validate } from "../schema.ts";
import type { Field, Settings } from "../schema.ts";
import { specialEditor } from "./pane-rules.ts";
import { title } from "./rules.ts";
import { C, foldCard, hrow, onOff, txt, vcol, view } from "./ui.ts";
import type { Actions, CardFrame, Ui } from "./ui.ts";

/** A field's readable name: its schema label, else its key with the underscores spaced out. */
export function labelOf(key: string, field: Field): string {
  if (field.label) return field.label;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The typed value of an Input's text: a whole number for int (NaN when blank), else the text. */
export function parseText(field: Field, text: string): unknown {
  if (field.type === "int") return text.trim() === "" ? NaN : Number(text.trim());
  return text;
}

/** The Settings tab's groups: what each covers, in the order shown. */
export const GROUPS = [
  { id: "routing", label: "Routing", sections: ["gate"] },
  { id: "guards", label: "Guards", sections: ["squeeze", "read_guard", "checks"] },
  { id: "widget", label: "Prompt widget", sections: ["band"] },
  { id: "general", label: "General", sections: ["pane", "agents", "ledger", "patterns"] },
] as const;

export function settingsTab(ui: Ui, act: Actions, settings: Settings, cols: number): unknown[] {
  const group = GROUPS.find((g) => g.id === view.section) ?? GROUPS[0];
  const chips = hrow(ui, { columnGap: 1, flexWrap: "wrap" }, GROUPS.map((g) => ui.Button({
    key: `group-${g.id}`, label: g.label, variant: g.id === group.id ? "primary" : "secondary",
    onPress: () => {
      view.section = g.id;
      act.redraw();
    },
  })));
  const inner = Math.max(20, cols - 6);
  return [chips, vcol(ui, { rowGap: 1 }, group.sections.map((name) => sectionCard(ui, act, settings, name, inner)))];
}

/** One line saying what a group is set to now, so it reads without opening. */
export function groupSummary(id: string, s: Settings): string {
  const onOff = (v: unknown): string => (v ? "on" : "off");
  if (id === "routing") {
    const n = (s.gate.rules as string[]).length;
    return `Gate ${onOff(s.gate.enabled)}${s.gate.enabled && s.gate.delegate ? " · crew preferred" : ""} · agents start on ${title(String(s.gate.default_model))} · ${n} ${n === 1 ? "rule" : "rules"}`;
  }
  if (id === "guards") return `Output squeeze ${onOff(s.squeeze.enabled)} · big-file guard ${onOff(s.read_guard.enabled)} · git hook guard ${onOff(s.checks.guard_hooks)}`;
  if (id === "widget") {
    if (!s.band.show) return "Off";
    return `Sky ${String(s.band.sky)}${s.band.clouds && s.band.sky !== "off" ? " with clouds" : ""} · main agent wears ${s.band.headwear === "none" ? "nothing" : `a ${s.band.headwear}`}`;
  }
  return `Ledger ${onOff(s.ledger.enabled)} · agent tools ${s.agents.control === "off" ? "off" : s.agents.control === "read" ? "look only" : "look and change"}`;
}

/** The desktop's Settings card, folded to one line until opened: each group as a row with what it is set to, opening in place. */
export function settingsSection(ui: Ui, act: Actions, frame: CardFrame, settings: Settings, cols: number): unknown {
  return foldCard(ui, act, frame, "card-settings", "Settings", "saved for every session", GROUPS.map((g) => groupSummary(g.id, settings)).join(" · "), false, GROUPS.map((g) => {
    const open = Boolean(view.open[`group-${g.id}`]);
    return vcol(ui, { rowGap: 1 }, [
      hrow(ui, { key: `group-row-${g.id}`, justifyContent: "space-between", alignItems: "center", columnGap: 2, hover: { backgroundColor: "#8A8A8A1A" } }, [
        vcol(ui, { flexShrink: 1 }, [txt(ui, { bold: true }, g.label), txt(ui, { dimColor: true, wrap: "truncate-end" }, groupSummary(g.id, settings))]),
        ui.Button({ key: `group-${g.id}`, label: open ? "✓" : "✎", ...(open ? { variant: "primary" } : {}), onPress: () => {
          view.open[`group-${g.id}`] = !open;
          act.redraw();
        } }),
      ]),
      ...(open ? g.sections.map((name) => sectionCard(ui, act, settings, name, Math.max(20, cols - 10))) : []),
    ]);
  }));
}

/** One section as a card: its title and switch on top, its help, then each setting. */
function sectionCard(ui: Ui, act: Actions, settings: Settings, section: string, width: number): unknown {
  const sec = SCHEMA[section];
  const values = settings[section];
  const toggle = sec.fields.enabled?.type === "bool" ? switchControl(act, ui, `${section}.enabled`, section, "enabled", Boolean(values.enabled)) : null;
  const off = toggle !== null && !values.enabled;
  const fields = Object.entries(sec.fields).filter(([key]) => !(toggle && key === "enabled"));
  return vcol(ui, { key: `card-${section}`, borderStyle: "round", borderColor: off ? C.muted : C.accent, borderDimColor: off, paddingX: 2, paddingY: 1, rowGap: 2 }, [
    vcol(ui, {}, [
      hrow(ui, { justifyContent: "space-between", alignItems: "center" }, [txt(ui, { bold: true }, sec.title), toggle]),
      txt(ui, { dimColor: true }, off ? `${sec.help} Off: the settings below are kept and apply once it is on.` : sec.help),
    ]),
    ...fields.map(([key, field]) => fieldRow(act, ui, section, key, field, values[key], width, Boolean(settings.gate.allow_opus))),
  ]);
}

/** On/off for one field, as the Off | On pair. The keys are `<field id>-off` and `<field id>-on`. */
function switchControl(act: Actions, ui: Ui, id: string, section: string, key: string, on: boolean): unknown {
  return onOff(ui, id, on, (v) => act.save(id, section, key, v));
}

/**
 * One setting: its name and help on the left, its control on the right (wrapping under on a narrow pane). Lists
 * and settings with an editor of their own take the full width under their name.
 */
function fieldRow(act: Actions, ui: Ui, section: string, key: string, field: Field, current: unknown, width: number, allowOpus: boolean): unknown {
  const id = `${section}.${key}`;
  const error = view.errors[id];
  const more = field.short !== undefined;
  const help = more && !view.open[id] ? field.short : field.help;
  const wide = field.type === "list";
  const info = vcol(ui, { flexGrow: 1, flexShrink: 1, width: wide ? "100%" : "58%" }, [
    txt(ui, { bold: true }, labelOf(key, field)),
    hrow(ui, { columnGap: 1, flexWrap: "wrap" }, [
      txt(ui, { dimColor: true }, help),
      more ? ui.Button({
        key: `${id}-help`, label: view.open[id] ? "less" : "more", plain: true, dimColor: true,
        onPress: () => {
          view.open[id] = !view.open[id];
          act.redraw();
        },
      }) : null,
    ]),
  ]);
  const body = wide
    ? vcol(ui, { rowGap: 1 }, [info, specialEditor(ui, act, id, current, allowOpus) ?? listEditor(act, ui, id, section, key, current as string[], width)])
    : hrow(ui, { justifyContent: "space-between", alignItems: "center", columnGap: 2, flexWrap: "wrap" }, [
      info, ui.Box({ flexShrink: 0, children: [control(act, ui, id, section, key, field, current)] }),
    ]);
  return vcol(ui, {}, [body, error ? txt(ui, { color: C.bad }, error) : null]);
}

function control(act: Actions, ui: Ui, id: string, section: string, key: string, field: Field, current: unknown): unknown {
  if (field.type === "bool") return switchControl(act, ui, id, section, key, Boolean(current));
  if (field.type === "enum") {
    return hrow(ui, { columnGap: 1 }, field.choices.map((c) => ui.Button({
      key: `${id}-${c}`, label: title(c), variant: c === current ? "primary" : "secondary",
      onPress: () => act.save(id, section, key, c),
    })));
  }
  const placeholder = field.type === "int" ? `${field.min} to ${field.max}` : "empty";
  return ui.Input({
    key: id, placeholder, submitLabel: "Save", value: view.drafts[id] ?? String(current),
    onInput: (text: string) => {
      view.drafts[id] = text;
    },
    onSubmit: async (text: string) => {
      const value = parseText(field, text);
      const error = validate(section, key, value);
      if (error) {
        view.errors[id] = error;
        act.redraw();
        return;
      }
      delete view.drafts[id];
      await act.save(id, section, key, value);
    },
  });
}

/** One row per entry with move-up and remove (pressed twice), then a field that adds an entry at the end. */
function listEditor(act: Actions, ui: Ui, id: string, section: string, key: string, items: string[], width: number): unknown {
  const save = (next: string[]): Promise<void> => act.save(id, section, key, next);
  const rows = items.map((item, i) => {
    const armed = view.armed === `rm:${id}:${i}:${item}`;
    return hrow(ui, { key: `${id}-row-${i}`, columnGap: 1, hover: { backgroundColor: "#8A8A8A1F" } }, [
      txt(ui, { dimColor: true }, `${String(i + 1).padStart(2)}.`),
      ui.Box({ flexGrow: 1, flexShrink: 1, children: [txt(ui, { wrap: "truncate-end" }, item)] }),
      i > 0 ? ui.Button({
        key: `${id}-up-${i}`, label: "↑", plain: true, dimColor: true,
        onPress: () => save([...items.slice(0, i - 1), item, items[i - 1], ...items.slice(i + 1)]),
      }) : null,
      ui.Button({
        key: `${id}-rm-${i}`, label: armed ? "press again to remove" : "remove", plain: true, dimColor: !armed,
        onPress: async () => {
          if (!armed) {
            view.armed = `rm:${id}:${i}:${item}`;
            act.redraw();
            return;
          }
          view.armed = "";
          await save(items.filter((_, j) => j !== i));
        },
      }),
    ].filter((c) => c !== null));
  });
  const add = ui.Input({
    key: `${id}-add`, placeholder: "add an entry", submitLabel: "Add", value: view.drafts[`${id}-add`] ?? "",
    onInput: (text: string) => {
      view.drafts[`${id}-add`] = text;
    },
    onSubmit: async (text: string) => {
      const entry = text.trim();
      if (!entry) return;
      const next = [...items, entry];
      const error = validate(section, key, next);
      if (error) {
        view.errors[id] = error;
        act.redraw();
        return;
      }
      delete view.drafts[`${id}-add`];
      await save(next);
    },
  });
  const none = items.length === 0 ? [txt(ui, { dimColor: true, italic: true }, "  None set.")] : [];
  return vcol(ui, { width }, [...none, ...rows, add]);
}
