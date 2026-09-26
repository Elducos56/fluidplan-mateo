// fluidplan — local server, no dependencies (Node 20+). Serves the page and the project's plans,
// saves answers as they come in, freezes rounds and writes PLAN.md / DECISIONS.md. Listens on
// 127.0.0.1 only and rejects any foreign Host header (DNS rebinding): nothing leaves the machine.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlan } from "./lib/check.mjs";
import { httpError, safeJoin, writeJson } from "./lib/fsutil.mjs";
import { providerStatus } from "./lib/image_providers.mjs";
import { generateForPlan, imagesState, providerEnv, selectImage } from "./lib/images.mjs";
import { writeOutputs } from "./lib/outputs.mjs";
import { listPlans, loadAnswers, loadPrevious, loadState, mtime, planFiles, saveAnswers } from "./lib/plans.mjs";
import { submitRound } from "./lib/rounds.mjs";

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ENGINE, "public");
const HOST = "127.0.0.1";
const MAX_BODY = 5 * 1024 * 1024;
const PORT_TRIES = 10;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

// Kept in the system temp folder, never in the project: it holds absolute local paths, which must
// not end up in a repository that versions its plans.
export function serverInfoPath(config) {
  const key = createHash("sha256").update(config.plansDir.toLowerCase()).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), "fluidplan", `server-${key}.json`);
}

// The Host headers the server answers to: the loopback, and the Tailscale address when `serve
// --tailscale` asked for it. Anything else is refused (DNS rebinding).
export function allowedHosts(port, extraHost) {
  return new Set([`${HOST}:${port}`, `localhost:${port}`, ...(extraHost ? [`${extraHost}:${port}`] : [])]);
}

