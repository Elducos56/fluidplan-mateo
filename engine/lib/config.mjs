// Where a project's plans live and where their outputs go. Precedence: CLI option, then
// `fluidplan.config.json` at the project root, then the defaults. The root is the current
// directory: the skill is global, the plans live in each project.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { httpError, isInside } from "./fsutil.mjs";

export const PLAN_ID = /^[a-z0-9][a-z0-9_-]*$/;
export const LANGS = ["fr", "en"];
export const ACCENTS = ["neutral", "blue", "green", "orange", "rose", "violet", "yellow"];
// Where plans lived before `docs/fluidplan`: a project that already has `.fluidplan/` (and no
// `docs/fluidplan/`) keeps using it, so no existing plan is lost.
export const LEGACY_PLANS_DIR = ".fluidplan";
export const DEFAULTS = {
  plansDir: "docs/fluidplan",
  outputDir: "{plansDir}/{id}",
  lang: "fr",
  accent: "neutral",
  port: 5178,
};

export function resolveConfig(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const file = path.join(root, "fluidplan.config.json");
  let fromFile = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
    } catch (error) {
      throw new Error(`fluidplan.config.json is unreadable: ${error.message}`);
    }
  }
  const merged = { ...DEFAULTS, ...fromFile };
  return {
    root,
    file: existsSync(file) ? file : null,
    plansDir: path.resolve(root, options.plans ?? fromFile.plansDir ?? defaultPlansDir(root)),
    outputDir: String(merged.outputDir),
    lang: LANGS.includes(merged.lang) ? merged.lang : DEFAULTS.lang,
    accent: ACCENTS.includes(merged.accent) ? merged.accent : DEFAULTS.accent,
    port: Number(options.port ?? process.env.FLUIDPLAN_PORT ?? merged.port) || DEFAULTS.port,
    // Cap on generated illustrations, per service and per plan: 5 at most (see lib/images.mjs).
    imagesPerProvider: merged.imagesPerProvider,
  };
}

function defaultPlansDir(root) {
  const legacy = path.join(root, LEGACY_PLANS_DIR);
  return existsSync(legacy) && !existsSync(path.join(root, DEFAULTS.plansDir)) ? LEGACY_PLANS_DIR : DEFAULTS.plansDir;
}

export function planDir(config, id) {
  if (!id || !PLAN_ID.test(id)) throw httpError(400, `invalid plan id: ${id}`);
  return path.join(config.plansDir, id);
}

// Outputs stay inside the project root (or inside the plans directory when it is served from
// elsewhere, as in the tests) and are always .md files.
export function outputPaths(config, plan) {
  const dir = path.resolve(
    config.root,
    config.outputDir.replaceAll("{plansDir}", config.plansDir).replaceAll("{id}", plan.id),
  );
  const pick = (value, name) => (value ? path.resolve(config.root, value) : path.join(dir, name));
  const out = { plan: pick(plan.output?.plan, "PLAN.md"), decisions: pick(plan.output?.decisions, "DECISIONS.md") };
  for (const [key, target] of Object.entries(out)) {
    const allowed = isInside(config.root, target) || isInside(config.plansDir, target);
    if (!allowed || path.extname(target).toLowerCase() !== ".md") {
      throw httpError(400, `output rejected (${key}): ${target}`);
    }
  }
  return out;
}
