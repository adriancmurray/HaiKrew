import test from "node:test";
import assert from "node:assert/strict";
import { render } from "./template.ts";
import { welcomeEmail } from "./mail.ts";

test("plain substitution", () => assert.equal(render("a {{x}} b", { x: 1 }), "a 1 b"));
test("missing is empty", () => assert.equal(render("a{{x}}b", {}), "ab"));
test("escapes by default", () => assert.equal(render("{{x}}", { x: "<b>" }), "&lt;b&gt;"));
test("triple braces are raw", () => assert.equal(render("{{{x}}}", { x: "<b>" }), "<b>"));
test("dotted", () => assert.equal(render("{{u.name}}", { u: { name: "Al" } }), "Al"));
test("welcome email", () => assert.equal(welcomeEmail("O'Brien", "Pro"), "Hi O'Brien,\nThanks for joining the Pro plan.\n"));
