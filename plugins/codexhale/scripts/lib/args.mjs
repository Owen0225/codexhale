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
    if (tok === "--base") { const v = takeValue(rest, i); out.base = v.value; i += v.consumed; continue; }
    if (tok === "--scope") { const v = takeValue(rest, i); out.scope = v.value; i += v.consumed; continue; }
    if (tok === "--model") { const v = takeValue(rest, i); out.model = v.value; i += v.consumed; continue; }
    if (tok === "--resume") {
      const v = takeValue(rest, i);
      out.resume = v.value ?? "continue"; // bare --resume (or followed by a flag) => continue most recent
      i += v.consumed;
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

// Consume the next token as a flag value, unless it is missing or is itself a flag.
function takeValue(rest, i) {
  const next = rest[i + 1];
  if (next === undefined || String(next).startsWith("--")) return { value: null, consumed: 1 };
  return { value: next, consumed: 2 };
}
