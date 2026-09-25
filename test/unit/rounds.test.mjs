// Revision rounds without a browser: send, digest, plan.json revision, next round, finalization.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../../engine/lib/config.mjs";
import { loadAnswers, loadState, saveAnswers } from "../../engine/lib/plans.mjs";
import { buildDigest, finalize, nextRound, submitRound } from "../../engine/lib/rounds.mjs";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plans/mini");
let root;
let config;

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-rounds-"));
  cpSync(FIXTURE, path.join(root, ".fluidplan", "mini"), { recursive: true });
  config = resolveConfig({ root });
});
after(() => rmSync(root, { recursive: true, force: true }));

const planFile = () => path.join(root, ".fluidplan", "mini", "plan.json");

test("a full round, then finalization", async () => {
  await saveAnswers(config, "mini", {
    D1: { status: "modify", comment: "And without Redis?" },
    D2: { status: "explain", comment: "Why 30 minutes?" },
    D3: { status: "ok" },
    D4: { items: { login: { status: "ok" }, profile: { status: "modify", comment: "Later" } } },
    D6: { status: "ok", choices: ["banner", "email"] },
  });
  await submitRound(config, "mini");
  assert.equal((await loadState(config, "mini")).status, "submitted");
  await assert.rejects(() => submitRound(config, "mini"), /already sent/);

  const digest = await buildDigest(config, "mini");
  assert.deepEqual(digest.toProcess, ["D1", "D2", "D4"]);
  assert.deepEqual(digest.pending, ["D5"]);
  assert.match(digest.markdown, /### D1 · The cache engine \[critical\] — To change/);
  assert.match(digest.markdown, /- Question: "Why 30 minutes\?"/);
  assert.match(digest.markdown, /- Item `profile` \(Profile\) to change: "Later"/);
  assert.match(digest.markdown, /Dependents to re-check: D4/);
  assert.match(digest.markdown, /## Accepted \(2\) — do not touch\n\nD3, D6\n/);
  assert.ok(existsSync(path.join(root, ".fluidplan", "mini", "rounds", "1", "digest.md")));

  // With no revision set, next-round refuses.
  await assert.rejects(() => nextRound(config, "mini"), /without "revision\.round: 2"/);

  // Claude revises: D1 and D2 change, and so does D4 (the "profile" item is removed).
  const plan = JSON.parse(readFileSync(planFile(), "utf8"));
  const d = (id) => plan.pages.flatMap((p) => p.decisions).find((x) => x.id === id);
  d("D1").proposal = "An **in-memory** cache, Redis later.";
  d("D1").revision = { round: 2, note: "In-memory option offered first, as asked." };
  d("D2").why += " 30 minutes cover a typical work session.";
  d("D2").revision = { round: 2, note: "Explanation added." };
  d("D4").items = d("D4").items.filter((i) => i.id !== "profile");
  d("D4").revision = { round: 2, note: "Profile postponed." };
  writeFileSync(planFile(), JSON.stringify(plan, null, 2));

  const result = await nextRound(config, "mini");
  assert.equal(result.round, 2);
  assert.deepEqual(result.reset.sort(), ["D1", "D2", "D4"]);
  const answers = await loadAnswers(config, "mini");
  assert.equal(answers.D1, undefined);
  assert.equal(answers.D3.status, "ok", "an accepted answer survives");
  assert.deepEqual(answers.D6.choices, ["banner", "email"], "so does a multi-choice selection");
  assert.deepEqual(answers.D4.items, { login: { status: "ok" } }, "a revised list keeps its decided items");
  assert.equal((await loadState(config, "mini")).status, "review");

  await assert.rejects(() => finalize(config, "mini"), /not ready/);
  await saveAnswers(config, "mini", { ...answers, D1: { status: "ok" }, D2: { status: "ok" }, D5: { status: "ok" } });
  const written = await finalize(config, "mini");
  assert.equal(written.draft, false);
  const state = await loadState(config, "mini");
  assert.equal(state.status, "exported");
  const planMd = readFileSync(path.join(root, written.plan.path), "utf8");
  assert.doesNotMatch(planMd, /DRAFT/);
  assert.match(planMd, /round 2/);
  assert.match(planMd, /TTL of 30 min/);
  assert.match(planMd, /Expiry banner[\s\S]*Expiry e-mail/);
  const decisionsMd = readFileSync(path.join(root, written.decisions.path), "utf8");
  assert.match(decisionsMd, /- \*\*History:\*\* round 1: to change → round 2: accepted/);
  assert.match(decisionsMd, /“And without Redis\?” \(round 1\)/);
});
