// Illustrations: the four adapters against simulated services (no real call, no credits), the cap
// of 5 per service and per plan, the quota given back when nothing was started, the registry.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../../engine/lib/config.mjs";
import { generateImage, sniff } from "../../engine/lib/image_providers.mjs";
import { generateForPlan, imagesState, quotaOf, selectImage } from "../../engine/lib/images.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const B64 = PNG.toString("base64");
const ENV = { OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "g-test", LUDO_API_KEY: "l-test", MESHY_API_KEY: "m-test" };
const noSleep = async () => {};

// Fake fetch: a list of expected responses, each one checking the request it receives.
function fakeFetch(steps) {
  const calls = [];
  const fn = async (url, options = {}) => {
    const step = steps.shift();
    assert.ok(step, `unexpected call: ${url}`);
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    const out = typeof step === "function" ? step(url, options) : step;
    if (out.bytes) return { ok: true, status: 200, headers: new Map([["content-type", "image/png"]]), arrayBuffer: async () => out.bytes, text: async () => "" };
    return { ok: (out.status ?? 200) < 400, status: out.status ?? 200, text: async () => JSON.stringify(out.json ?? {}) };
  };
  fn.calls = calls;
  return fn;
}

test("OpenAI: model, size from the format, base64 image", async () => {
  const fetch = fakeFetch([{ json: { data: [{ b64_json: B64 }] } }]);
  const out = await generateImage(ENV, { provider: "openai", prompt: "A diagram", aspect: "16:9", transparent: true }, { fetch });
  const [call] = fetch.calls;
  assert.equal(call.url, "https://api.openai.com/v1/images/generations");
  assert.equal(call.options.headers.Authorization, "Bearer sk-test");
  assert.deepEqual({ model: call.body.model, size: call.body.size, background: call.body.background }, { model: "gpt-image-2.5-flare", size: "1536x864", background: "transparent" });
  assert.equal(sniff(out.bytes), "image/png");
  const legacy = fakeFetch([{ json: { data: [{ b64_json: B64 }] } }]);
  await generateImage({ ...ENV, OPENAI_IMAGE_MODEL: "gpt-image-1" }, { provider: "openai", prompt: "x", aspect: "16:9" }, { fetch: legacy });
  assert.equal(legacy.calls[0].body.size, "1536x1024", "gpt-image-1: fixed sizes");
});

test("Gemini: Interactions API, format, image block found wherever it is", async () => {
  const fetch = fakeFetch([{ json: { id: "i1", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "here it is" }, { type: "image", data: B64, mime_type: "image/png" }] }] } }]);
  const out = await generateImage(ENV, { provider: "gemini", prompt: "A timeline", aspect: "4:3" }, { fetch });
  const [call] = fetch.calls;
  assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(call.options.headers["x-goog-api-key"], "g-test");
  assert.equal(call.body.model, "gemini-3.1-flash-image");
  assert.deepEqual(call.body.response_format, { type: "image", mime_type: "image/png", aspect_ratio: "4:3", image_size: "1K" });
  assert.equal(out.mime, "image/png");
  const legacy = fakeFetch([{ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: B64 } }] } }] } }]);
  assert.equal((await generateImage(ENV, { provider: "gemini", prompt: "x" }, { fetch: legacy })).bytes.length, PNG.length);
});

test("Ludo: job, long-poll, download, credits", async () => {
  const fetch = fakeFetch([
    { status: 202, json: { id: "job-1" } },
    { json: { status: "running", poll_after_ms: 10 } },
    { json: { status: "succeeded", result: [{ url: "https://cdn.ludo.ai/a.png" }], credits_charged: 1 } },
    { bytes: PNG },
  ]);
  const out = await generateImage(ENV, { provider: "ludo", prompt: "An icon", aspect: "1:1" }, { fetch, sleep: noSleep });
  assert.equal(fetch.calls[0].url, "https://api.ludo.ai/api/assets/image");
  assert.equal(fetch.calls[0].options.headers.Authorization, "ApiKey l-test");
  assert.deepEqual(fetch.calls[0].body, { image_type: "art", prompt: "An icon", aspect_ratio: "ar_1_1", n: 1 });
  assert.equal(fetch.calls[1].url, "https://api.ludo.ai/api/assets/jobs/job-1?wait=60");
  assert.equal(out.credits, 1);
});

