// Markdown renderer for one debate round. Kept separate from merge.mjs so the
// existing report shape (and its tests) stay untouched.

export function renderDebateReport(taggedIssues, verdict) {
  const byFile = new Map();
  for (const i of taggedIssues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  const lines = ["# Codexhale debate review", ""];
  lines.push(`${taggedIssues.length} finding(s) after CodeWhale + Codex cross-examination.`, "");
  for (const [file, issues] of byFile) {
    lines.push(`## ${file}`);
    for (const i of issues) {
      const loc = i.line_range ? `:${i.line_range[0]}-${i.line_range[1]}` : "";
      lines.push(`- [${i.status}] ${i.severity} ${i.category}${loc} - ${i.description}`);
    }
    lines.push("");
  }
  lines.push("## Verdict");
  lines.push(verdict.clean ? `clean - ${verdict.reason}` : `BLOCKING - ${verdict.reason}`);
  lines.push("");
  return lines.join("\n");
}
