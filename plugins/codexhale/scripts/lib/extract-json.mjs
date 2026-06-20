// Extract a JSON object from a model message that may have surrounding prose.
// Try a whole-string parse first (the common, well-behaved case), then fall
// back to the FIRST balanced { ... } span. The fallback matters because a chatty
// model can wrap the object in text that also contains braces -- a greedy
// first-{ to last-} match would span both and silently drop every finding.
export function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through to brace scan */ }

  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}