// Starts the server; tries the next ports if the first one is taken. Resolves { server, port, url }.
// extraHost: a second address to listen on (the machine's Tailscale address), off by default.
// register: write .server.json so that `serve` reuses the instance; `snap` skips it so as not to
// hide a server the person already started.
export async function startServer(config, { plan: defaultPlan, quiet = false, register = true, extraHost = null } = {}) {
  const env = providerEnv();
  let port = config.port;
  const listener = (req, res) => {
    handle(req, res).catch((error) => {
      const status = error.status ?? 500;
      if (status >= 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: error.message });
      else res.end();
    });
  };
  const server = http.createServer(listener);

  async function handle(req, res) {
    const host = String(req.headers.host ?? "");
    if (!allowedHosts(port, extraHost).has(host)) throw httpError(421, "host rejected");
    const url = new URL(req.url, `http://${HOST}:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) return api(req, res, url, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "method not allowed");
    if (pathname === "/" || pathname === "/index.html") return sendFile(res, path.join(PUBLIC, "index.html"));
    // A plan's files: its illustrations and its visual extensions, nothing else.
    const planFile = pathname.match(/^\/plans\/([a-z0-9][a-z0-9_-]*)\/((?:assets|visuals)\/.+)$/);
    if (planFile) return sendFile(res, safeJoin(planFiles(config, planFile[1]).dir, planFile[2]));
    return sendFile(res, safeJoin(PUBLIC, pathname.slice(1)));
  }

  async function api(req, res, url, pathname) {
    // Writes: same origin only, so that a page opened elsewhere cannot post anything.
    if (req.method !== "GET" && req.headers.origin && ![...allowedHosts(port, extraHost)].some((allowed) => req.headers.origin === `http://${allowed}`)) {
      throw httpError(403, "origin rejected");
    }
    const id = url.searchParams.get("id") ?? defaultPlan ?? (await listPlans(config))[0]?.id;
    switch (`${req.method} ${pathname}`) {
      case "GET /api/config": {
        const plans = await listPlans(config);
        return sendJson(res, 200, {
          plans,
          defaultPlan: defaultPlan ?? plans[0]?.id ?? null,
          lang: config.lang,
          accent: config.accent,
          providers: providerStatus(env),
        });
      }
      case "GET /api/bundle": {
        const checked = await checkPlan(config, id);
        const state = await loadState(config, id);
        return sendJson(res, 200, {
          plan: checked.plan,
          answers: await loadAnswers(config, id),
          state,
          previous: await loadPrevious(config, id, checked.plan, state),
          check: { errors: checked.errors, warnings: checked.warnings },
          images: await imagesState(config, id, env),
        });
      }
      case "GET /api/answers":
        return sendJson(res, 200, await loadAnswers(config, id));
      case "GET /api/state":
        return sendJson(res, 200, await loadState(config, id));
      // POST for `navigator.sendBeacon`, which sends the last answers when the tab closes.
      case "PUT /api/answers":
      case "POST /api/answers": {
        const state = await loadState(config, id);
        if (state.status !== "review") throw httpError(409, "round sent: answers are frozen until the next round");
        // A page left open on an old round must not overwrite the answers that were reset.
        const round = Number(url.searchParams.get("round"));
        if (round && round !== state.round) throw httpError(409, "answers from a previous round: reload the page");
        const answers = await readJsonBody(req);
        if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw httpError(400, "answers: an object is expected");
        await saveAnswers(config, id, answers);
        return sendJson(res, 200, { saved: true, at: new Date().toISOString() });
      }
      case "POST /api/submit": {
        const state = await submitRound(config, id);
        console.log(`round ${state.round} sent (${id})`);
        return sendJson(res, 200, state);
      }
      case "POST /api/export": {
        const written = await writeOutputs(config, id);
        console.log(`export: ${written.plan.path}, ${written.decisions.path}`);
        return sendJson(res, 200, written);
      }
      case "GET /api/events":
        return events(req, res, id);
      case "GET /api/images":
        return sendJson(res, 200, await imagesState(config, id, env));
      // A generation costs credits: only while a round is open, and within the plan's limit.
      case "POST /api/images": {
        const state = await loadState(config, id);
        if (state.status !== "review") throw httpError(409, "illustrations: only while a round is open");
        const body = (await readJsonBody(req)) ?? {};
        const result = await generateForPlan(config, id, body, { env });
        console.log(`illustration: ${result.path} (${body.provider})`);
        return sendJson(res, 200, result);
      }
      case "POST /api/images/select": {
        const body = (await readJsonBody(req)) ?? {};
        return sendJson(res, 200, await selectImage(config, id, body));
      }
      default:
        throw httpError(404, `unknown route: ${req.method} ${pathname}`);
    }
  }

  // Server events: the plan or the state changed on disk (Claude revises, the CLI moves to another
  // round). Modification times are compared every second: `fs.watch` is unreliable on Windows.
  async function events(req, res, id) {
    const files = planFiles(config, id);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write("retry: 2000\n\n");
    let last = { plan: await mtime(files.plan), state: await mtime(files.state) };
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks += 1;
      const now = { plan: await mtime(files.plan), state: await mtime(files.state) };
      if (now.plan !== last.plan) res.write(`event: plan\ndata: {}\n\n`);
      if (now.state !== last.state) res.write(`event: state\ndata: ${JSON.stringify(await loadState(config, id))}\n\n`);
      last = now;
      if (ticks % 15 === 0) res.write(": ping\n\n");
    }, 1000);
    req.on("close", () => clearInterval(timer));
  }

  for (let attempt = 0; attempt < PORT_TRIES; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt === PORT_TRIES - 1) throw error;
      port += 1;
    }
  }

  // Second address (Tailscale), same port and same handler. The loopback server stays the main one.
  let extraServer = null;
  if (extraHost) {
    extraServer = http.createServer(listener);
    await new Promise((resolve, reject) => {
      extraServer.once("error", reject);
      extraServer.listen(port, extraHost, () => {
        extraServer.off("error", reject);
        resolve();
      });
    });
    server.on("close", () => extraServer.close());
  }

  const query = defaultPlan ? `?plan=${encodeURIComponent(defaultPlan)}` : "";
  const url = `http://${HOST}:${port}/${query}`;
  if (register) {
    await writeJson(serverInfoPath(config), { port, pid: process.pid, root: config.root, plansDir: config.plansDir, started_at: new Date().toISOString() });
  }
  const cleanup = async () => {
    try {
      const info = JSON.parse(await readFile(serverInfoPath(config), "utf8"));
      if (info.pid === process.pid) await rm(serverInfoPath(config), { force: true });
    } catch {
      /* nothing to clean up */
    }
  };
  server.on("close", cleanup);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await cleanup();
      process.exit(0);
    });
  }
  if (!quiet) console.log(`fluidplan: ${url}  (plans: ${config.plansDir})`);
  const remoteUrl = extraHost ? `http://${extraHost}:${port}/${query}` : null;
  if (!quiet && remoteUrl) console.log(`on your phone (Tailscale): ${remoteUrl}`);
  return { server, port, url, remoteUrl };
}

async function sendFile(res, file) {
  if (!file || !existsSync(file)) throw httpError(404, "file not found");
  const body = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, "request body too large");
    chunks.push(chunk);
  }
  if (!size) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "unreadable JSON");
  }
}
