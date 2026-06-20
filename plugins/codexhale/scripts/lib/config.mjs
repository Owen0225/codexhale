import fs from "node:fs";
import path from "node:path";

const DEFAULTS = { review_gate_enabled: false };

export function configPath(home) {
  return path.join(home, ".codexhale-cc", "config.json");
}

export function readConfig(home) {
  const p = configPath(home);
  if (!fs.existsSync(p)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(home, cfg) {
  const p = configPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readConfig(home);
  const merged = { ...existing, ...cfg };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}
