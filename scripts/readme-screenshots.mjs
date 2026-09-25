// Regenerates the README screenshots from the example project. A temporary copy is served,
// answered in a headless browser, sent, revised the way Claude would, and captured at each step.
//
//   node scripts/readme-screenshots.mjs
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "../engine/lib/browser.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "engine", "fluidplan.mjs");
const OUT = path.join(REPO, "docs", "images");
const ID = "tech-feature";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-shots-"));
cpSync(path.join(REPO, "examples", "tech-feature"), root, { recursive: true });
const planFile = path.join(root, "plans", ID, "plan.json");
const cli = (...args) => execFileSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8" });
const port = 6300 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, [CLI, "serve", "--root", root, "--port", String(port)], { stdio: "ignore", env: { ...process.env, FLUIDPLAN_ENV_FILE: "none" } });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i += 1) {
  try {
    await fetch(`${base}/api/config`);
    break;
  } catch {
    await sleep(100);
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await openBrowser({ width: 1280, height: 800 });
const js = (code) => browser.eval(`(async () => { ${code} })()`);
const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click(); return true;`);
const type = (selector, text) => js(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
// Puts an element just under the sticky header, so a viewport capture frames it.
const scrollTo = (selector, offset = 72) => js(`const el = document.querySelector(${JSON.stringify(selector)}); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - ${offset}); return true;`);
const shot = async (name) => {
  await sleep(350);
  await browser.screenshot(path.join(OUT, `${name}.png`), { fullPage: false });
  console.log(`docs/images/${name}.png`);
};
const api = async (route, options) => (await fetch(`${base}${route}`, options)).json();

try {
  // 1. The home page: the request, the numbers, how to answer.
  await browser.goto(`${base}/#/_home`, 900);
  await shot("01-home");

  // 2. A critical decision: why it matters, options with pros and cons.
  await browser.goto(`${base}/?s=2#/trigger`, 900);
  await scrollTo("#d-D1");
  await shot("02-decision");

  // 3. Answering: a change with a remark, a question.
  await click('#d-D1 input[value="in-process"]');
  await click("#d-D2 .card-footer .toggle.tone-modify");
  await type("#d-D2 .card-footer textarea.comment", "Use the user's time zone, but fall back to UTC when it is unknown.");
  await click("#d-D3 .card-footer .toggle.tone-explain");
  await type("#d-D3 .card-footer textarea.comment", "Why a separate table rather than a column on tasks?");
  await sleep(800);
  await scrollTo("#d-D2 .card-footer", 360);
  await shot("03-answer");

  // Dark theme and phone width, while round 1 is still open (every card is visible).
  await browser.goto(`${base}/?s=8&theme=dark#/sending`, 900);
  await scrollTo("#d-D5");
  await shot("09-dark");
  await browser.resize(390, 844);
  await browser.goto(`${base}/?s=9#/trigger`, 900);
  await scrollTo("#d-D1", 60);
  await shot("10-mobile");

  await browser.resize(1280, 800);

  // Everything else accepted as proposed, so round 2 only brings back what was questioned.
  const bundle = await api(`/api/bundle?id=${ID}`);
  const answers = bundle.answers;
  for (const page of bundle.plan.pages) {
    for (const decision of page.decisions ?? []) {
      if (answers[decision.id]?.status) continue;
      answers[decision.id] = decision.items?.length
        ? { items: Object.fromEntries(decision.items.map((item) => [item.id, { status: "ok" }])) }
        : { status: "ok" };
    }
  }
  await fetch(`${base}/api/answers?id=${ID}&round=1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(answers) });

  // 4. Sending the round to Claude.
  await browser.goto(`${base}/?s=4#/_summary`, 900);
  await click(".submit-button");
  await shot("04-send");
  await click("dialog.dialog .dialog-footer .btn:last-child");
  await sleep(1500);

  // Claude revises the two decisions, as the digest asks, then opens round 2.
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const find = (id) => plan.pages.flatMap((p) => p.decisions ?? []).find((d) => d.id === id);
  const d2 = find("D2");
  d2.proposal = "A task is overdue the day after its due date, **from 8 am in the user's time zone**. When the time zone is unknown, UTC is used and the settings page asks the user to confirm it.";
  d2.revision = { round: 2, note: "UTC fallback added, as you asked, with a prompt to confirm the time zone." };
  const d3 = find("D3");
  d3.why = `${d3.why} A column only remembers the last reminder: it cannot tell a daily digest from a weekly one, nor prove that a reminder was sent twice.`;
  d3.revision = { round: 2, note: "Explained: the table keeps one row per reminder, which a column cannot do." };
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  cli("next-round", "--plan", ID);
  await sleep(2500);

  // 5. Round 2: only what changed, with Claude's note and the diff.
  await browser.goto(`${base}/?s=5#/trigger`, 900);
  await click("#d-D2 .revision .btn");
  await scrollTo(".banners", 72);
  await shot("05-round-2");
  await scrollTo("#d-D2", 72);
  await shot("06-revised");

  // 6. Everything settled: the summary and the final files.
  await fetch(`${base}/api/answers?id=${ID}&round=2`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(await api(`/api/answers?id=${ID}`)), D2: { status: "ok", round: 2 }, D3: { status: "ok", round: 2 } }),
  });
  await browser.goto(`${base}/?s=6#/_summary`, 900);
  await shot("07-summary");
  await scrollTo(".summary-preview", 64);
  await shot("08-plan-md");

  if (browser.problems.length) console.log(browser.problems);
} finally {
  await browser.close();
  server.kill();
  await sleep(300);
  rmSync(root, { recursive: true, force: true });
}
