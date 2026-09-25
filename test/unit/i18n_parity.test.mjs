// Both dictionaries have the same keys, and every key spelled out literally in the code exists.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeT } from "../../engine/public/js/i18n.js";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../engine");
const dict = (lang) => JSON.parse(readFileSync(path.join(ENGINE, "public", "i18n", `${lang}.json`), "utf8"));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(m?js)$/.test(name) ? [full] : [];
  });
}

test("fr and en have exactly the same keys", () => {
  const fr = Object.keys(dict("fr")).sort();
  const en = Object.keys(dict("en")).sort();
  assert.deepEqual(fr.filter((k) => !en.includes(k)), [], "keys missing from en.json");
  assert.deepEqual(en.filter((k) => !fr.includes(k)), [], "keys missing from fr.json");
});

test("every literal key in the code exists (singular or plural)", () => {
  const en = dict("en");
  const missing = new Set();
  for (const file of files(path.join(ENGINE, "public", "js"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"([a-zA-Z][\w.]*)"/g)) {
      const key = match[1];
      if (!(key in en) && !(`${key}_one` in en)) missing.add(`${path.basename(file)}: ${key}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("plurals: French uses the singular for 0 and 1, English only for 1", () => {
  const fr = makeT({ "x_one": "{count} item", "x_other": "{count} items" }, "fr");
  assert.equal(fr("x", { count: 0 }), "0 item");
  assert.equal(fr("x", { count: 1 }), "1 item");
  assert.equal(fr("x", { count: 2 }), "2 items");
  const en = makeT({ "x_one": "{count} item", "x_other": "{count} items" }, "en");
  assert.equal(en("x", { count: 0 }), "0 items");
  assert.equal(en("x", { count: 1 }), "1 item");
});
