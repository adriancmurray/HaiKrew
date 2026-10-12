/**
 * Settings that used to need a written code, as forms: routing rules and extra instructions built from a dropdown,
 * a field and buttons and shown as sentences; default effort as a row of buttons per model; squeeze patterns as
 * named switches with raw patterns under Custom. What is stored is the same strings as before (rules.ts converts).
 */
import { validate } from "../schema.ts";
import { buildInstruction, buildRule, effortOf, EFFORTS, KINDS, MODELS, phrase, readInstruction, readRule, SQUEEZE_PRESETS, title, withEffort } from "./rules.ts";
import type { Condition } from "./rules.ts";
import { C, hrow, modelColor, onOff, textAndControls, txt, vcol, view } from "./ui.ts";
import type { Actions, Ui } from "./ui.ts";

type Form = Record<string, string>;

/** The draft of one form, kept across redraws until it is added. */
function form(id: string): Form {
  return (view.forms[id] ??= { kind: "job", value: "", kind2: "lang", value2: "", two: "", model: "sonnet", effort: "", text: "" });
}

/** The editor for a setting that has one here, or null for the plain controls. */
export function specialEditor(ui: Ui, act: Actions, id: string, current: unknown, allowOpus: boolean): unknown | null {
  if (id === "gate.rules") return rulesEditor(ui, act, id, current as string[], allowOpus);
  if (id === "gate.instructions") return instructionsEditor(ui, act, id, current as string[]);
  if (id === "gate.default_effort") return effortEditor(ui, act, id, current as string[]);
  if (id === "squeeze.patterns") return patternsEditor(ui, act, id, current as string[]);
  return null;
}

/** Store `next` for the list field `id` after the schema accepts it; a refusal shows under the field. */
async function saveList(act: Actions, id: string, next: string[]): Promise<boolean> {
  const [section, key] = id.split(".");
  const error = validate(section, key, next);
  if (error) {
    view.errors[id] = error;
    act.redraw();
    return false;
  }
  await act.save(id, section, key, next);
  return true;
}

/** Move up and remove (asked twice) for entry `i` of a list. */
function rowActions(ui: Ui, act: Actions, id: string, items: string[], i: number): unknown[] {
  const armed = view.armed === `rm:${id}:${i}:${items[i]}`;
  return [
    i > 0 ? ui.Button({ key: `${id}-up-${i}`, label: "↑", plain: true, dimColor: true,
      onPress: () => saveList(act, id, [...items.slice(0, i - 1), items[i], items[i - 1], ...items.slice(i + 1)]) }) : null,
    ui.Button({ key: `${id}-rm-${i}`, label: armed ? "Remove?" : "✕", plain: true, dimColor: !armed,
      onPress: async () => {
        if (!armed) {
          view.armed = `rm:${id}:${i}:${items[i]}`;
          act.redraw();
          return;
        }
        view.armed = "";
        await saveList(act, id, items.filter((_, j) => j !== i));
      } }),
  ].filter((x) => x !== null);
}

/** The conditions a form describes: one, or two joined by "and". */
function formConds(f: Form): Condition[] {
  const first = [{ kind: f.kind, value: f.value }];
  return f.two ? [...first, { kind: f.kind2, value: f.value2 }] : first;
}

/** "When [kind] is [value]" with an optional second condition, as dropdowns and fields. */
function conditionRows(ui: Ui, act: Actions, id: string, f: Form): unknown[] {
  const options = KINDS.map((k) => ({ value: k.key, label: k.label }));
  const row = (n: "" | "2", lead: string): unknown => textAndControls(ui, [txt(ui, { dimColor: true }, lead)], [
    ui.Select({ key: `${id}-kind${n}`, value: f[`kind${n}`], options, onSelect: (v: string) => {
      f[`kind${n}`] = v;
      act.redraw();
    } }),
    ui.Input({ key: `${id}-value${n}`, value: f[`value${n}`], placeholder: KINDS.find((k) => k.key === f[`kind${n}`])?.key === "cwd" ? "~/projects/*" : "e.g. review",
      onInput: (v: string) => { f[`value${n}`] = v; }, onSubmit: (v: string) => { f[`value${n}`] = v; act.redraw(); } }),
    n === "" ? ui.Button({ key: `${id}-and`, label: f.two ? "− and" : "+ and", plain: true, dimColor: true, onPress: () => {
      f.two = f.two ? "" : "1";
      act.redraw();
    } }) : null,
  ], { row: { columnGap: 1, justifyContent: "flex-start", flexWrap: "wrap" }, text: { width: 6, flexGrow: 0 } });
  return [row("", "When"), f.two ? row("2", "and") : null];
}

