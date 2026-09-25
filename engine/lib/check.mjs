// Full check of a plan: v2 validation, plus the built-in visuals that can check their own data.
//
// A plan's visual extensions are code that comes with the plan, possibly from a repository you do
// not control: Node never runs them. Their kinds are read from the source text, and their optional
// `validate` runs in the page, inside the browser sandbox (see public/js/visuals/index.js).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadPlan, planFiles } from "./plans.mjs";
import { validatePlan } from "./validate.mjs";

// `kind: "name"` in the module source, without executing it.
const KIND = /\bkind\s*:\s*["'`]([A-Za-z][\w-]*)["'`]/g;

export async function readExtensionKinds(plan, dir) {
  const kinds = [];
  const problems = [];
  for (const relative of plan.extensions ?? []) {
    const file = path.join(dir, relative);
    if (!existsSync(file)) continue;
    const source = await readFile(file, "utf8");
    const found = [...source.matchAll(KIND)].map((match) => match[1]);
    if (!found.length) problems.push(`extension ${relative}: no \`kind: "…"\` found in the source`);
    kinds.push(...found);
  }
  return { kinds, problems };
}

// Built-in visuals that can check their own data: engine code, safe to run.
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
  const { kinds, problems } = await readExtensionKinds(plan, dir);
  const validators = await builtinValidators();
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
      result.warnings.push(`${where}: the check of the "${visual.kind}" visual failed (${error.message})`);
    }
  }
  return { plan, ...result };
}
