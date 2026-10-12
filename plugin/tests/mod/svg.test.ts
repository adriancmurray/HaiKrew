/** anchorAnimations: looping SMIL animations start at their place in the clock's cycle; everything else is left as it was. */
import { expect, test } from "claude-code/testing";
import { anchorAnimations } from "../../src/mod/svg.ts";

test("an indefinite animate with a 4s cycle begins at minus its place in the cycle", () => {
  const svg = `<animate attributeName="opacity" values=".12;.3;.12" dur="4s" repeatCount="indefinite"/>`;
  expect(anchorAnimations(svg, 10000)).toBe(`<animate begin="-2.000s" attributeName="opacity" values=".12;.3;.12" dur="4s" repeatCount="indefinite"/>`);
});

test("an existing begin in seconds or milliseconds is kept as the offset before the cycle's place", () => {
  const seconds = `<animate attributeName="opacity" dur="4s" begin="1s" repeatCount="indefinite"/>`;
  expect(anchorAnimations(seconds, 10000)).toBe(`<animate attributeName="opacity" dur="4s" begin="-1.000s" repeatCount="indefinite"/>`);
  const millis = `<animate attributeName="opacity" dur="4s" begin="500ms" repeatCount="indefinite"/>`;
  expect(anchorAnimations(millis, 10000)).toBe(`<animate attributeName="opacity" dur="4s" begin="-1.500s" repeatCount="indefinite"/>`);
});

test("non-repeating animations and begins that are not offsets are left unchanged", () => {
  const once = `<animate attributeName="opacity" dur="4s"/>`;
  const click = `<animate attributeName="opacity" dur="4s" begin="click" repeatCount="indefinite"/>`;
  const end = `<animate attributeName="opacity" dur="4s" begin="x.end" repeatCount="indefinite"/>`;
  for (const tag of [once, click, end]) expect(anchorAnimations(tag, 10000)).toBe(tag);
});

test("animateTransform is anchored, and the markup around it is untouched", () => {
  const rect = `<rect x="1" y="2" width="1" height="1" fill="#fff"/>`;
  const moved = `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" dur="0.5s" begin="0.25s" repeatCount="indefinite"/>`;
  expect(anchorAnimations(rect + moved, 10100)).toBe(rect +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" dur="0.5s" begin="0.150s" repeatCount="indefinite"/>`);
});

test("a millisecond cycle is read in ms", () => {
  const blink = `<animate attributeName="opacity" values="1;0" dur="500ms" repeatCount="indefinite"/>`;
  expect(anchorAnimations(blink, 10100)).toBe(`<animate begin="-0.100s" attributeName="opacity" values="1;0" dur="500ms" repeatCount="indefinite"/>`);
});
