import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { counts, decisionTasks, effectiveChoice, findTaskCycles, itemVerdict, needsRevision, orderedPhases, readiness, resolvePlanTasks, touchedFiles, verdict } from "../../engine/public/js/model.js";

const mini = () => JSON.parse(readFileSync(new URL("../fixtures/plans/mini/plan.json", import.meta.url), "utf8"));
const find = (plan, id) => plan.pages.flatMap((p) => p.decisions ?? []).find((d) => d.id === id);

test("verdict: “Change” and “Explain” require a text, a rewrite is enough", () => {
  const d = { id: "X" };
  assert.equal(verdict(d, {}), "pending");
  assert.equal(verdict(d, { status: "modify" }), "pending");
  assert.equal(verdict(d, { status: "modify", comment: "  " }), "pending");
  assert.equal(verdict(d, { status: "modify", comment: "shorter" }), "modify");
  assert.equal(verdict(d, { status: "modify", edits: { proposal: "other text" } }), "modify");
  assert.equal(verdict(d, { status: "explain" }), "pending");
  assert.equal(verdict(d, { status: "explain", comment: "why?" }), "explain");
  assert.equal(verdict(d, { status: "ko" }), "ko");
});

test("verdict of a list: item by item, a question wins", () => {
  const d = { id: "L", items: [{ id: "a" }, { id: "b" }] };
  assert.equal(verdict(d, { items: { a: { status: "ok" } } }), "pending");
  assert.equal(verdict(d, { items: { a: { status: "ok" }, b: { status: "ok" } } }), "ok");
  assert.equal(verdict(d, { items: { a: { status: "ko" }, b: { status: "ko" } } }), "ko");
  assert.equal(verdict(d, { items: { a: { status: "ok" }, b: { status: "ko" } } }), "mixed");
  assert.equal(verdict(d, { status: "explain", comment: "?", items: { a: { status: "ok" }, b: { status: "ok" } } }), "explain");
  assert.equal(itemVerdict({ items: { a: { status: "modify" } }, edits: { "items/a/detail": "new" } }, "a"), "modify");
  assert.equal(needsRevision(d, { items: { a: { status: "ok" }, b: { status: "modify", comment: "x" } } }), true);
  assert.equal(needsRevision(d, { items: { a: { status: "ok" }, b: { status: "ko" } } }), false);
});

test("effective values: the proposal when accepting without touching the control", () => {
  const plan = mini();
  assert.equal(effectiveChoice(find(plan, "D1"), { status: "ok" }), "redis");
  assert.equal(effectiveChoice(find(plan, "D1"), { status: "ok", choice: "memory" }), "memory");
});

test("tasks: chosen option, checked options, templates, rewrites, rejected items", () => {
  const plan = mini();
  const d1 = find(plan, "D1");
  assert.deepEqual(decisionTasks(d1, {}).map((t) => t.id), ["iface", "client"]);
  assert.deepEqual(decisionTasks(d1, { choice: "memory" }).map((t) => t.id), ["iface", "lru"]);
  const d2 = find(plan, "D2");
  const [ttl] = decisionTasks(d2, { value: 15 });
  assert.equal(ttl.title, "TTL of 15 min");
  assert.deepEqual(ttl.acceptance, ["A session expires after 15 min"]);
  const [edited] = decisionTasks(d2, { edits: { "tasks/ttl/title": "Adjustable expiry", "tasks/ttl/acceptance": "- First\n- Second" } });
  assert.equal(edited.title, "Adjustable expiry");
  assert.deepEqual(edited.acceptance, ["First", "Second"]);
  const d4 = find(plan, "D4");
  assert.deepEqual(decisionTasks(d4, { items: { login: { status: "ko" } } }), []);
  assert.equal(decisionTasks(d4, { items: { login: { status: "ok" } } }).length, 1);
  const d6 = find(plan, "D6");
  assert.deepEqual(decisionTasks(d6, {}).map((t) => t.id), ["banner"], "no answer: the recommended option");
  assert.deepEqual(decisionTasks(d6, { choices: ["banner", "email"] }).map((t) => t.id), ["banner", "email"]);
  assert.deepEqual(decisionTasks(d6, { choices: [] }), []);
});

test("execution plan: chosen phase order, dependencies, numbering, rejected ones left out", () => {
  const plan = mini();
  const answers = { D5: { status: "ok", order: ["p2", "p1"] }, D1: { status: "ok" }, D2: { status: "ok", value: 20 } };
  assert.deepEqual(orderedPhases(plan, answers).map((p) => p.id), ["p2", "p1"]);
  const resolved = resolvePlanTasks(plan, answers);
  assert.deepEqual(resolved.groups.map((g) => g.phase.id), ["p2", "p1"]);
  const p1 = resolved.groups[1].entries.map((e) => e.ref);
  assert.ok(p1.indexOf("D1/iface") < p1.indexOf("D2/ttl"), "ttl comes after the interface");
  assert.equal(resolved.numbers.get("D4/login-msg"), "1.1");
  assert.equal(resolved.numbers.get("D6/banner"), "1.2");
  assert.equal(resolved.numbers.get("D1/iface"), "2.1");
  assert.deepEqual(resolved.after(resolved.byRef.get("D2/ttl")), ["2.1"]);
  const rejected = resolvePlanTasks(plan, { ...answers, D1: { status: "ko" } });
  assert.ok(!rejected.byRef.has("D1/iface"));
  assert.deepEqual(touchedFiles(plan, answers).map((f) => f.path), ["src/cache/index.js", "src/cache/redis.js", "src/ui/banner.js", "src/ui/login.js"]);
});

test("cycles in “after” are detected", () => {
  const plan = mini();
  find(plan, "D1").tasks[0].after = ["D2/ttl"];
  assert.equal(findTaskCycles(plan).length, 1);
  assert.equal(findTaskCycles(mini()).length, 0);
});

test("counts and the “ready” state", () => {
  const plan = mini();
  const all = { D1: { status: "ok" }, D2: { status: "ok" }, D3: { status: "ok" }, D4: { items: { login: { status: "ok" }, profile: { status: "ko" } } }, D5: { status: "ok" }, D6: { status: "ok" } };
  assert.deepEqual(counts(plan, all), { ok: 5, modify: 0, mixed: 1, explain: 0, ko: 0, pending: 0, all: 6 });
  assert.equal(readiness(plan, all).ready, true);
  const notReady = readiness(plan, { ...all, D2: { status: "explain", comment: "why 30?" } });
  assert.deepEqual(notReady, { ready: false, pending: [], revise: ["D2"] });
});
