// Checks added for Mateo's copy: page cap, readable proposals (whatever the writing style),
// a visual on every non-minor card, and no glossary entry for a word the reader already knows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sentencesOf, validatePlan } from "../../engine/lib/validate.mjs";

const card = (id, extra = {}) => ({
  id,
  title: `Card ${id}`,
  why: "It matters.",
  proposal: "One short proposal.",
  visual: { kind: "stats", stats: [{ label: "x", value: "1" }] },
  tasks: [{ id: "t", title: "Do it" }],
  ...extra,
});
const plan = (decisions, extra = {}) => ({ version: 2, id: "p", title: "P", context: "c", pages: [{ id: "a", title: "A", decisions }], ...extra });
const warningsOf = (p) => validatePlan(p).warnings.join("\n");

test("page cap: 4 non-minor cards pass, a fifth warns", () => {
  assert.doesNotMatch(warningsOf(plan(["A", "B", "C", "D"].map((id) => card(id)))), /non-minor decisions/);
  assert.match(warningsOf(plan(["A", "B", "C", "D", "E"].map((id) => card(id)))), /5 non-minor decisions: aim for 3 to 4 per page/);
});

test("a proposal of 5 sentences warns, 4 does not", () => {
  assert.match(warningsOf(plan([card("A", { proposal: "Un. Deux. Trois. Quatre. Cinq." })])), /proposal of 5 sentences/);
  assert.doesNotMatch(warningsOf(plan([card("A", { proposal: "Un. Deux. Trois. Quatre." })])), /proposal of/);
});

test("a sentence over 30 words warns", () => {
  const long = Array.from({ length: 31 }, (_, i) => `mot${i}`).join(" ") + ".";
  assert.match(warningsOf(plan([card("A", { why: long })])), /1 sentence\(s\) over 30 words/);
});

test("no warning about bold or parentheses: no style rule is hard-coded", () => {
  const text = warningsOf(plan([card("A", { proposal: "**Un** **deux** **trois** (*hook*) et (*cron*)." })]));
  assert.doesNotMatch(text, /bold|gras|parenthes/i);
});

test("a non-minor card without a visual warns, a minor one does not", () => {
  assert.match(warningsOf(plan([card("A", { visual: undefined })])), /decision A: no visual/);
  assert.doesNotMatch(warningsOf(plan([card("A"), card("M", { importance: "minor", visual: undefined })])), /decision M: no visual/);
});

test("a known word in the glossary warns", () => {
  const p = plan([card("A", { proposal: "Un ADR court." })], { glossary: [{ term: "ADR", definition: "Une décision écrite." }] });
  assert.match(warningsOf(p), /term "ADR" is already known/);
});

test("sentences: code spans and list markers do not split or count", () => {
  assert.deepEqual(sentencesOf("Lance `a.b.c`. Puis:\n- deux"), ["Lance code.", "Puis:", "deux"]);
});
