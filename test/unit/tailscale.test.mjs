// `serve --tailscale`: off by default (loopback only), a foreign Host is refused, and only a
// Tailscale address (100.x.y.z) is accepted as the second address.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../../engine/lib/config.mjs";
import { parseTailscaleIp, tailscaleIp } from "../../engine/lib/tailscale.mjs";
import { allowedHosts, startServer } from "../../engine/server.mjs";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plans/mini");
let root;
let config;
before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-tailscale-"));
  cpSync(FIXTURE, path.join(root, ".fluidplan", "mini"), { recursive: true });
  config = resolveConfig({ root, port: 6200 + Math.floor(Math.random() * 300) });
});
after(() => rmSync(root, { recursive: true, force: true }));

// A request to the loopback with a chosen Host header.
function get(port, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/config", headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

test("only a Tailscale address is accepted", () => {
  assert.equal(parseTailscaleIp("100.104.28.61\n"), "100.104.28.61");
  for (const bad of ["192.168.1.20", "10.0.0.2", "100.300.1.1", "", "fd7a:115c::1"]) {
    assert.throws(() => parseTailscaleIp(bad), /not a Tailscale address/);
  }
  assert.throws(() => tailscaleIp(() => { throw Object.assign(new Error("spawn"), { code: "ENOENT" }); }), /tailscale is not available/);
});

test("the allowed Host list gains exactly the Tailscale address, nothing else", () => {
  assert.deepEqual([...allowedHosts(5178)], ["127.0.0.1:5178", "localhost:5178"]);
  assert.deepEqual([...allowedHosts(5178, "100.1.2.3")], ["127.0.0.1:5178", "localhost:5178", "100.1.2.3:5178"]);
});

test("without --tailscale: loopback only, a foreign Host gets 421", async () => {
  const { server, port } = await startServer(config, { plan: "mini", quiet: true, register: false });
  try {
    assert.equal(server.address().address, "127.0.0.1");
    assert.equal(await get(port, `127.0.0.1:${port}`), 200);
    assert.equal(await get(port, `100.104.28.61:${port}`), 421);
    assert.equal(await get(port, `evil.example:${port}`), 421);
  } finally {
    server.close();
  }
});