function rulesEditor(ui: Ui, act: Actions, id: string, items: string[], allowOpus: boolean): unknown {
  const f = form(id);
  const list = items.map((rule, i) => {
    const r = readRule(rule);
    return textAndControls(ui, [hrow(ui, { columnGap: 1, flexWrap: "wrap" }, [
      txt(ui, { dimColor: true }, `${i + 1}.`),
      txt(ui, { dimColor: true }, "When"), txt(ui, {}, phrase(r.conds)), txt(ui, { dimColor: true }, "→"),
      txt(ui, { bold: true, color: modelColor(r.model) }, title(r.model)),
      r.effort ? txt(ui, { dimColor: true }, `${r.effort} effort`) : null,
      r.model === "opus" && !allowOpus ? txt(ui, { color: C.warn }, "(refused while Opus is off)") : null,
    ])], rowActions(ui, act, id, items, i), { row: { key: `${id}-row-${i}`, hover: { backgroundColor: "#8A8A8A1F" } } });
  });
  const draft = buildRule(formConds(f), f.model, f.effort);
  const add = async (): Promise<void> => {
    if (formConds(f).some((c) => c.value.trim() === "")) {
      view.errors[id] = "Fill in what the rule matches first.";
      act.redraw();
      return;
    }
    if (await saveList(act, id, [...items, draft])) delete view.forms[id];
  };
  return vcol(ui, { rowGap: 1 }, [
    vcol(ui, {}, list.length ? list : [txt(ui, { dimColor: true, italic: true }, "No rules: every agent gets the default model.")]),
    vcol(ui, { borderStyle: "round", borderDimColor: true, paddingX: 1, rowGap: 1 }, [
      txt(ui, { bold: true }, "New rule"),
      ...conditionRows(ui, act, id, f),
      textAndControls(ui, [txt(ui, { dimColor: true }, "Use")], MODELS.map((m) => ui.Button({ key: `${id}-model-${m}`, label: title(m), variant: f.model === m ? "primary" : "secondary",
        onPress: () => { f.model = m; act.redraw(); } })), { row: { justifyContent: "flex-start", flexWrap: "wrap" }, text: { width: 6, flexGrow: 0 } }),
      hrow(ui, { columnGap: 1, alignItems: "center", flexWrap: "wrap" }, [
        ui.Box({ width: 6, children: [txt(ui, { dimColor: true }, "Effort")] }),
        ui.Select({ key: `${id}-effort`, value: f.effort || "own", options: [{ value: "own", label: "Agent's own" },
          ...EFFORTS.map((e) => ({ value: e, label: title(e) }))], onSelect: (v: string) => { f.effort = v === "own" ? "" : v; act.redraw(); } }),
      ]),
      textAndControls(ui, [txt(ui, { dimColor: true, wrap: "wrap" }, f.value.trim() ? `When ${phrase(formConds(f))} → ${title(f.model)}` : "Rules are checked top to bottom; the first match wins.")],
        [ui.Button({ key: `${id}-add`, label: "Add rule", variant: "primary", onPress: add })]),
    ]),
  ]);
}

