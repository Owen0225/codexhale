#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { readConfig, writeConfig } from "./lib/config.mjs";
import { createJob, updateJob, readJob, listJobsForRepo } from "./lib/jobs.mjs";
import { buildReviewInstruction } from "./lib/review-prompt.mjs";
import { buildReviewArgv as cwReviewArgv, buildRescueArgv, runCodewhale, parseStreamJson } from "./lib/codewhale.mjs";
import { buildReviewArgv as codexReviewArgv, runCodex, parseReviewOutput } from "./lib/codex.mjs";
import { mergeFindings, renderMergedReport } from "./lib/merge.mjs";
import { checkCli } from "./lib/check-cli.mjs";
import { addIds, tagFindings, computeVerdict } from "./lib/status-tag.mjs";
import { runCodewhaleRebuttal, runCodexRebuttal } from "./lib/debate.mjs";
import { renderDebateReport } from "./lib/debate-report.mjs";

const HOME = os.homedir();
const BLOCKING = new Set(["critical", "high"]);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readPrompt(name) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "prompts", name), "utf8");
}

function repoKey() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.subcommand) {
    case "review":
    case "adversarial-review":
      return runReview(opts);
    case "debate-review":
      return runDebateReview(opts);
    case "rescue":
      return runRescue(opts);
    case "status":
      return runStatus(opts);
    case "result":
      return runResult(opts);
    case "cancel":
      return runCancel(opts);
    case "setup":
      return runSetup(opts);
    case "__noop_session_start":
      process.exit(0);
    default:
      process.stderr.write(`unknown subcommand: ${opts.subcommand}\n`);
      process.exit(2);
  }
}

async function runReview(opts) {
  const adversarial = opts.subcommand === "adversarial-review";
  const rubricFile = adversarial ? "adversarial-review.md" : "review.md";
  const rubric = readPrompt(rubricFile);
  const instruction = buildReviewInstruction({ base: opts.base, focus: opts.positional.join(" "), adversarial });
  const cwd = process.cwd();
  const job = createJob(HOME, { kind: opts.subcommand, repo: repoKey(), cc_task_id: null });

  const cwPromise = runCodewhale(cwReviewArgv({ rubric, instruction, maxTurns: 50 }), { cwd });
  const codexPromise = runCodex(codexReviewArgv({ base: opts.base, focus: opts.positional.join(" ") || null }), { cwd });

  const [cw, cx] = await Promise.allSettled([cwPromise, codexPromise]);
  const cwRes = cw.status === "fulfilled" ? cw.value : { code: -1, stdout: "", stderr: String(cw.reason) };
  const cxRes = cx.status === "fulfilled" ? cx.value : { code: -1, stdout: "", stderr: String(cx.reason) };

  const cwOut = parseStreamJson(cwRes.stdout);
  const cxOut = parseReviewOutput(cxRes.stdout);
  const merged = mergeFindings(cwOut ?? { issues: [] }, cxOut ?? { issues: [] });
  const report = renderMergedReport(merged);

  writeJobLogs(job.id, { codewhale: cwRes, codex: cxRes, report });

  updateJob(HOME, job.id, {
    status: "completed",
    exit_code: (cwRes.code === 0 && cxRes.code === 0) ? 0 : 1,
    sub_jobs: [
      { model: "codewhale", status: cwRes.code === 0 ? "completed" : "failed", exit_code: cwRes.code, code_whale_session_id: extractSessionId(cwRes.stdout), log: `${job.id}.codewhale.stdout.log` },
      { model: "codex", status: cxRes.code === 0 ? "completed" : "failed", exit_code: cxRes.code, codex_session_id: extractCodexSessionId(cxRes.stdout), log: `${job.id}.codex.stdout.log` },
    ],
    merged_report_path: `${job.id}.merged.md`,
  });

  process.stdout.write(report);
}

