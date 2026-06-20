import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJob, updateJob, readJob, listJobsForRepo } from "../plugins/codexhale/scripts/lib/jobs.mjs";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cw-"));
}

test("createJob writes manifest with running status and id", () => {
  const home = tmpHome();
  const job = createJob(home, { kind: "review", repo: "r1", cc_task_id: "t1" });
  assert.match(job.id, /^job_/);
  assert.equal(job.status, "running");
  assert.equal(job.kind, "review");
  assert.ok(job.started_at);
  const back = readJob(home, job.id);
  assert.equal(back.id, job.id);
});

test("updateJob merges fields and sets ended_at on terminal status", () => {
  const home = tmpHome();
  const job = createJob(home, { kind: "rescue", repo: "r1", cc_task_id: "t1" });
  updateJob(home, job.id, { status: "completed", exit_code: 0, sub_jobs: [{ model: "codewhale", status: "completed" }] });
  const back = readJob(home, job.id);
  assert.equal(back.status, "completed");
  assert.equal(back.exit_code, 0);
  assert.ok(back.ended_at);
  assert.equal(back.sub_jobs[0].model, "codewhale");
});

test("listJobsForRepo filters by repo and sorts newest first", () => {
  const home = tmpHome();
  const a = createJob(home, { kind: "review", repo: "r1", cc_task_id: "t" });
  const b = createJob(home, { kind: "review", repo: "r2", cc_task_id: "t" });
  const c = createJob(home, { kind: "review", repo: "r1", cc_task_id: "t" });
  const r1 = listJobsForRepo(home, "r1");
  assert.equal(r1.length, 2);
  assert.deepEqual(r1.map(j => j.id), [c.id, a.id]); // newest first
});
