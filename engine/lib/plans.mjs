// Reading and writing a plan's files. One writer per file: Claude writes plan.json, the page
// writes answers.json (so does the CLI, when the round changes), the engine writes state.json.
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PLAN_ID, planDir } from "./config.mjs";
import { httpError, readJson, writeJson } from "./fsutil.mjs";

export const STATUSES = ["review", "submitted", "ready", "exported"];

export function planFiles(config, id) {
  const dir = planDir(config, id);
  return {
    dir,
    plan: path.join(dir, "plan.json"),
    answers: path.join(dir, "answers.json"),
    state: path.join(dir, "state.json"),
    rounds: path.join(dir, "rounds"),
    round: (n) => path.join(dir, "rounds", String(n)),
  };
}

export async function listPlans(config) {
  if (!existsSync(config.plansDir)) return [];
  const out = [];
  for (const entry of await readdir(config.plansDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !PLAN_ID.test(entry.name)) continue;
    const file = path.join(config.plansDir, entry.name, "plan.json");
    if (!existsSync(file)) continue;
    try {
      const plan = JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
      out.push({ id: entry.name, title: plan.title ?? entry.name });
    } catch {
      out.push({ id: entry.name, title: `${entry.name} (unreadable JSON)` });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadPlan(config, id) {
  const files = planFiles(config, id);
  if (!existsSync(files.plan)) throw httpError(404, `plan not found: ${id}`);
  const plan = await readJson(files.plan);
  // The folder is authoritative: a plan copied elsewhere keeps an id consistent with its path.
  plan.id = id;
  return plan;
}

export async function loadAnswers(config, id) {
  const answers = await readJson(planFiles(config, id).answers, {});
  return answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
}

export async function saveAnswers(config, id, answers) {
  await writeJson(planFiles(config, id).answers, answers);
}

export function defaultState() {
  return { round: 1, status: "review", opened_at: null, submitted_at: null, history: [] };
}

export async function loadState(config, id) {
  const state = { ...defaultState(), ...(await readJson(planFiles(config, id).state, {})) };
  if (!STATUSES.includes(state.status)) state.status = "review";
  return state;
}

export async function saveState(config, id, state) {
  await writeJson(planFiles(config, id).state, state);
}

// Previous versions of the decisions revised in the current round, read from the previous
// round's archive: the page derives the before / after diff from them.
export async function loadPrevious(config, id, plan, state) {
  if (state.round < 2) return {};
  const file = path.join(planFiles(config, id).round(state.round - 1), "plan.json");
  if (!existsSync(file)) return {};
  const before = await readJson(file, null);
  if (!before) return {};
  const old = new Map();
  for (const page of before.pages ?? []) for (const decision of page.decisions ?? []) old.set(decision.id, decision);
  const out = {};
  for (const page of plan.pages ?? []) {
    for (const decision of page.decisions ?? []) {
      if (decision.revision?.round === state.round && old.has(decision.id)) out[decision.id] = old.get(decision.id);
    }
  }
  return out;
}

export async function mtime(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}