function writeJobLogs(jobId, { codewhale, codex, report }) {
  const dir = path.join(HOME, ".codexhale-cc", "jobs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${jobId}.codewhale.stdout.log`), codewhale.stdout + "\n---STDERR---\n" + codewhale.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${jobId}.codex.stdout.log`), codex.stdout + "\n---STDERR---\n" + codex.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${jobId}.merged.md`), report, "utf8");
}

function extractSessionId(stdout) {
  const m = stdout.match(/"session_id"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}
function extractCodexSessionId(stdout) {
  const m = stdout.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/);
  return m ? m[1] : null;
}

async function runRescue(opts) {
  const task = opts.positional.join(" ");
  if (!task) { process.stderr.write("rescue requires task text\n"); process.exit(2); }
  const argv = buildRescueArgv({ task, model: opts.model, resume: opts.fresh ? null : opts.resume });
  const job = createJob(HOME, { kind: "rescue", repo: repoKey(), cc_task_id: null });
  const res = await runCodewhale(argv, { cwd: process.cwd() });
  const dir = path.join(HOME, ".codexhale-cc", "jobs");
  fs.writeFileSync(path.join(dir, `${job.id}.codewhale.stdout.log`), res.stdout + "\n---STDERR---\n" + res.stderr, "utf8");
  updateJob(HOME, job.id, {
    status: res.code === 0 ? "completed" : "failed",
    exit_code: res.code,
    sub_jobs: [{ model: "codewhale", status: res.code === 0 ? "completed" : "failed", exit_code: res.code, code_whale_session_id: extractSessionId(res.stdout), log: `${job.id}.codewhale.stdout.log` }],
  });
  process.stdout.write(res.stdout);
}

function runStatus(opts) {
  const repo = repoKey();
  const jobs = listJobsForRepo(HOME, repo);
  if (opts.positional[0]) {
    const j = readJob(HOME, opts.positional[0]);
    if (!j) { process.stderr.write("job not found\n"); process.exit(1); }
    process.stdout.write(JSON.stringify(j, null, 2) + "\n");
    return;
  }
  for (const j of jobs) {
    const age = j.ended_at ? `ended ${j.ended_at}` : "running";
    process.stdout.write(`${j.id}  ${j.kind}  ${j.status}  ${age}\n`);
  }
}

function runResult(opts) {
  const jobs = listJobsForRepo(HOME, repoKey());
  const id = opts.positional[0] ?? jobs[0]?.id;
  if (!id) { process.stderr.write("no jobs\n"); process.exit(1); }
  const j = readJob(HOME, id);
  if (!j) { process.stderr.write("job not found\n"); process.exit(1); }
  const dir = path.join(HOME, ".codexhale-cc", "jobs");
  if (j.kind === "rescue") {
    const log = path.join(dir, `${id}.codewhale.stdout.log`);
    process.stdout.write(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "(no log)\n");
    const sid = j.sub_jobs?.[0]?.code_whale_session_id;
    if (sid) process.stdout.write(`\nresume: codewhale resume ${sid}\n`);
  } else {
    const report = path.join(dir, j.merged_report_path || `${id}.merged.md`);
    process.stdout.write(fs.existsSync(report) ? fs.readFileSync(report, "utf8") : "(no report)\n");
    for (const s of j.sub_jobs ?? []) {
      if (s.model === "codewhale" && s.code_whale_session_id) process.stdout.write(`\nresume: codewhale resume ${s.code_whale_session_id}\n`);
      if (s.model === "codex" && s.codex_session_id) process.stdout.write(`resume: codex exec resume ${s.codex_session_id}\n`);
    }
  }
}

function runCancel(opts) {
  const jobs = listJobsForRepo(HOME, repoKey());
  const id = opts.positional[0] ?? jobs.find(j => j.status === "running")?.id;
  if (!id) { process.stderr.write("no running job\n"); process.exit(1); }
  updateJob(HOME, id, { status: "canceled" });
  process.stdout.write(`canceled ${id}\n`);
  process.stdout.write(`NOTE: stop the Claude Code background task via /tasks if running in background.\n`);
}

function runSetup(opts) {
  if (opts.reviewGate) {
    writeConfig(HOME, { review_gate_enabled: opts.reviewGate === "enable" });
    process.stdout.write(`review gate ${opts.reviewGate === "enable" ? "enabled" : "disabled"}\n`);
    return;
  }
  const report = { codewhale: checkCli("codewhale"), codex: checkCli("codex") };
  let allowShell = "unknown";
  try {
    // doctor --json has no allow_shell field; read it directly from config.
    const raw = execSync("codewhale config get allow_shell", { encoding: "utf8" }).trim();
    allowShell = raw === "true" ? "on" : raw === "false" ? "off" : "unknown";
  } catch {}
  process.stdout.write(`codewhale: ${report.codewhale.present ? `v${report.codewhale.version}` : "MISSING (npm i -g codewhale)"}\n`);
  process.stdout.write(`codex:     ${report.codex.present ? `v${report.codex.version}` : "MISSING (npm i -g @openai/codex; codex login)"}\n`);
  process.stdout.write(`allow_shell: ${allowShell} (review needs on)\n`);
  const cfg = readConfig(HOME);
  process.stdout.write(`review gate: ${cfg.review_gate_enabled ? "ENABLED" : "disabled"}\n`);
  if (!report.codewhale.present) process.stdout.write("\nrescue/gate unavailable without codewhale.\n");
  if (report.codewhale.present && !report.codex.present) process.stdout.write("\nreview will degrade to single-model (codewhale only) until codex is installed.\n");
}


// One debate round: parallel read-only reviews -> degraded check -> merge+ids
// -> early-exit if no critical/high -> rebut only single-model critical/high
// (agreed findings are never downgraded) -> tag -> verdict -> report.
// `deps` is a test seam: {runCw, runCx, home}. Defaults to real spawn + HOME.
export async function runDebateReview(opts, deps = {}) {
  const cwd = process.cwd();
  const home = deps.home ?? HOME;
  const runCw = deps.runCw ?? ((argv) => runCodewhale(argv, { cwd }));
  const runCx = deps.runCx ?? ((argv) => runCodex(argv, { cwd }));
  const rebuttalRubric = readPrompt("rebuttal-codewhale.md");
  const rubric = readPrompt("review.md");

  const focus = opts.positional.join(" ") || null;
  const reviewInstruction = buildReviewInstruction({ base: opts.base, focus, adversarial: false });

  const [cwR, cxR] = await Promise.allSettled([
    runCw(cwReviewArgv({ rubric, instruction: reviewInstruction, maxTurns: 50 })),
    runCx(codexReviewArgv({ base: opts.base, focus })),
  ]);
  const cwRes = cwR.status === "fulfilled" ? cwR.value : { code: -1, stdout: "", stderr: String(cwR.reason) };
  const cxRes = cxR.status === "fulfilled" ? cxR.value : { code: -1, stdout: "", stderr: String(cxR.reason) };
  const cwOut = cwRes.code === 0 ? parseStreamJson(cwRes.stdout) : null;
  const cxOut = cxRes.code === 0 ? parseReviewOutput(cxRes.stdout) : null;

  const writeOut = (report) => { if (!deps.runCw) process.stdout.write(report); };

  // Degraded: one (or zero) usable models -> single-model, findings uncontested.
  const present = [cwOut ? "codewhale" : null, cxOut ? "codex" : null].filter(Boolean);
  if (present.length <= 1) {
    const only = (cwOut ?? cxOut)?.issues ?? [];
    const findings = addIds(only).map(i => ({ ...i, found_by: present, status: "uncontested" }));
    const blocking = findings.filter(i => BLOCKING.has(i.severity)).length;
    const verdict = {
      clean: blocking === 0, degraded: true, agreedBlocking: blocking,
      reason: present.length === 0 ? "no model produced output" : `degraded single-model review (${present[0] || "none"})`,
    };
    const report = renderDebateReport(findings, verdict);
    finishDebateJob(home, { cwRes, cxRes, report, degraded: true });
    writeOut(report);
    return { verdict, findings, report };
  }

  const merged = addIds(mergeFindings(cwOut ?? { issues: [] }, cxOut ?? { issues: [] }).issues);

  let cwReb = [], cxReb = [];
  if (merged.some(i => BLOCKING.has(i.severity))) {
    const codexDisputed = merged.filter(i => i.found_by.length === 1 && i.found_by[0] === "codex" && BLOCKING.has(i.severity));
    const cwDisputed = merged.filter(i => i.found_by.length === 1 && i.found_by[0] === "codewhale" && BLOCKING.has(i.severity));
    [cwReb, cxReb] = await Promise.all([
      runCodewhaleRebuttal(rebuttalRubric, codexDisputed, opts.base, { cwd, runner: runCw }),
      runCodexRebuttal(cwDisputed, opts.base, { cwd, runner: runCx }),
    ]);
  }

  const tagged = tagFindings(merged, cwReb, cxReb);
  const verdict = computeVerdict(tagged);
  const report = renderDebateReport(tagged, verdict);
  finishDebateJob(home, { cwRes, cxRes, report, degraded: false });
  writeOut(report);
  return { verdict, findings: tagged, report };
}

function finishDebateJob(home, { cwRes, cxRes, report, degraded }) {
  const job = createJob(home, { kind: "debate-review", repo: repoKey(), cc_task_id: null });
  const dir = path.join(home, ".codexhale-cc", "jobs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${job.id}.codewhale.stdout.log`), cwRes.stdout + "\n---STDERR---\n" + cwRes.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${job.id}.codex.stdout.log`), cxRes.stdout + "\n---STDERR---\n" + cxRes.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${job.id}.debate.md`), report, "utf8");
  updateJob(home, job.id, { status: "completed", exit_code: 0, degraded: !!degraded, debate_report_path: `${job.id}.debate.md` });
}

// Run only when executed directly as a CLI, not when imported (e.g. by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { process.stderr.write(`${e.stack || e}\n`); process.exit(1); });
}
