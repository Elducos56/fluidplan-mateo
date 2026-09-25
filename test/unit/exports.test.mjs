import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDecisionsMd } from "../../engine/public/js/export_decisions.js";
import { buildPlanMd } from "../../engine/public/js/export_plan.js";
import { makeT } from "../../engine/public/js/i18n.js";

const mini = () => JSON.parse(readFileSync(new URL("../fixtures/plans/mini/plan.json", import.meta.url), "utf8"));
const dict = (lang) => JSON.parse(readFileSync(new URL(`../../engine/public/i18n/${lang}.json`, import.meta.url), "utf8"));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const t = makeT(dict("en"), "en");
const now = new Date(2026, 8, 25, 14, 2);
const done = {
  D1: { status: "ok", choice: "memory" },
  D2: { status: "ok", value: 20, comment: "Shorter in staging" },
  D3: { status: "ok" },
  D4: { items: { login: { status: "ok" }, profile: { status: "ko", comment: "later" } } },
  D5: { status: "ok", order: ["p2", "p1"] },
  D6: { status: "ok" },
};
const history = [{ round: 1, answers: { D1: { status: "modify", comment: "What about without Redis?" } } }];

test("PLAN.md: phases in the chosen order, tasks of the chosen options, templates, out of scope", () => {
  const md = buildPlanMd(mini(), done, { t, now, state: { round: 2 } });
  assert.doesNotMatch(md, /DRAFT/);
  assert.match(md, /^# Session cache — execution plan/m);
  assert.match(md, /Approved on 2026-09-25 at 14:02, round 2/);
  assert.ok(md.indexOf("## Phase 1 — Interface") < md.indexOf("## Phase 2 — Foundation"));
  assert.match(md, /### \[ \] 2\.\d In-memory LRU cache · D1/);
  assert.doesNotMatch(md, /Add the Redis client/);
  assert.match(md, /### \[ \] 1\.\d Expiry banner · D6/);
  assert.doesNotMatch(md, /Expiry e-mail/);
  assert.match(md, /### \[ \] 2\.\d TTL of 20 min · D2/);
  assert.match(md, /- After: 2\.1/);
  assert.match(md, /- Remark: “Shorter in staging”/);
  assert.match(md, /`src\/cache\/lru\.js` \(create\)/);
  assert.match(md, /## Working rules\n\n- \*\*D3 · Logging\*\*/);
  assert.match(md, /## Final check\n\n- \[ \] `npm test -- cache`/);
  assert.match(md, /## Out of scope\n\n- \*\*D4\*\* \/ Profile — rejected: “later”/);
});

test("PLAN.md: DRAFT until everything is decided", () => {
  const md = buildPlanMd(mini(), { D1: { status: "modify", comment: "What about Memcached?" } }, { t, now });
  assert.match(md, /\*\*DRAFT\*\* — not every decision is made yet \(5 without an answer, 1 to rework\)/);
  assert.match(md, /Common cache interface _\(to change\)_/);
});

test("DECISIONS.md: choice, why, rejected options, remarks and history of rounds", () => {
  const md = buildDecisionsMd(mini(), done, { t, now, state: { round: 2 }, history });
  assert.match(md, /### D1 · The cache engine/);
  assert.match(md, /- \*\*Importance:\*\* Critical/);
  assert.match(md, /- \*\*Choice:\*\* In-process memory/);
  assert.match(md, /- \*\*Other options:\*\* Redis \(con: One more service to run\)/);
  assert.match(md, /- \*\*Remarks:\*\* “What about without Redis\?” \(round 1\)/);
  assert.match(md, /- \*\*History:\*\* round 1: to change → round 2: accepted/);
  assert.match(md, /- \*\*Choice:\*\* Banner in the app$/m);
  assert.match(md, /- \*\*Other options:\*\* E-mail$/m);
  assert.match(md, /\| Profile \| List of active sessions\. \| Not OK \| later \|/);
  assert.match(md, /## Glossary\n\n- \*\*TTL\*\* \(time to live\) — How long/);
});

test("table cells escape pipes and keep one line", async () => {
  const { cell } = await import("../../engine/public/js/export_common.js");
  assert.equal(cell("a | b\nc"), "a \\| b c");
  assert.equal(cell(""), " ");
});

// The expectations come from fr.json, so French stays confined to the dictionary.
test("exports in French: labels from fr.json, French typography", () => {
  const fr = dict("fr");
  const tFr = makeT(fr, "fr");
  const plan = { ...mini(), lang: "fr" };
  const planMd = buildPlanMd(plan, done, { t: tFr, now, state: { round: 2 } });
  assert.match(planMd, new RegExp(`^# ${escape(tFr("planMd.title", { title: plan.title }))}$`, "m"));
  const date = tFr("export.dateTime", { day: "2026-09-25", time: "14:02" });
  assert.match(planMd, new RegExp(escape(tFr("export.metaReady", { date, rounds: 2 }))));
  assert.match(planMd, new RegExp(`## ${escape(fr["planMd.rules"])}\n\n- \\*\\*D3 · Logging\\*\\*`));
  assert.match(planMd, new RegExp(`## ${escape(fr["planMd.outOfScope"])}\n`));
  // French puts a space before the colon.
  assert.match(planMd, new RegExp(`\n- ${escape(fr["planMd.after"])} : 2\\.1\n`));
  assert.match(planMd, new RegExp(`- ${escape(fr["planMd.remark"])} : ${escape(tFr("export.quote", { text: "Shorter in staging" }))}`));

  const decisionsMd = buildDecisionsMd(plan, done, { t: tFr, now, state: { round: 2 }, history });
  const step = (n, v) => `${tFr("round.short", { n })} : ${fr[`verdict.${v}`].toLowerCase()}`;
  assert.match(decisionsMd, new RegExp(escape(`- **${fr["decisionsMd.history"]} :** ${step(1, "modify")} → ${step(2, "ok")}`)));
  assert.match(decisionsMd, new RegExp(escape(`- **${fr["decisionsMd.importance"]} :** ${fr["importance.critical"]}`)));
});
