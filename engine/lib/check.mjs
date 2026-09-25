// Full check of a plan: v2 validation + visual extensions loaded in Node (their kinds, and their
// optional `validate`). An extension must not touch the DOM when it loads.
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadPlan, planFiles } from "./plans.mjs";
import { validatePlan } from "./validate.mjs";

export async function loadExtensionsNode(plan, dir) {
  const kinds = [];
  const validators = new Map();
  const problems = [];
  for (const relative of plan.extensions ?? []) {
    const file = path.join(dir, relative);
    if (!existsSync(file)) continue;
    try {
      // The query parameter bypasses the module cache: a modified extension is read again.
      const version = (await stat(file)).mtimeMs;
      const mod = await import(`${pathToFileURL(file).href}?v=${version}`);
      const defs = [mod.default ?? []].flat();
      for (const def of defs) {
        if (!def?.kind || typeof def.render !== "function") {
          problems.push(`extension ${relative}: each visual exports { kind, render }`);
          continue;
        }
        kinds.push(def.kind);
        if (typeof def.validate === "function") validators.set(def.kind, def.validate);
      }
    } catch (error) {
      problems.push(`extension ${relative} cannot be loaded in Node (${error.message})`);
    }
  }
  return { kinds, validators, problems };
}

// Built-in visuals that can check their own data (modules that do not touch the DOM on load).
async function builtinValidators() {
  const out = new Map();
  for (const name of ["risk_matrix", "diagram"]) {
    const def = (await import(`../public/js/visuals/${name}.js`)).default;
    if (typeof def.validate === "function") out.set(def.kind, def.validate);
  }
  return out;
}

export async function checkPlan(config, id) {
  const plan = await loadPlan(config, id);
  const dir = planFiles(config, id).dir;
  const { kinds, validators: extensionValidators, problems } = await loadExtensionsNode(plan, dir);
  const validators = new Map([...(await builtinValidators()), ...extensionValidators]);
  const result = validatePlan(plan, { planDir: dir, root: config.root, visualKinds: kinds, looseVisuals: problems.length > 0 });
  result.warnings.push(...problems);
  const visuals = [];
  for (const page of plan.pages ?? []) {
    if (page.visual) visuals.push([`page ${page.id}`, page.visual]);
    for (const decision of page.decisions ?? []) if (decision.visual) visuals.push([`decision ${decision.id}`, decision.visual]);
  }
  for (const [where, visual] of visuals) {
    const validate = validators.get(visual.kind);
    if (!validate) continue;
    try {
      for (const message of validate(visual, plan) ?? []) result.errors.push(`${where}: ${message}`);
    } catch (error) {
      result.warnings.push(`${where}: the check of the "${visual.kind}" extension failed (${error.message})`);
    }
  }
  return { plan, ...result };
}
