/** The band's hover targets: one critter per column, so one pointer never lights two cards. */
import { expect, test } from "claude-code/testing";
import { hoverSpans } from "../../src/mod/pane-home.ts";

test("hover spans never overlap and stop short of the sun or moon", () => {
  // Critters 2 scene pixels apart on a 96-pixel scene drawn 49 columns wide: rounding outward used to overlap them.
  const toCol = (x: number) => Math.floor((x * 49) / 96);
  const spots = [{ x: 2, w: 12.6 }, { x: 22.6, w: 7 }, { x: 31.6, w: 7 }, { x: 40.6, w: 7 }, { x: 49.6, w: 8.4 }];
  const spans = hoverSpans(spots, toCol, 44);
  for (let i = 1; i < spans.length; i++) expect(spans[i].left >= spans[i - 1].left + spans[i - 1].width).toBe(true);
  for (const s of spans) expect(s.left + s.width <= 44).toBe(true);
  expect(spans.every((s) => s.width >= 1)).toBe(true);
});
