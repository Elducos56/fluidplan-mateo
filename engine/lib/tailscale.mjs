// The machine's Tailscale address, for `serve --tailscale`: read from `tailscale ip -4`, accepted
// only in Tailscale's range (100.x.y.z), so the server never listens on the local network.
import { execFileSync } from "node:child_process";

const TAILSCALE_IPV4 = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseTailscaleIp(output) {
  const line = String(output ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const match = line.match(TAILSCALE_IPV4);
  if (!match || match.slice(1).some((n) => Number(n) > 255)) {
    throw new Error(`not a Tailscale address: "${line}" (expected 100.x.y.z)`);
  }
  return line;
}

export function tailscaleIp(run = () => execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8", timeout: 5000 })) {
  let output;
  try {
    output = run();
  } catch (error) {
    throw new Error(`tailscale is not available (${error.code ?? error.message}): install it or run serve without --tailscale`);
  }
  return parseTailscaleIp(output);
}
