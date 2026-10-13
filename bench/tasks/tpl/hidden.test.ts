import test from "node:test";
import assert from "node:assert/strict";
import { render } from "./template.ts";
import { welcomeEmail } from "./mail.ts";

const dec = (s: string) => s.replace(/&(lt|gt|quot|amp|#39|#x27|apos);/g, (_m, e) => ({ lt: "<", gt: ">", quot: '"', amp: "&", "#39": "'", "#x27": "'", apos: "'" } as any)[e]);

test("escapes & < > \" '", () => {
  const out = render("{{x}}", { x: `<a href="x">Tom & 'Jerry'</a>` });
  assert.ok(!/[<>"']/.test(out), out);
  assert.equal(dec(out), `<a href="x">Tom & 'Jerry'</a>`);
});
test("& is escaped exactly once", () => {
  assert.equal(dec(render("{{x}}", { x: "&lt;" })), "&lt;");
  assert.ok(render("{{x}}", { x: "&lt;" }).startsWith("&amp;"));
});
test("template text itself is not escaped", () => { assert.equal(render("<p>{{x}}</p>", { x: "a" }), "<p>a</p>"); });
test("triple braces raw, double escaped, in the same template", () => {
  const out = render("{{{a}}}|{{a}}", { a: "<i>" });
  assert.equal(out.split("|")[0], "<i>"); assert.ok(!out.split("|")[1].includes("<"));
});
test("dotted paths", () => {
  assert.equal(render("{{user.name}} / {{user.address.city}}", { user: { name: "Al", address: { city: "Oslo" } } }), "Al / Oslo");
  assert.equal(render("{{{u.b}}}", { u: { b: "<b>" } }), "<b>");
});
test("dotted path through missing/null does not throw", () => {
  assert.equal(render("a{{u.x.y}}b", {}), "ab");
  assert.equal(render("a{{u.x.y}}b", { u: null }), "ab");
  assert.equal(render("a{{u.x.y}}b", { u: { x: null } }), "ab");
  assert.equal(render("a{{u.x.y}}b", { u: 5 }), "ab");
});
test("0, false and empty string are values, not missing", () => {
  assert.equal(render("{{a}}|{{b}}|{{c}}", { a: 0, b: false, c: "" }), "0|false|");
  assert.equal(render("{{u.n}}", { u: { n: 0 } }), "0");
});
test("null and undefined render empty", () => { assert.equal(render("[{{a}}{{b}}]", { a: null, b: undefined }), "[]"); });
test("missing renders empty", () => { assert.equal(render("[{{nope}}]", {}), "[]"); });
test("inherited props do not leak", () => {
  assert.equal(render("[{{constructor}}]", {}), "[]");
  assert.equal(render("[{{toString}}]", {}), "[]");
  assert.equal(render("[{{__proto__.polluted}}]", {}), "[]");
  assert.equal(render("[{{a.constructor.name}}]", { a: {} }), "[]");
  assert.equal(render("[{{length}}]", { x: 1 }), "[]");
});
test("substituted values are not re-expanded", () => {
  assert.equal(render("{{a}} {{b}}", { a: "{{b}}", b: "B" }).split(" ")[0], "{{b}}");
  assert.equal(render("{{a}}", { a: "{{{b}}}", b: "B" }), "{{{b}}}");
});
test("replacement-pattern chars in values are literal", () => {
  assert.equal(render("{{{a}}}", { a: "$& $1 $$ $` $'" }), "$& $1 $$ $` $'");
  assert.equal(render("x{{a}}y", { a: "$1$`" }), "x$1$`y");
});
test("whitespace inside braces is tolerated", () => {
  assert.equal(render("{{ x }}-{{  u.n  }}-{{{ y }}}", { x: 1, u: { n: 2 }, y: "<" }), "1-2-<");
});
test("unterminated or malformed braces stay literal", () => {
  assert.equal(render("a {{x", { x: 1 }), "a {{x");
  assert.equal(render("a {x} {{}} b", { x: 1 }), "a {x} {{}} b");
});
test("repeated and adjacent placeholders", () => { assert.equal(render("{{a}}{{a}}{{b}}", { a: 1, b: 2 }), "112"); });
test("non-string values are stringified", () => { assert.equal(render("{{a}} {{b}}", { a: 1.5, b: true }), "1.5 true"); });
test("unicode survives", () => { assert.equal(render("{{a}}", { a: "日本語 café 😀" }), "日本語 café 😀"); });
test("welcomeEmail unchanged by escaping", () => {
  assert.equal(welcomeEmail("O'Brien <x> & co", "Pro"), "Hi O'Brien <x> & co,\nThanks for joining the Pro plan.\n");
});
test("large template is fast", () => {
  const tpl = "<li>{{n}}</li>".repeat(200_000); const t = Date.now();
  const out = render(tpl, { n: "<" });
  assert.ok(Date.now() - t < 3000); assert.ok(!out.includes("<li><") && out.endsWith("</li>"));
});
