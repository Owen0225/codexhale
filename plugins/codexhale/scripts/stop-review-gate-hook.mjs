#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { readConfig } from "./lib/config.mjs";
import { buildReviewArgv, runCodewhale, parseStreamJson } from "./lib/codewhale.mjs";

const HOME = os.homedir();
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  // Claude Code Stop hooks read JSON from stdin.
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { /* no stdin */ }

  const cfg = readConfig(HOME);
  if (!cfg.review_gate_enabled) {
    process.exit(0); // gate off => allow stop
  }

  // Fail-open: if we can't parse the transcript, allow stop.
  let transcript;
  try { transcript = JSON.parse(raw); } catch { process.exit(0); }

  const changedFiles = extractChangedFiles(transcript);
  if (changedFiles.length === 0) {
    process.exit(0); // no code changes this turn => skip
  }

  const rubric = fs.readFileSync(path.join(PLUGIN_ROOT, "prompts", "stop-review-gate.md"), "utf8");
  const claim = extractClaim(transcript);
  const instruction = `Claude just made changes to: ${changedFiles.join(", ")}.\nClaude's claim: ${claim}\nVerify the changes are sound and complete. Report blocking issues only.`;

  let res;
  try {
    res = await runCodewhale(buildReviewArgv({ rubric, instruction, maxTurns: 40 }), { cwd: process.cwd() });
  } catch {
    process.exit(0); // fail-open
  }
  if (res.code !== 0) {
    process.exit(0); // fail-open on codewhale error
  }

  const out = parseStreamJson(res.stdout);
  const issues = (out?.issues ?? []).filter(i => ["critical", "high"].includes(i.severity));
  if (issues.length === 0) {
    process.exit(0); // clean => allow stop
  }

  // Block: emit the Claude Code Stop-hook block decision.
  const reasons = issues.map(i => `- [${i.severity}] ${i.file}:${(i.line_range || []).join("-")} ${i.category}: ${i.description}`).join("\n");
  const decision = {
    decision: "block",
    reason: `CodeWhale review gate found ${issues.length} blocking issue(s):\n${reasons}\n\nAddress these before stopping.`,
  };
  process.stdout.write(JSON.stringify(decision));
  process.exit(0);
}

export function extractChangedFiles(transcript) {
  // Claude Code transcript shape varies; scan tool calls for file targets.
  const files = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === "tool_use" && ["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(node.name)) {
      const fp = node.input?.file_path || node.input?.path;
      if (fp) files.add(fp);
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(transcript);
  return [...files];
}

export function extractClaim(transcript) {
  // Best-effort: last assistant text message.
  const texts = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.role === "assistant" && typeof node.content === "string") texts.push(node.content);
    if (node.type === "text" && typeof node.text === "string") texts.push(node.text);
    for (const v of Object.values(node)) walk(v);
  };
  walk(transcript);
  return (texts[texts.length - 1] || "").slice(0, 500);
}

// Run only when executed directly as a hook, not when imported (e.g. by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => process.exit(0)); // always fail-open
}
