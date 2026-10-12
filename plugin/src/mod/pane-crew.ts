/**
 * The terminal's crew: the pixel scene as a Raster over a roster of agents, two lines
 * each: status dot, name, model, elapsed time and tool calls; then the task and the last tool.
 */
import { fmtElapsed } from "./crew.ts";
import type { Crew, Row } from "./crew.ts";
import { packCells, scene, SCENE_ROWS } from "./sprites.ts";
import { C, empty, heading, hrow, modelColor, modelName, txt, vcol, view } from "./ui.ts";
import type { Ui } from "./ui.ts";

export const SCENE_KEY = "crew-scene";

/** The terminal's crew: the Raster scene (pane.ts runs its timer) over the roster. */
export function crewTab(ui: Ui, crew: Crew, cols: number): unknown[] {
  const { px, overflow } = scene(crew, cols, view.frame);
  const picture = ui.Raster({ key: SCENE_KEY, columns: cols, rows: SCENE_ROWS, cells: packCells(px, cols) });
  if (crew.rows.length === 0) {
    return [picture, empty(ui, "No agents working.", "Crew members appear here when Claude starts a subagent.")];
  }
  const done = crew.rows.length - crew.working;
  const note = [crew.working ? `${crew.working} working` : "", done ? `${done} finished` : "", overflow ? `${overflow} not drawn` : ""]
    .filter(Boolean).join(" · ");
  return [picture, vcol(ui, { rowGap: 1 }, [heading(ui, "Crew", note), ...crew.rows.map((r) => member(ui, r, cols))])];
}

/** One agent as two lines. Finished agents are dimmed; a failed one keeps its red dot. */
function member(ui: Ui, r: Row, cols: number): unknown {
  const live = r.state === "working";
  const dot = r.state === "failed" ? C.bad : live ? C.ok : C.muted;
  const indent = "  ".repeat(r.depth);
  const calls = `${r.calls} ${r.calls === 1 ? "call" : "calls"}`;
  const detail = [r.task, r.last ? `last: ${r.last}` : ""].filter(Boolean).join(" · ");
  return vcol(ui, { key: `agent-${r.id}`, width: cols }, [
    hrow(ui, { justifyContent: "space-between" }, [
      hrow(ui, { columnGap: 1, flexShrink: 1 }, [
        txt(ui, { color: dot }, `${indent}${r.depth ? "└" : ""}●`),
        txt(ui, { bold: live, dimColor: !live, wrap: "truncate-end" }, r.name),
        txt(ui, { color: modelColor(r.model), dimColor: !live }, modelName(r.model)),
        r.rule ? txt(ui, { dimColor: true }, `via ${r.rule}`) : null,
        r.state === "failed" ? txt(ui, { color: C.bad }, "failed") : null,
      ]),
      txt(ui, { dimColor: true }, `${fmtElapsed(r.elapsedMs)} · ${calls}`),
    ]),
    detail ? txt(ui, { dimColor: true, wrap: "truncate-end" }, `${indent}  ${detail}`) : null,
  ]);
}
