/**
 * The desktop's Insights card: what the recorded runs say about routing. The findings worth a look come first, then the
 * routing rules the outcomes would support, each with an Add rule button that puts it in the gate's rules. Every number
 * comes from the ledger.
 */
import type { Settings } from "../schema.ts";
import { insights, MIN_JUDGED, routingFrom } from "./insights.ts";
import { LATE_OFF_TEXT, lateOff } from "./late-file.ts";
import type { LedgerState } from "./ledger.ts";
import type { CatchRow } from "./outcomes.ts";
import { ruleSentence } from "./rules.ts";
import { foldCard, textAndControls, txt } from "./ui.ts";
import type { Actions, CardFrame, Ui } from "./ui.ts";

/** One checker catch row as a sentence: the group, then how many checked runs had a defect. */
function catchSentence(c: CatchRow): string {
  const group = `${c.job} / ${c.lang}${c.size_level ? " / " + c.size_level : ""}`;
  return `${group}: ${c.with_defects} of ${c.checked} checked runs had a defect (${Math.round(c.rate * 100)}%)`;
}

/** The Insights card, open by default. Until some model has MIN_JUDGED judged runs it says there is not enough yet. */
export function insightsSection(ui: Ui, act: Actions, frame: CardFrame, state: LedgerState, settings: Settings): unknown {
  const ins = insights(state.runs, routingFrom(settings));
  if (ins.judged < MIN_JUDGED) {
    return foldCard(ui, act, frame, "card-insights", "Insights", "", "Not enough judged runs yet", lateOff(), [
      txt(ui, {}, "Not enough judged runs yet."),
      txt(ui, { dimColor: true }, `A rule is suggested once a model has ${MIN_JUDGED} judged runs in a job and language.`),
      lateOff() ? txt(ui, { dimColor: true, wrap: "wrap" }, LATE_OFF_TEXT) : null,
    ]);
  }
  const nothing = ins.findings.length === 0 && ins.rules.length === 0 && ins.checkerCatch.length === 0;
  const summary = ins.findings[0]?.text ?? "Nothing stands out yet.";
  return foldCard(ui, act, frame, "card-insights", "Insights", `${ins.judged} judged runs`, summary, true, [
    ...ins.findings.map((f) => txt(ui, { wrap: "wrap" }, f.text)),
    ins.checkerCatch.length ? txt(ui, { bold: true }, "Checker catch rate") : null,
    ...ins.checkerCatch.map((c) => txt(ui, { wrap: "wrap" }, catchSentence(c))),
    ins.rules.length ? txt(ui, { bold: true }, "Suggested rules") : null,
    ...ins.rules.map((r, i) => textAndControls(ui, [
      txt(ui, { wrap: "wrap" }, ruleSentence(r.rule)),
      txt(ui, { dimColor: true, wrap: "wrap" }, `${r.evidence}; the rules pick ${r.current} now`),
    ], [ui.Button({ key: `insight-rule-${i}`, label: "Add rule", variant: "primary", onPress: () => act.addRule(r.rule) })])),
    nothing ? txt(ui, { dimColor: true }, "Nothing stands out yet.") : null,
    lateOff() ? txt(ui, { dimColor: true, wrap: "wrap" }, LATE_OFF_TEXT) : null,
  ]);
}
