import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validatePlan } from "../../engine/lib/validate.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const mini = () => read("../fixtures/plans/mini/plan.json");
const decision = (plan, id) => plan.pages.flatMap((p) => p.decisions ?? []).find((d) => d.id === id);
// The fixture's extension visual (D2), which checkPlan would load from visuals/load_curve.js.
const EXTENSIONS = ["load_curve"];

test("the test plan is valid", () => {
  const { errors } = validatePlan(mini(), { visualKinds: EXTENSIONS });
  assert.deepEqual(errors, []);
});

test("errors that matter", () => {
  const plan = mini();
  delete decision(plan, "D1").why;
  decision(plan, "D2").phase = "p9";
  decision(plan, "D2").tasks[0].after = ["D1/missing"];
  decision(plan, "D4").control = { kind: "choice", options: [{ id: "a", label: "A" }] };
  plan.pages[0].id = "_summary";
  const { errors } = validatePlan(plan, { visualKinds: EXTENSIONS });
  const text = errors.join("\n");
  assert.match(text, /decision D1: critical decision without "why"/);
  assert.match(text, /decision D2: unknown phase "p9"/);
  assert.match(text, /"after" points to an unknown task "D1\/missing"/);
  assert.match(text, /items or a control, not both/);
  assert.match(text, /page _summary: missing or invalid id/);
});

test("dependency loop and unknown visual", () => {
  const plan = mini();
  decision(plan, "D1").tasks[0].after = ["D2/ttl"];
  plan.pages[1].visual = { kind: "sparkline" };
  const { errors } = validatePlan(plan, { visualKinds: EXTENSIONS });
  assert.ok(errors.some((e) => e.includes("circular dependencies")));
  assert.ok(errors.some((e) => e.includes('unknown visual "sparkline"')));
  assert.deepEqual(validatePlan(plan, { visualKinds: [...EXTENSIONS, "sparkline"] }).errors.filter((e) => e.includes("sparkline")), []);
});

test("teaching warnings", () => {
  const plan = mini();
  delete decision(plan, "D2").why;
  plan.glossary.push({ term: "Memcached", definition: "Another cache." });
  const { warnings } = validatePlan(plan, { visualKinds: EXTENSIONS });
  assert.ok(warnings.some((w) => w.includes('D2: no "why"')));
  assert.ok(warnings.some((w) => w.includes('term "Memcached" never used in the texts')));
});

test("files: created upstream = existing, created twice = flagged; Lucide icons checked; an order without tasks is allowed", () => {
  const plan = mini();
  const root = new URL("../fixtures/plans/mini/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  decision(plan, "D2").tasks[0].files = [{ path: "src/cache/index.js", op: "modify" }];
  decision(plan, "D2").tasks.push({ id: "again", title: "Create it again", files: [{ path: "src/cache/index.js", op: "create" }] });
  decision(plan, "D4").items[0].icon = "lucide:mail";
  decision(plan, "D4").items[1].icon = "lucide:does-not-exist";
  const { errors, warnings } = validatePlan(plan, { root, visualKinds: EXTENSIONS });
  assert.ok(!warnings.some((w) => w.includes("not found in the project: src/cache/index.js")), "created by D1/iface");
  assert.ok(warnings.some((w) => w.includes('"src/cache/index.js" created by several tasks (D1/iface, D2/again)')));
  assert.ok(errors.some((e) => e.includes('unknown icon "lucide:does-not-exist"')));
  assert.ok(!errors.some((e) => e.includes("lucide:mail")));
  assert.ok(!warnings.some((w) => w.startsWith("decision D5: no task")), "a phase-order decision has no task");
});
