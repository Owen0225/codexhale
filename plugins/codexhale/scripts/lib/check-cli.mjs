import { execSync } from "node:child_process";

export function checkCli(name) {
  try {
    const v = execSync(`${name} --version`, { encoding: "utf8" }).trim();
    return { present: true, version: v.replace(/^[^\d]*/, "") };
  } catch {
    return { present: false, version: null };
  }
}

export function parseDoctor(docJson) {
  try {
    const doc = JSON.parse(docJson);
    return { allow_shell: Boolean(doc.allow_shell), version: doc.version ?? null };
  } catch {
    return { allow_shell: false, version: null };
  }
}
