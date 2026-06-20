import { spawn } from "node:child_process";
import { extractJsonObject } from "./extract-json.mjs";

export function buildReviewArgv({ rubric, instruction, maxTurns }) {
  return [
    "exec", "--auto", "--output-format", "stream-json",
    "--allowed-tools", "read_file,exec_shell",
    "--disallowed-tools", "write_file,edit_file,apply_patch",
    "--max-turns", String(maxTurns),
    "--append-system-prompt", rubric,
    instruction,
  ];
}

export function buildRescueArgv({ task, model, resume }) {
  const argv = ["exec", "--yolo", "--output-format", "stream-json"];
  if (model) argv.push("--model", model);
  if (resume === "continue") argv.push("--continue");
  else if (resume) argv.push("--resume", resume);
  argv.push(task);
  return argv;
}

// Parse newline-delimited stream-json. Look for the final agent message,
// attempt to JSON.parse it as the review-output schema.
export function parseStreamJson(stdout) {
  const lines = stdout.split("\n");
  let finalMessage = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (obj.type === "turn_completed" && typeof obj.final_message === "string") {
      finalMessage = obj.final_message;
    } else if (obj.type === "agent_message" && typeof obj.message === "string") {
      finalMessage = obj.message; // last agent_message wins as fallback
    }
  }
  if (!finalMessage) return null;
  // The agent message may have prose around the JSON object; extract it robustly.
  return extractJsonObject(finalMessage);
}

export function runCodewhale(argv, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("codewhale", argv, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
