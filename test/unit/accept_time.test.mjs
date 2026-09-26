// "Everything as recommended" and the reading time: pure logic of the Store and the model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readingMinutes, remainingMinutes, verdict } from "../../engine/public/js/model.js";
import { Store } from "../../engine/public/js/store.js";

const mini = () => JSON.parse(readFileSync(new URL("../fixtures/plans/mini/plan.json", import.meta.url), "utf8"));
const all = (plan) => plan.pages.flatMap((p) => p.decisions ?? []);

test("accept as recommended: non-critical pending cards become OK, critical and answered ones are untouched", () => {
  const plan = mini();
  const critical = all(plan).filter((d) => d.importance === "critical").map((d) => d.id);
  assert.ok(critical.length, "the fixture has a critical card");
  const answered = all(plan).find((d) => d.importance !== "critical" && !d.items?.length);
  const store = new Store(plan, { [answered.id]: { status: "ko", comment: "no" } });
  const accepted = store.acceptRecommended();
  assert.ok(accepted.length > 0);
  for (const id of critical) assert.equal(store.verdict(id), "pending", `${id} stays pending`);
  assert.equal(store.answer(answered.id).status, "ko", "an answered card is not changed");
  for (const d of all(plan)) {
    if (critical.includes(d.id) || d.id === answered.id) continue;
    assert.notEqual(verdict(d, store.answer(d.id)), "pending", `${d.id} accepted`);
  }
  assert.deepEqual(store.recommendable().accept, [], "nothing left to accept");
});

test("accept as recommended keeps the recommended option: no choice is written", () => {
  const plan = mini();
  const store = new Store(plan, {});
  store.acceptRecommended();
  for (const d of all(plan)) assert.equal(store.answer(d.id).choice, undefined);
});

test("reading time: at least one minute per card, and the total drops when a card is answered", () => {
  const plan = mini();
  for (const d of all(plan)) assert.ok(readingMinutes(d) >= 1);
  const before = remainingMinutes(plan, {});
  const first = all(plan).find((d) => !d.items?.length);
  const after = remainingMinutes(plan, { [first.id]: { status: "ok" } });
  assert.equal(before - after, readingMinutes(first));
});
