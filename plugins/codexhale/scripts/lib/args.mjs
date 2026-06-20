const BOOL_FLAGS = new Set(["--wait", "--background", "--fresh"]);
const DEFAULTS = {
  subcommand: null, wait: false, background: false, base: null, scope: null,
  model: null, resume: null, fresh: false, positional: [], reviewGate: null,
};

export function parseArgs(argv) {
  const out = { ...DEFAULTS, positional: [] };
  if (argv.length === 0) return out;
  out.subcommand = argv[0];
  const rest = argv.slice(1);

  let i = 0;
  while (i < rest.length) {
    const tok = rest[i];
    if (tok === "--enable-review-gate") { out.reviewGate = "enable"; i += 1; continue; }
    if (tok === "--disable-review-gate") { out.reviewGate = "disable"; i += 1; continue; }
    if (tok === "--base") { out.base = rest[i + 1]; i += 2; continue; }
    if (tok === "--scope") { out.scope = rest[i + 1]; i += 2; continue; }
    if (tok === "--model") { out.model = rest[i + 1]; i += 2; continue; }
    if (tok === "--resume") {
      const next = rest[i + 1];
      if (next === undefined || String(next).startsWith("--")) {
        out.resume = "continue";
        i += 1;
      } else {
        out.resume = next;
        i += 2;
      }
      continue;
    }
    if (BOOL_FLAGS.has(tok)) { out[flagKey(tok)] = true; i += 1; continue; }
    if (tok.startsWith("--")) { i += 1; continue; }
    out.positional.push(tok);
    i += 1;
  }

  if (out.subcommand === "rescue" && out.model === "fin") {
    out.model = "deepseek-v4-flash";
  }
  return out;
}

function flagKey(flag) {
  return flag.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
