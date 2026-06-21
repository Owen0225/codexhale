// Cross-rebuttal stage of the debate round: each model adjudicates the OTHER
// model's single-model findings. Default posture: agree unless a concrete,
// code-cited counter-argument exists. Models stay read-only and add no new issues.
import { buildReviewArgv, runCodewhale, parseStreamJson } from "./codewhale.mjs";
import { runCodex, parseReviewOutput } from "./codex.mjs";

function diffTarget(base) {
  return base
    ? `Review target: the diff of the current branch vs base \`${base}\` (run \`git diff ${base}...HEAD\`).`
    : `Review target: the current uncommitted changes (run \`git status --short\` and \`git diff\`).`;
}

export function buildRebuttalInstruction(role, opponentFindings, base) {
  const findings = JSON.stringify(opponentFindings ?? [], null, 2);
  return [
    `You are the ${role} reviewer adjudicating another model's findings. ${diffTarget(base)}`,
    `Opponent findings (JSON; each has a stable "id"):`,
    findings,
    `For EACH opponent finding: open the referenced file and line range with read_file, then decide.`,
    `Default posture: AGREE unless you have a concrete, code-cited counter-argument. Do not introduce new issues. Do not modify files.`,
    `Return ONLY a JSON object: {"rebuttals":[{"finding_id":"<id>","verdict":"agree"|"refute","reason":"<one sentence>","evidence_file":"<path>","evidence_line_range":[start,end]}]}`,
  ].join("\n\n");
}

export function buildCodexRebuttalArgv(role, opponentFindings, base) {
  // Plain `codex exec` (NOT `exec review`) so the rebuttal instruction is honored.
  return ["exec", "--json", "--sandbox", "read-only", buildRebuttalInstruction(role, opponentFindings, base)];
}

export function parseRebuttalOutput(parsedObj) {
  const arr = parsedObj?.rebuttals;
  if (!Array.isArray(arr)) return [];
  return arr.filter(r => r && typeof r.finding_id === "string" && (r.verdict === "agree" || r.verdict === "refute"));
}

export async function runCodewhaleRebuttal(rubric, opponentFindings, base, { cwd, runner } = {}) {
  if (!opponentFindings || opponentFindings.length === 0) return [];
  const run = runner ?? runCodewhale;
  const argv = buildReviewArgv({
    rubric,
    instruction: buildRebuttalInstruction("codewhale", opponentFindings, base),
    maxTurns: Math.max(20, opponentFindings.length * 2),
  });
  const res = await run(argv, { cwd });
  return parseRebuttalOutput(parseStreamJson(res.stdout));
}

export async function runCodexRebuttal(opponentFindings, base, { cwd, runner } = {}) {
  if (!opponentFindings || opponentFindings.length === 0) return [];
  const run = runner ?? runCodex;
  const res = await run(buildCodexRebuttalArgv("codex", opponentFindings, base), { cwd });
  return parseRebuttalOutput(parseReviewOutput(res.stdout));
}
