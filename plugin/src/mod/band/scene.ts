/**
 * The band above the prompt as one SVG: the scenery behind, the main agent at the left, then each subagent acting out
 * its work in turn, all standing on one ground line. Pure: equal inputs give an equal string.
 */
import type { Settings } from "../../schema.ts";
import { activityOf, modelFamily } from "../crew.ts";
import type { Activity, Crew, Lead, LeadActivity, Row } from "../crew.ts";
import { H, moonPhase } from "./common.ts";
import type { TimeOfDay } from "./common.ts";
import { act } from "./acts.ts";
import type { ActName, ActResult, Headwear } from "./acts.ts";
import { f } from "./props.ts";
import { scenery } from "./scenery.ts";
import type { Season, SceneryKind, SceneryResult } from "./scenery.ts";

type Family = ReturnType<typeof modelFamily>;
type BandSettings = Settings["band"];
/** A band season: one of the six settings, "none" included. Winter draws snow and autumn falling leaves. */
export type BandSeason = "winter" | "spring" | "summer" | "autumn" | "none";
/** One bot's hover target in scene pixels; `id` is "lead" for the main agent, else the Row's id. */
export interface Spot { id: string; x: number; w: number; top: number }
/** The time of day and season the scenery shows, and the moon's phase, from the band's settings and the clock. */
export interface BandLook { time: TimeOfDay; season: BandSeason; phase: number }
/** Options for bandScene(): the drawing's width in scene pixels, the band's settings, and the clock. */
export interface BandSceneOptions { width: number; band: BandSettings; now: number }
/** A band drawing: its SVG, the bots' hover spots, the sun or moon, and how many rows did not fit. */
export interface BandScene { svg: string; spots: Spot[]; orb: SceneryResult["orb"]; overflow: number }

/** The ground the bots stand on: 8 scene pixels above the bottom edge. */
const FEET = H - 8;
const LEAD_X = 34;
const LEAD_H = 46;
/** Scene pixels between one bot's room and the next. */
const GAP = 14;
/** Scene pixels kept free at the right for the sun or moon, which opens the pane. */
const ORB_ROOM = 70;
/** A bot's height by model family; an unknown family is drawn at the smallest size. */
const HEIGHT: Record<Family, number> = { haiku: 26, sonnet: 30, opus: 34, unknown: 26 };
const UNKNOWN_COLOUR = "#8a8f9c";
const FIXED_TIMES: TimeOfDay[] = ["dawn", "day", "dusk", "night"];
const SEASONS: BandSeason[] = ["winter", "spring", "summer", "autumn", "none"];
const LEAD_ACT: Record<LeadActivity, ActName> = {
  thinking: "thinking", writing: "typing", reading: "reading", editing: "typing", running: "terminal",
  web: "searching", directing: "directing", other: "thinking",
};
const ROW_ACT: Record<Activity, ActName> = {
  thinking: "thinking", reading: "reading", editing: "typing", running: "terminal", web: "searching",
  directing: "directing", done: "done", failed: "failed",
};

/** The main agent: the crew's lead, else one that directs while anyone works and rests otherwise, on opus. */
export function leadOf(crew: Crew): Lead {
  return crew.lead ?? { state: crew.working > 0 ? "directing" : "resting", model: "opus" };
}

/** The act the main agent draws: its state, and while it works, what its latest activity looks like. */
export function leadAct(lead: Lead): ActName {
  switch (lead.state) {
    case "resting": return "resting";
    case "waiting": return "waiting";
    case "directing": return "directing";
    case "working": return LEAD_ACT[lead.activity ?? "other"];
  }
}

/** The act a subagent draws: "alarmed" past its token warning, else what its activity looks like. */
export function rowAct(row: Row): ActName {
  return row.over ? "alarmed" : ROW_ACT[activityOf(row)];
}

/**
 * The time of day and season the band shows, and the moon's phase. A fixed setting holds; live follows the clock:
 * dawn from 5 to 8, day to 17, dusk to 20, night otherwise. Season auto follows the month: winter December to
 * February, spring to May, summer to August, autumn the rest.
 */
export function bandLook(band: BandSettings, now: number): BandLook {
  const local = new Date(now);
  return { time: timeOf(String(band.sky), local.getHours()), season: seasonOf(String(band.season), local.getMonth()), phase: moonPhase(now) };
}

function timeOf(sky: string, hour: number): TimeOfDay {
  const fixed = FIXED_TIMES.find((t) => t === sky);
  if (fixed) return fixed;
  if (hour < 5 || hour >= 20) return "night";
  if (hour < 8) return "dawn";
  return hour < 17 ? "day" : "dusk";
}

function seasonOf(setting: string, month: number): BandSeason {
  const fixed = SEASONS.find((s) => s === setting);
  if (fixed) return fixed;
  if (month === 11 || month < 2) return "winter";
  if (month < 5) return "spring";
  return month < 8 ? "summer" : "autumn";
}

/** The effects the scenery draws for a season: snow in winter, leaves in autumn, none otherwise. */
const effectOf = (season: BandSeason): Season => (season === "winter" || season === "autumn" ? season : "none");

/** A bot's colour: the band's setting for its model family, grey when the family is unknown. */
function colourOf(band: BandSettings, family: Family): string {
  return family === "unknown" ? UNKNOWN_COLOUR : String(band[`${family}_color`]);
}

/** A bot drawn at its centre cx (its act was drawn at x 0): its SVG, its hover spot, and the right edge of its room. */
function placed(id: string, bot: ActResult, cx: number, h: number): { svg: string; spot: Spot; right: number } {
  const left = cx + bot.left;
  return {
    svg: `<g transform="translate(${f(cx)} 0)">${bot.svg}</g>`,
    spot: { id, x: Math.round(left), w: Math.round(bot.width), top: Math.round(FEET - h) },
    right: left + bot.width,
  };
}

/**
 * The band `width` scene pixels wide: the scenery, the main agent at LEAD_X, then each subagent in turn, GAP past the
 * one before, stopping before the room kept for the sun or moon. Rows that do not fit count as overflow.
 */
export function bandScene(crew: Crew, o: BandSceneOptions): BandScene {
  const { width, band, now } = o;
  const { time, season, phase } = bandLook(band, now);
  const background = scenery(String(band.scenery) as SceneryKind, time, {
    phase, clouds: Boolean(band.clouds), season: effectOf(season), width, idPrefix: "sky",
  });
  const lead = leadOf(crew);
  const leadFamily = modelFamily(lead.model);
  const headwear = String(band.headwear) as Headwear;
  const first = placed("lead", act(leadAct(lead), { x: 0, ground: FEET, h: LEAD_H, color: colourOf(band, leadFamily), headwear, idPrefix: "a0" }), LEAD_X, LEAD_H);
  const parts = [first.svg];
  const spots = [first.spot];
  let right = first.right;
  let drawn = 0;
  for (const row of crew.rows) {
    const family = modelFamily(row.model);
    const bot = act(rowAct(row), { x: 0, ground: FEET, h: HEIGHT[family], color: colourOf(band, family), idPrefix: `a${drawn + 1}` });
    const left = right + GAP;
    if (left + bot.width > width - ORB_ROOM) break;
    const at = placed(row.id, bot, left - bot.left, HEIGHT[family]);
    parts.push(at.svg);
    spots.push(at.spot);
    right = at.right;
    drawn++;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}">${background.svg}${parts.join("")}</svg>`;
  return { svg, spots, orb: background.orb, overflow: crew.rows.length - drawn };
}
