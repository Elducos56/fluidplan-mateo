// End-to-end test of the additions for Mateo, in a headless browser, on a temporary copy of the
// test plan: reading time, keys 1 to 4, the "Resume" banner, "Everything as recommended".
//
//   node test/smoke_mateo.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, openBrowser } from "../engine/lib/browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "engine", "fluidplan.mjs");
const ID = "mini";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.stack ?? error}`);
  }
}

if (!findBrowser()) {
  console.log("skip  browser run: no Chromium-based browser found (set FLUIDPLAN_BROWSER)");
  process.exit(0);
}

const root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-mateo-smoke-"));
cpSync(path.join(HERE, "fixtures", "plans", ID), path.join(root, ".fluidplan", ID), { recursive: true });
const port = 5950 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, [CLI, "serve", "--root", root, "--port", String(port)], {
  stdio: "ignore",
  env: { ...process.env, FLUIDPLAN_ENV_FILE: "none" },
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i += 1) {
  try {
    await fetch(`${base}/api/config`);
    break;
  } catch {
    await sleep(100);
  }
}

const browser = await openBrowser({ width: 1280, height: 900 });
const js = (code) => browser.eval(`(async () => { ${code} })()`);
const api = async (route) => (await fetch(`${base}${route}`)).json();
const key = (k) => js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })); return true;`);

try {
  await check("every card shows a reading time, the header shows the time left", async () => {
    await browser.goto(`${base}/#/storage`, 900);
    const badges = await js(`return [...document.querySelectorAll("section.decision")].map((c) => /≈ \\d+ min/.test(c.querySelector(".d-meta").textContent));`);
    assert.ok(badges.length > 0 && badges.every(Boolean), "a duration on every card");
    assert.match(await js(`return document.querySelector(".remaining-badge").textContent;`), /≈ \d+ min/);
  });

  await check("key 1 accepts the active card; typing 1 in a field does not", async () => {
    const before = await js(`return document.querySelector(".remaining-badge").textContent;`);
    await js(`document.querySelector("#d-D3").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return true;`);
    await key("1");
    await sleep(800);
    assert.equal((await api(`/api/answers?id=${ID}`)).D3?.status, "ok");
    assert.notEqual(await js(`return document.querySelector(".remaining-badge").textContent;`), before, "the time left went down");
    await js(`const el = document.querySelector("#d-D1 .card-footer .toggle.tone-modify"); el.click(); return true;`);
    await js(`const t = document.querySelector("#d-D1 .card-footer textarea.comment"); t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })); return true;`);
    await sleep(700);
    assert.notEqual((await api(`/api/answers?id=${ID}`)).D1?.status, "ok", "a key typed in a field is not a verdict");
  });

  await check("after reopening, the Resume banner names the last card touched", async () => {
    await browser.goto(`${base}/?r=2#/interface`, 900);
    const banner = await js(`return document.querySelector(".resume-banner")?.textContent ?? "";`);
    assert.match(banner, /D1/);
    await js(`document.querySelector(".resume-banner .btn").click(); return true;`);
    await sleep(600);
    assert.match(await js(`return location.hash;`), /#\/storage\/d-D1/);
  });

  await check("Everything as recommended: non-critical cards accepted, critical ones left", async () => {
    await js(`document.querySelector(".accept-button").click(); return true;`);
    await sleep(300);
    await js(`document.querySelector("dialog.dialog .dialog-footer .btn:last-child").click(); return true;`);
    await sleep(900);
    const bundle = await api(`/api/bundle?id=${ID}`);
    const decisions = bundle.plan.pages.flatMap((p) => p.decisions ?? []);
    for (const d of decisions) {
      const a = bundle.answers[d.id] ?? {};
      if (d.importance === "critical") assert.ok(!a.status || a.status === "modify", `${d.id} (critical) untouched`);
      else if (d.id !== "D1") assert.ok(a.status === "ok" || Object.values(a.items ?? {}).every((i) => i.status === "ok"), `${d.id} accepted`);
    }
  });

  await check("no console error", async () => {
    assert.deepEqual(browser.problems.filter((p) => !p.includes("ERR_ABORTED")), []);
  });
} finally {
  await browser.close();
  server.kill();
  await sleep(300);
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : "\nall green");
process.exitCode = failures ? 1 : 0;
