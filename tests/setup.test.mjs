import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoctor } from "../plugins/codexhale/scripts/lib/check-cli.mjs";

test("parseDoctor reads allow_shell true", () => {
  const r = parseDoctor('{"version":"0.8.61","allow_shell":true}');
  assert.equal(r.allow_shell, true);
  assert.equal(r.version, "0.8.61");
});

test("parseDoctor handles missing allow_shell as false", () => {
  const r = parseDoctor('{"version":"0.8.61"}');
  assert.equal(r.allow_shell, false);
});

test("parseDoctor returns safe defaults on garbage", () => {
  const r = parseDoctor("not json");
  assert.equal(r.allow_shell, false);
  assert.equal(r.version, null);
});
