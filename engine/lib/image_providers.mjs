// Illustration generators: OpenAI, Google Gemini, Ludo.ai, Meshy. Each adapter takes a common
// request { prompt, aspect, transparent } and returns { bytes, mime, model, credits }.
//
// Endpoints read from the official docs on 2026-09-25:
//   OpenAI  POST https://api.openai.com/v1/images/generations            Bearer; data[0].b64_json
//   Gemini  POST https://generativelanguage.googleapis.com/v1beta/interactions   x-goog-api-key;
//           block { type: "image", data, mime_type } in the response
//   Ludo    POST https://api.ludo.ai/api/assets/image → id; GET /assets/jobs/{id}?wait=60
//           (Authorization: ApiKey …); result[].url
//   Meshy   POST https://api.meshy.ai/openapi/v1/text-to-image → result (job id);
//           GET …/text-to-image/{id}; image_urls, consumed_credits
//
// An error carries `charged`: false when the provider refused the request before starting a
// generation (invalid key, rejected parameter) — the plan's quota is then given back.
// Keys never leave the server and never appear in any message.

export const PROVIDERS = [
  { id: "openai", label: "OpenAI (GPT Image)", env: "OPENAI_API_KEY", modelEnv: "OPENAI_IMAGE_MODEL", model: "gpt-image-2.5-flare", docs: "https://developers.openai.com/api/docs/guides/image-generation" },
  { id: "gemini", label: "Google Gemini (Nano Banana)", env: "GEMINI_API_KEY", modelEnv: "GEMINI_IMAGE_MODEL", model: "gemini-3.1-flash-image", docs: "https://ai.google.dev/gemini-api/docs/interactions/image-generation" },
  { id: "ludo", label: "Ludo.ai", env: "LUDO_API_KEY", modelEnv: "LUDO_IMAGE_TYPE", model: "art", docs: "https://api.ludo.ai/api-docs" },
  { id: "meshy", label: "Meshy (text to image)", env: "MESHY_API_KEY", modelEnv: "MESHY_IMAGE_MODEL", model: "nano-banana", docs: "https://docs.meshy.ai/en/api/text-to-image" },
];

export const ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16"];
const MAX_PROMPT = 4000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function providerStatus(env) {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: Boolean(env[p.env]), ready: Boolean(ADAPTERS[p.id]), model: env[p.modelEnv] || p.model }));
}

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

// { provider, prompt, aspect, transparent } → { bytes, mime, model, credits }.
// io: injectable { fetch, sleep } (tests); timeoutMs caps the wait for asynchronous jobs.
export async function generateImage(env, request, io = {}) {
  const def = providerById(request.provider);
  if (!def) throw httpError(400, `unknown provider: ${request.provider}`);
  const key = env[def.env];
  if (!key) throw httpError(400, `${def.env} missing (engine/.env or environment variable)`);
  const prompt = String(request.prompt ?? "").trim();
  if (!prompt) throw httpError(400, "empty prompt");
  if (prompt.length > MAX_PROMPT) throw httpError(400, `prompt too long (${prompt.length} characters, ${MAX_PROMPT} at most)`);
  const aspect = ASPECTS.includes(request.aspect) ? request.aspect : "16:9";
  const ctx = {
    key,
    model: env[def.modelEnv] || def.model,
    env,
    prompt,
    aspect,
    transparent: Boolean(request.transparent),
    fetch: io.fetch ?? globalThis.fetch,
    sleep: io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    timeoutMs: io.timeoutMs ?? 6 * 60 * 1000,
    label: def.label,
  };
  // Simulated mode, for end-to-end tests: no network call, no credits.
  if (env.FLUIDPLAN_FAKE_IMAGES === "1") return { bytes: Buffer.from(FAKE_PNG, "base64"), mime: "image/png", model: `${ctx.model} (simulated)`, credits: 0 };
  return ADAPTERS[def.id](ctx);
}

const FAKE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// --- adapters -------------------------------------------------------------------------------------

