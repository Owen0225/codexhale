import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig, writeConfig } from "../plugins/codexhale/scripts/lib/config.mjs";

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cwhome-"));
  return dir;
}

test("readConfig returns defaults when no file", () => {
  const home = tmpHome();
  const cfg = readConfig(home);
  assert.deepEqual(cfg, { review_gate_enabled: false });
});

test("writeConfig then readConfig round-trips", () => {
  const home = tmpHome();
  writeConfig(home, { review_gate_enabled: true });
  const cfg = readConfig(home);
  assert.equal(cfg.review_gate_enabled, true);
});

test("writeConfig preserves unknown keys", () => {
  const home = tmpHome();
  writeConfig(home, { review_gate_enabled: false, custom: "x" });
  assert.equal(readConfig(home).custom, "x");
});
