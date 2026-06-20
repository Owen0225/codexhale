import { execSync } from "node:child_process";

export function checkCli(name) {
  try {
    const v = execSync(`${name} --version`, { encoding: "utf8" }).trim();
    return { present: true, version: v.replace(/^[^\d]*/, "") };
  } catch {
    return { present: false, version: null };
  }
}
