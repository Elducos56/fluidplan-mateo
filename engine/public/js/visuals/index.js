// Visual registry. Each visual is a module { kind, render(v, ctx), validate?, css? };
// `render` returns a node, or { el, update } when the visual follows the answers. A plan's
// extensions (plans/<id>/visuals/*.js) register the same way and get everything through `ctx`:
// they import nothing from the engine.
import { h, svg } from "../dom.js";
import { icon } from "../icons.js";
import { inline, md, plain } from "../md.js";
import * as model from "../model.js";
import * as ui from "../ui.js";
import beforeAfter from "./before_after.js";
import bars from "./bars.js";
import cards from "./cards.js";
import code from "./code.js";
import compare from "./compare.js";
import diagram from "./diagram.js";
import fileTree from "./file_tree.js";
import icons from "./icons.js";
import image from "./image.js";
import matrix from "./matrix.js";
import overview from "./overview.js";
import riskMatrix from "./risk_matrix.js";
import stats from "./stats.js";
import tiers from "./tiers.js";
import timeline from "./timeline.js";

const REGISTRY = new Map();

export function registerVisual(def) {
  if (!def?.kind || typeof def.render !== "function") throw new Error("a visual exports { kind, render }");
  REGISTRY.set(def.kind, def);
  if (def.css && !document.querySelector(`style[data-visual="${def.kind}"]`)) {
    document.head.append(h("style", { "data-visual": def.kind }, def.css));
  }
}

for (const def of [overview, cards, matrix, bars, tiers, icons, image, timeline, compare, fileTree, riskMatrix, beforeAfter, diagram, code, stats]) registerVisual(def);

// What a visual receives: the page context, plus the engine's building blocks.
function visualCtx(ctx) {
  return { ...ctx, h, svg, icon, md, inline, plain, ui, model, tooltip: ui.floating };
}

export function renderVisual(visual, ctx) {
  const def = REGISTRY.get(visual.kind);
  if (!def) return { el: ui.alert({ variant: "destructive", icon: "circle-alert", title: ctx.t("visual.unknown", { kind: visual.kind }) }) };
  try {
    const out = def.render(visual, visualCtx(ctx));
    return out instanceof Node ? { el: out } : out;
  } catch (error) {
    console.error(error);
    return { el: ui.alert({ variant: "destructive", icon: "circle-alert", title: ctx.t("visual.failed", { kind: visual.kind }), description: error.message }) };
  }
}

const EXTENSION_KINDS = new Set();

export async function loadExtensions(plan, planId) {
  const problems = [];
  for (const relative of plan.extensions ?? []) {
    try {
      const mod = await import(`/plans/${encodeURIComponent(planId)}/${relative}?v=${Date.now()}`);
      for (const def of [mod.default ?? []].flat()) {
        registerVisual(def);
        EXTENSION_KINDS.add(def.kind);
      }
    } catch (error) {
      problems.push(`extension ${relative}: ${error.message}`);
    }
  }
  return problems;
}

// An extension's own `validate` runs here, in the browser: the engine never executes a plan's code
// in Node. Its messages count as plan errors, like those of `fluidplan check`.
export function validateExtensionVisuals(plan) {
  const errors = [];
  const visit = (where, visual) => {
    const def = visual && EXTENSION_KINDS.has(visual.kind) ? REGISTRY.get(visual.kind) : null;
    if (typeof def?.validate !== "function") return;
    try {
      for (const message of def.validate(visual, plan) ?? []) errors.push(`${where}: ${message}`);
    } catch (error) {
      errors.push(`${where}: the check of the "${visual.kind}" extension failed (${error.message})`);
    }
  };
  for (const page of plan.pages ?? []) {
    visit(`page ${page.id}`, page.visual);
    for (const decision of page.decisions ?? []) visit(`decision ${decision.id}`, decision.visual);
  }
  return errors;
}
