export function buildReviewInstruction({ base, focus, adversarial }) {
  const target = base
    ? `Review the changes on the current branch compared to base \`${base}\`. Run \`git diff ${base}...HEAD\` and \`git log --oneline ${base}..HEAD\` to see them.`
    : `Review the current uncommitted changes. Run \`git status --short --untracked-files=all\`, \`git diff --cached\`, and \`git diff\` to see them. Treat untracked files as in scope.`;

  const framing = adversarial
    ? `Challenge the chosen implementation and design. Pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would be safer or simpler. Do not just describe the code — question it.`
    : `Review for correctness, bugs, security, and maintainability. Report concrete issues with file and line references.`;

  const focusLine = focus ? `\n\nFocus: ${focus}` : "";

  return `${framing}\n\n${target}\n\nRead referenced files with read_file to verify your claims. Report findings as a JSON object matching the review-output schema (issues array with file, line_range, category, severity, description).${focusLine}`;
}
