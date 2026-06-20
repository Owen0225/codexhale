import { spawn } from "node:child_process";

// codex exec review --json --sandbox read-only [--base <b> | --uncommitted] <focus>
export function buildReviewArgv({ base, focus }) {
  const argv = ["exec", "review", "--json", "--sandbox", "read-only"];
  if (base) argv.push("--base", base);
  else argv.push("--uncommitted");
  if (focus) argv.push(focus);
  return argv;
}

// Parse JSONL. Codex --json emits events; the final review message is carried in
// a `last_message` field on the terminal event. Extract the first JSON object.
export function parseReviewOutput(stdout) {
  const lines = stdout.split("\n");
  let lastMessage = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (typeof obj.last_message === "string") lastMessage = obj.last_message;
    else if (typeof obj.message === "string") lastMessage = obj.message;
  }
  if (!lastMessage) return null;
  const match = lastMessage.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function runCodex(argv, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", argv, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
