// Merge two review outputs (each { summary?, issues[] }) into one.
// Dedupe by (file, category, overlapping line_range). Deterministic, no LLM.

function rangesOverlap(a, b) {
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  return a[0] <= b[1] && b[0] <= a[1];
}

function sameKey(x, y) {
  return x.file === y.file && x.category === y.category && rangesOverlap(x.line_range, y.line_range);
}

export function mergeFindings(codewhaleOut, codexOut) {
  const cwIssues = (codewhaleOut?.issues ?? []).map(i => ({ ...i, found_by: ["codewhale"] }));
  const codexIssues = (codexOut?.issues ?? []).map(i => ({ ...i, found_by: ["codex"] }));

  const merged = [];
  const used = new Set();

  for (const cw of cwIssues) {
    const matchIdx = codexIssues.findIndex((c, idx) => !used.has(idx) && sameKey(cw, c));
    if (matchIdx >= 0) {
      used.add(matchIdx);
      const cx = codexIssues[matchIdx];
      merged.push({
        ...cw,
        found_by: ["codewhale", "codex"],
        descriptions: [cw.description, cx.description],
        description: cw.description,
      });
    } else {
      merged.push(cw);
    }
  }
  for (let i = 0; i < codexIssues.length; i++) {
    if (!used.has(i)) merged.push(codexIssues[i]);
  }

  // Mark disputed: a file+category appearing in one model's issues where the other model
  // reviewed the same file but did NOT report that category => disputed.
  const cwFiles = new Set(cwIssues.map(i => i.file));
  const codexFiles = new Set(codexIssues.map(i => i.file));
  const mergedWithDisputed = merged.map(issue => {
    const otherReviewedFile =
      (issue.found_by.includes("codewhale") && codexFiles.has(issue.file)) ||
      (issue.found_by.includes("codex") && cwFiles.has(issue.file));
    if (issue.found_by.length === 1 && otherReviewedFile) {
      return { ...issue, disputed: true };
    }
    return issue;
  });

  const summary = [codewhaleOut?.summary, codexOut?.summary].filter(Boolean).join(" | ");
  return { summary: summary || "", issues: mergedWithDisputed };
}

export function renderMergedReport(merged) {
  const byFile = new Map();
  for (const i of merged.issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  const lines = [];
  lines.push(`# Codexhale review`);
  if (merged.summary) lines.push(`\n${merged.summary}`);
  lines.push(`\n${merged.issues.length} issue(s) from codewhale + codex.\n`);
  for (const [file, issues] of byFile) {
    lines.push(`## ${file}`);
    for (const i of issues) {
      const tag = i.found_by.length === 2
        ? "[cw+codex]"
        : (i.disputed ? "[disputed]" : (i.found_by[0] === "codewhale" ? "[cw]" : "[codex]"));
      const loc = i.line_range ? `:${i.line_range[0]}-${i.line_range[1]}` : "";
      lines.push(`- ${tag} ${i.severity} ${i.category}${loc} — ${i.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