test("Meshy: text to image, polling, transparent background, charged job error", async () => {
  const fetch = fakeFetch([
    { json: { result: "t-1" } },
    { json: { status: "IN_PROGRESS", progress: 40 } },
    { json: { status: "SUCCEEDED", image_urls: ["https://assets.meshy.ai/t-1.png"], consumed_credits: 3 } },
    { bytes: PNG },
  ]);
  const out = await generateImage(ENV, { provider: "meshy", prompt: "A backdrop", aspect: "9:16", transparent: true }, { fetch, sleep: noSleep });
  assert.deepEqual(fetch.calls[0].body, { ai_model: "nano-banana", prompt: "A backdrop", aspect_ratio: "9:16", remove_background: true });
  assert.equal(fetch.calls[0].options.headers.Authorization, "Bearer m-test");
  assert.equal(out.credits, 3);
  const failed = fakeFetch([{ json: { result: "t-2" } }, { json: { status: "FAILED", task_error: { message: "rejected" } } }]);
  await assert.rejects(() => generateImage(ENV, { provider: "meshy", prompt: "x" }, { fetch: failed, sleep: noSleep }), (error) => error.charged === true && /rejected/.test(error.message));
});

test("errors: missing key, empty prompt, refusal before start (not charged), the key never shows", async () => {
  await assert.rejects(() => generateImage({}, { provider: "openai", prompt: "x" }), /OPENAI_API_KEY missing/);
  await assert.rejects(() => generateImage(ENV, { provider: "openai", prompt: "  " }), /empty prompt/);
  const refused = fakeFetch([{ status: 401, json: { error: { message: "Incorrect API key provided: sk-test" } } }]);
  await assert.rejects(() => generateImage(ENV, { provider: "openai", prompt: "x" }, { fetch: refused }), (error) => error.charged === false && error.status === 502);
});

// --- per-plan quota ------------------------------------------------------------------------------------

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plans/mini");
let root;
let config;
before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-images-"));
  cpSync(FIXTURE, path.join(root, ".fluidplan", "mini"), { recursive: true });
  const planFile = path.join(root, ".fluidplan", "mini", "plan.json");
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  plan.pages[0].visual = { kind: "image", prompt: "Diagram of the session cache, flat style", aspect: "16:9" };
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  config = resolveConfig({ root });
});
after(() => rmSync(root, { recursive: true, force: true }));

test("cap: 5 per service and per plan, never raised", () => {
  assert.equal(quotaOf({}), 5);
  assert.equal(quotaOf({ imagesPerProvider: 10 }), 5);
  assert.equal(quotaOf({ imagesPerProvider: 2 }), 2);
  assert.equal(quotaOf({ imagesPerProvider: 0 }), 0);
});

test("a plan's generations: registry, file, selected version, quota held and given back when nothing started", async () => {
  const ok = () => fakeFetch([{ json: { data: [{ b64_json: B64 }] } }]);
  const first = await generateForPlan(config, "mini", { provider: "openai", target: "page:storage" }, { env: ENV, io: { fetch: ok() } });
  assert.equal(first.item.prompt, "Diagram of the session cache, flat style", "the prompt comes from the visual");
  assert.ok(existsSync(path.join(root, ".fluidplan", "mini", first.item.file)));
  assert.equal(first.state.selected["page:storage"], first.item.id);

  // A refusal before start (invalid key) gives the quota back.
  const refused = fakeFetch([{ status: 401, json: { error: { message: "bad key" } } }]);
  await assert.rejects(() => generateForPlan(config, "mini", { provider: "openai", target: "page:storage" }, { env: ENV, io: { fetch: refused } }));
  assert.equal((await imagesState(config, "mini", ENV)).providers.find((p) => p.id === "openai").used, 1);

  for (let i = 2; i <= 5; i += 1) await generateForPlan(config, "mini", { provider: "openai", target: "page:storage" }, { env: ENV, io: { fetch: ok() } });
  const state = await imagesState(config, "mini", ENV);
  assert.deepEqual(state.providers.find((p) => p.id === "openai"), { id: "openai", label: "OpenAI (GPT Image)", configured: true, ready: true, model: "gpt-image-2.5-flare", used: 5, remaining: 0 });
  await assert.rejects(() => generateForPlan(config, "mini", { provider: "openai", target: "page:storage" }, { env: ENV, io: { fetch: ok() } }), (error) => error.status === 429 && /5 \/ 5/.test(error.message));
  assert.equal(state.providers.find((p) => p.id === "gemini").remaining, 5, "each service has its own cap");

  const chosen = await selectImage(config, "mini", { target: "page:storage", image: first.item.id });
  assert.equal(chosen.selected["page:storage"], first.item.id);
  await assert.rejects(() => generateForPlan(config, "mini", { provider: "gemini", target: "decision:D9" }, { env: ENV }), /no prompt/);
});