function instructionsEditor(ui: Ui, act: Actions, id: string, items: string[]): unknown {
  const f = form(id);
  const list = items.map((entry, i) => {
    const r = readInstruction(entry);
    return textAndControls(ui, [txt(ui, { dimColor: true, wrap: "wrap" }, `When ${phrase(r.conds)}, add:`), txt(ui, { italic: true, wrap: "wrap" }, r.text)],
      rowActions(ui, act, id, items, i), { row: { key: `${id}-row-${i}`, hover: { backgroundColor: "#8A8A8A1F" } } });
  });
  const add = async (): Promise<void> => {
    if (formConds(f).some((c) => c.value.trim() === "") || !f.text.trim()) {
      view.errors[id] = "Fill in what it matches and the text to add.";
      act.redraw();
      return;
    }
    if (await saveList(act, id, [...items, buildInstruction(formConds(f), f.text)])) delete view.forms[id];
  };
  return vcol(ui, { rowGap: 1 }, [
    list.length ? vcol(ui, { rowGap: 1 }, list) : txt(ui, { dimColor: true, italic: true }, "None: prompts are sent as written."),
    vcol(ui, { borderStyle: "round", borderDimColor: true, paddingX: 1, rowGap: 1 }, [
      txt(ui, { bold: true }, "New instruction"),
      ...conditionRows(ui, act, id, f),
      ui.Input({ key: `${id}-text`, label: "Add", value: f.text, placeholder: "e.g. never disable git hooks",
        onInput: (v: string) => { f.text = v; }, onSubmit: (v: string) => { f.text = v; void add(); } }),
      hrow(ui, { justifyContent: "flex-end" }, [ui.Button({ key: `${id}-add`, label: "Add instruction", variant: "primary", onPress: add })]),
    ]),
  ]);
}

/** One row per model: its own effort, or a fixed one, as buttons. */
function effortEditor(ui: Ui, act: Actions, id: string, items: string[]): unknown {
  return vcol(ui, { rowGap: 1 }, MODELS.map((m) => {
    const current = effortOf(items, m);
    return textAndControls(ui, [ui.Box({ width: 10, flexDirection: "row", columnGap: 1, children: [txt(ui, { color: modelColor(m) }, "●"), txt(ui, {}, title(m))] })],
      ["", ...EFFORTS].map((e) => ui.Button({
        key: `${id}-${m}-${e || "own"}`, label: e ? title(e) : "Own", variant: current === e ? "primary" : "secondary",
        onPress: () => saveList(act, id, withEffort(items, m, e)),
      })), { row: { justifyContent: "flex-start", flexWrap: "wrap" }, text: { width: 10, flexGrow: 0 } });
  }));
}

/** The default patterns as named switches, then any custom patterns with a field to add one. */
function patternsEditor(ui: Ui, act: Actions, id: string, items: string[]): unknown {
  const presets = SQUEEZE_PRESETS.map((p, i) => {
    const on = items.includes(p.pattern);
    return textAndControls(ui, [txt(ui, { dimColor: !on }, p.label)],
      [onOff(ui, `${id}-preset-${i}`, on, (v) => saveList(act, id, v ? [...items, p.pattern] : items.filter((x) => x !== p.pattern)))],
      { row: { key: `${id}-p-${i}`, hover: { backgroundColor: "#8A8A8A1F" } } });
  });
  const known = new Set(SQUEEZE_PRESETS.map((p) => p.pattern));
  const custom = items.map((p, i) => [p, i] as const).filter(([p]) => !known.has(p));
  return vcol(ui, { rowGap: 1 }, [
    vcol(ui, {}, presets),
    vcol(ui, {}, [
      txt(ui, { dimColor: true }, "Custom (a regular expression matched against the start of a command)"),
      ...custom.map(([p, i]) => textAndControls(ui, [ui.Code({ source: p, language: "regex" })], rowActions(ui, act, id, items, i))),
      ui.Input({ key: `${id}-add`, placeholder: "^bazel test\\b", submitLabel: "Add", value: view.forms[id]?.text ?? "",
        onInput: (v: string) => { form(id).text = v; },
        onSubmit: async (v: string) => {
          if (v.trim() && (await saveList(act, id, [...items, v.trim()]))) delete view.forms[id];
        } }),
    ]),
  ]);
}