const ADAPTERS = {
  // Free sizes (multiples of 16) for gpt-image-2 and later; fixed sizes for gpt-image-1.
  async openai(ctx) {
    const legacy = /^gpt-image-1/.test(ctx.model) || /^dall-e/.test(ctx.model);
    const sizes = legacy
      ? { "16:9": "1536x1024", "4:3": "1536x1024", "1:1": "1024x1024", "3:4": "1024x1536", "9:16": "1024x1536" }
      : { "16:9": "1536x864", "4:3": "1024x768", "1:1": "1024x1024", "3:4": "768x1024", "9:16": "864x1536" };
    const body = { model: ctx.model, prompt: ctx.prompt, size: sizes[ctx.aspect], quality: ctx.env.OPENAI_IMAGE_QUALITY || "medium", output_format: "png", n: 1 };
    if (ctx.transparent) body.background = "transparent";
    const json = await call(ctx, "https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw providerError(ctx, "response without an image (data[0].b64_json)", true);
    return { bytes: decode(ctx, b64), mime: "image/png", model: ctx.model, credits: null };
  },

  async gemini(ctx) {
    const body = {
      model: ctx.model,
      input: [{ type: "text", text: ctx.prompt }],
      response_format: { type: "image", mime_type: "image/png", aspect_ratio: ctx.aspect, image_size: ctx.env.GEMINI_IMAGE_SIZE || "1K" },
    };
    const json = await call(ctx, "https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": ctx.key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const image = findImageBlock(json);
    if (!image) throw providerError(ctx, "response without an image", true);
    return { bytes: decode(ctx, image.data), mime: image.mime ?? "image/png", model: ctx.model, credits: null };
  },

  async ludo(ctx) {
    const aspects = { "16:9": "ar_16_9", "4:3": "ar_4_3", "1:1": "ar_1_1", "3:4": "ar_3_4", "9:16": "ar_9_16" };
    const body = { image_type: ctx.model, prompt: ctx.prompt, aspect_ratio: aspects[ctx.aspect], n: 1 };
    if (ctx.env.LUDO_ART_STYLE) body.art_style = ctx.env.LUDO_ART_STYLE;
    const headers = { Authorization: `ApiKey ${ctx.key}`, "Content-Type": "application/json" };
    const created = await call(ctx, "https://api.ludo.ai/api/assets/image", { method: "POST", headers, body: JSON.stringify(body) });
    const id = created?.id;
    if (!id) throw providerError(ctx, "job without an id", true);
    // Free long-poll: the request waits up to 60 s for the final state.
    const done = await pollUntil(ctx, async () => {
      const job = await call(ctx, `https://api.ludo.ai/api/assets/jobs/${encodeURIComponent(id)}?wait=60`, { headers }, true);
      return ["succeeded", "failed", "canceled"].includes(job?.status) ? job : null;
    }, 1000);
    if (done.status !== "succeeded") throw providerError(ctx, `job ${done.status}${done.error ? `: ${JSON.stringify(done.error).slice(0, 200)}` : ""}`, true);
    const results = [done.result ?? []].flat();
    const url = results.find((r) => r?.url)?.url;
    if (!url) throw providerError(ctx, "job finished without an image", true);
    const file = await download(ctx, url);
    return { ...file, model: ctx.model, credits: Number(done.credits_charged) || null };
  },

  async meshy(ctx) {
    const body = { ai_model: ctx.model, prompt: ctx.prompt, aspect_ratio: ctx.aspect };
    if (ctx.transparent) body.remove_background = true;
    const headers = { Authorization: `Bearer ${ctx.key}`, "Content-Type": "application/json" };
    const created = await call(ctx, "https://api.meshy.ai/openapi/v1/text-to-image", { method: "POST", headers, body: JSON.stringify(body) });
    const id = created?.result;
    if (!id) throw providerError(ctx, "job without an id", true);
    const done = await pollUntil(ctx, async () => {
      const task = await call(ctx, `https://api.meshy.ai/openapi/v1/text-to-image/${encodeURIComponent(id)}`, { headers }, true);
      return ["SUCCEEDED", "FAILED", "CANCELED"].includes(task?.status) ? task : null;
    }, 4000);
    if (done.status !== "SUCCEEDED") throw providerError(ctx, `job ${done.status}${done.task_error?.message ? `: ${done.task_error.message}` : ""}`, true);
    const url = done.image_urls?.[0];
    if (!url) throw providerError(ctx, "job finished without an image", true);
    const file = await download(ctx, url);
    return { ...file, model: ctx.model, credits: Number(done.consumed_credits) || null };
  },
};

// --- helpers ----------------------------------------------------------------------------------------

// JSON call. `started`: the generation is already running (polling), so an error is charged.
async function call(ctx, url, options, started = false) {
  let response;
  try {
    response = await ctx.fetch(url, options);
  } catch (error) {
    throw providerError(ctx, `network: ${error.message}`, started);
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail = json?.error?.message ?? json?.message ?? json?.error ?? text.slice(0, 200);
    throw providerError(ctx, `HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 200)}`, started);
  }
  if (json === null) throw providerError(ctx, "unreadable response (JSON expected)", started);
  return json;
}

async function pollUntil(ctx, step, pauseMs) {
  const deadline = Date.now() + ctx.timeoutMs;
  for (;;) {
    const done = await step();
    if (done) return done;
    if (Date.now() > deadline) throw providerError(ctx, "timed out (the generation may still be running at the provider)", true);
    await ctx.sleep(pauseMs);
  }
}

async function download(ctx, url) {
  if (!/^https:\/\//.test(url)) throw providerError(ctx, "image URL is not https", true);
  let response;
  try {
    response = await ctx.fetch(url);
  } catch (error) {
    throw providerError(ctx, `download: ${error.message}`, true);
  }
  if (!response.ok) throw providerError(ctx, `download: HTTP ${response.status}`, true);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw providerError(ctx, "image too large", true);
  const mime = sniff(bytes) ?? String(response.headers?.get?.("content-type") ?? "").split(";")[0];
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw providerError(ctx, `unexpected format: ${mime || "unknown"}`, true);
  return { bytes, mime };
}

function decode(ctx, b64) {
  const bytes = Buffer.from(String(b64).replace(/^data:[^,]+,/, ""), "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw providerError(ctx, "image empty or too large", true);
  return bytes;
}

// First image block in the response, wherever it is: { type: "image", data, mime_type }
// (Interactions API) or { inlineData: { data, mimeType } } (generateContent API).
function findImageBlock(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "image" && typeof node.data === "string") return { data: node.data, mime: node.mime_type ?? node.mimeType };
  if (node.inlineData?.data) return { data: node.inlineData.data, mime: node.inlineData.mimeType };
  if (node.inline_data?.data) return { data: node.inline_data.data, mime: node.inline_data.mime_type };
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findImageBlock(value);
    if (found) return found;
  }
  return null;
}

export function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function providerError(ctx, message, charged) {
  return Object.assign(new Error(`${ctx.label}: ${message}`), { status: 502, charged });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status, charged: false });
}
