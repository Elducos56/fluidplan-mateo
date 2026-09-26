// A plan's generated illustrations, with a cap: 5 generations per service and per plan (a plan is
// only a plan). The `images.json` registry (written by the engine alone) keeps the usage per service,
// every image produced, and the version selected for each target.
//
// A target is the visual that carries the `prompt`: "page:<id>" or "decision:<id>".
// The quota is reserved before the call and given back only if the provider refused the request
// without starting a generation (`charged: false`): when in doubt, an attempt counts.
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";
import { httpError, readJson, toPosix, writeJson } from "./fsutil.mjs";
import { generateImage, PROVIDERS, providerById, providerStatus } from "./image_providers.mjs";
import { loadPlan, planFiles } from "./plans.mjs";

export const MAX_PER_PROVIDER = 5;
const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
// One generation at a time per plan in this process: two quick clicks cannot push the quota
// over its limit.
const queues = new Map();

// FLUIDPLAN_ENV_FILE points at another key file; "none" ignores engine/.env, so tests and
// screenshots do not depend on the keys configured on the machine.
// A service key is taken from engine/.env only: a key that happens to sit in the machine's
// environment (OPENAI_API_KEY set for another tool) must not turn paid illustrations on by
// accident. FLUIDPLAN_IMAGES_FROM_ENV=1 accepts environment keys explicitly.
export function providerEnv() {
  const file = process.env.FLUIDPLAN_ENV_FILE ?? path.join(ENGINE, ".env");
  const fromEnv = { ...process.env };
  if (process.env.FLUIDPLAN_IMAGES_FROM_ENV !== "1") for (const p of PROVIDERS) delete fromEnv[p.env];
  return { ...(file === "none" ? {} : loadEnv(file)), ...fromEnv };
}

// The cap is 5; fluidplan.config.json can lower it ("imagesPerProvider", 0 to turn generation off),
// never raise it.
export function quotaOf(config) {
  const wanted = Number(config.imagesPerProvider);
  return Number.isInteger(wanted) && wanted >= 0 ? Math.min(wanted, MAX_PER_PROVIDER) : MAX_PER_PROVIDER;
}

function registryPath(config, id) {
  return path.join(planFiles(config, id).dir, "images.json");
}

export async function loadRegistry(config, id) {
  const data = await readJson(registryPath(config, id), {});
  return { usage: data.usage ?? {}, items: data.items ?? [], selected: data.selected ?? {} };
}

// What the page shows: services (configured, ready, remaining), images, selected versions.
export async function imagesState(config, id, env = providerEnv()) {
  const registry = await loadRegistry(config, id);
  const quota = quotaOf(config);
  return {
    quota,
    providers: providerStatus(env).map((p) => ({ ...p, used: registry.usage[p.id] ?? 0, remaining: Math.max(0, quota - (registry.usage[p.id] ?? 0)) })),
    items: registry.items,
    selected: registry.selected,
  };
}

// A target's prompt: the one on its visual.
export function targetVisual(plan, target) {
  const [kind, targetId] = String(target ?? "").split(":");
  if (kind === "page") return plan.pages?.find((p) => p.id === targetId)?.visual ?? null;
  if (kind === "decision") {
    for (const page of plan.pages ?? []) {
      const decision = (page.decisions ?? []).find((d) => d.id === targetId);
      if (decision) return decision.visual ?? null;
    }
  }
  return null;
}

export async function generateForPlan(config, id, request, { env = providerEnv(), io } = {}) {
  const previous = queues.get(id) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => generateNow(config, id, request, { env, io }));
  queues.set(id, run);
  return run;
}

async function generateNow(config, id, request, { env, io }) {
  const plan = await loadPlan(config, id);
  const def = providerById(request.provider);
  if (!def) throw httpError(400, `unknown provider: ${request.provider}`);
  if (!/^(page|decision):[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(request.target ?? ""))) throw httpError(400, "expected target: page:<id> or decision:<id>");
  const visual = targetVisual(plan, request.target);
  const prompt = String(request.prompt ?? visual?.prompt ?? "").trim();
  if (!prompt) throw httpError(400, `no prompt for ${request.target} (neither in the request nor on its visual)`);
  if (!env[def.env]) throw httpError(400, `${def.env} missing (engine/.env or environment variable)`);

  const quota = quotaOf(config);
  const registry = await loadRegistry(config, id);
  const used = registry.usage[def.id] ?? 0;
  if (used >= quota) throw httpError(429, `${def.label}: limit reached for this plan (${used} / ${quota} generations)`);
  // Reserved before the call: a crash during the generation does not give the quota back.
  registry.usage[def.id] = used + 1;
  await writeJson(registryPath(config, id), registry);

  let result;
  try {
    result = await generateImage(env, { provider: def.id, prompt, aspect: request.aspect ?? visual?.aspect, transparent: request.transparent ?? visual?.transparent }, io);
  } catch (error) {
    if (error.charged === false) {
      const fresh = await loadRegistry(config, id);
      fresh.usage[def.id] = Math.max(0, (fresh.usage[def.id] ?? 1) - 1);
      await writeJson(registryPath(config, id), fresh);
    }
    throw error;
  }

  const slug = request.target.replace(":", "-").toLowerCase();
  const n = registry.items.filter((item) => item.target === request.target).length + 1;
  const relative = `assets/generated/${slug}-${def.id}-${n}.${EXT[result.mime] ?? "png"}`;
  const file = path.join(planFiles(config, id).dir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, result.bytes);

  const fresh = await loadRegistry(config, id);
  const item = {
    id: `${slug}-${def.id}-${n}`,
    target: request.target,
    provider: def.id,
    model: result.model,
    prompt,
    file: relative,
    mime: result.mime,
    credits: result.credits,
    at: new Date().toISOString(),
  };
  fresh.items.push(item);
  fresh.selected[request.target] = item.id;
  await writeJson(registryPath(config, id), fresh);
  return { item, path: toPosix(path.relative(config.root, file)), state: await imagesState(config, id, env) };
}

export async function selectImage(config, id, { target, image }) {
  const registry = await loadRegistry(config, id);
  const item = registry.items.find((i) => i.id === image && i.target === target);
  if (!item) throw httpError(404, `unknown image for ${target}: ${image}`);
  registry.selected[target] = item.id;
  await writeJson(registryPath(config, id), registry);
  return imagesState(config, id);
}

export function describeProviders() {
  return PROVIDERS.map((p) => `${p.id} (${p.env}${p.modelEnv ? `, model: ${p.modelEnv}` : ""})`).join(", ");
}

export function registryExists(config, id) {
  return existsSync(registryPath(config, id));
}
