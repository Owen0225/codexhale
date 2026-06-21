import { spawn } from "node:child_process";
import { extractJsonObject } from "./extract-json.mjs";
import { buildReviewInstruction } from "./review-prompt.mjs";

// Use plain `codex exec` (NOT `exec review`): exec review emits PROSE review
// comments, but plain exec honors our JSON-output instruction (so codex returns the
// same review-output schema as codewhale). `codex exec` accepts --sandbox read-only;
// `exec review` rejects it. Scope (base vs uncommitted) is carried in the instruction.
export function buildReviewArgv({ base, focus }) {
  const instruction = buildReviewInstruction({ base, focus, adversarial: false });
  return ["exec", "--json", "--sandbox", "read-only", instruction];
}

// Parse codex --json JSONL events. codex 0.14x carries the final agent message in
// {"type":"item.completed","item":{"type":"agent_message","text":"..."}}. Older
// schemas used last_message/message. Tolerate leading ANSI/OSC escapes per line.
export function parseReviewOutput(stdout) {
  const lines = stdout.split("\n");
  let lastMessage = null;
  for (const line of lines) {
    const i = line.indexOf("{");
    if (i < 0) continue;
    let obj;
    try { obj = JSON.parse(line.slice(i)); } catch { continue; }
    if (obj.type === "item.completed" && obj.item?.type === "agent_message" && typeof obj.item.text === "string") {
      lastMessage = obj.item.text;
    } else if (typeof obj.last_message === "string") {
      lastMessage = obj.last_message;
    } else if (typeof obj.message === "string") {
      lastMessage = obj.message;
    }
  }
  if (!lastMessage) return null;
  return extractJsonObject(lastMessage);
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
