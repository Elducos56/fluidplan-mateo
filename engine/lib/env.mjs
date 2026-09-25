// Minimal .env reader (KEY=value), no dependencies. The values never leave the server: the page
// only receives the list of configured providers, never a key.
import { existsSync, readFileSync } from "node:fs";

export function loadEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}
