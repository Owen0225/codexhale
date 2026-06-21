// Pure helpers for the debate-review engine: stable ids, per-finding status
// tagging from cross-rebuttals, and the clean/blocking verdict.

const BLOCKING = new Set(["critical", "high"]);

export function addIds(issues) {
  return issues.map(i => ({ ...i, id: `${i.file}:${i.line_range?.[0] ?? 0}:${i.category}` }));
}

function rebuttalFor(id, rebuttals) {
  return rebuttals.find(r => r.finding_id === id) || null;
}

// cwRebuttals = CodeWhale adjudicating Codex's single-model findings.
// codexRebuttals = Codex adjudicating CodeWhale's single-model findings.
export function tagFindings(issues, cwRebuttals = [], codexRebuttals = []) {
  return issues.map(issue => {
    const by = issue.found_by || [];
    if (by.includes("codewhale") && by.includes("codex")) {
      return { ...issue, status: "agreed" }; // both found it independently -- unfalsifiable here
    }
    const opposing = by.includes("codewhale") ? codexRebuttals : cwRebuttals;
    const r = rebuttalFor(issue.id, opposing);
    if (r && r.verdict === "agree") return { ...issue, status: "agreed" };
    if (r && r.verdict === "refute") return { ...issue, status: "refuted" };
    return { ...issue, status: "disputed" };
  });
}

export function computeVerdict(taggedIssues) {
  const agreedBlocking = taggedIssues.filter(i => i.status === "agreed" && BLOCKING.has(i.severity)).length;
  return {
    clean: agreedBlocking === 0,
    agreedBlocking,
    reason: agreedBlocking === 0
      ? "no agreed critical/high findings"
      : `${agreedBlocking} agreed critical/high finding(s) remain`,
  };
}
