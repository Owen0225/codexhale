import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function jobsDir(home) {
  return path.join(home, ".codexhale-cc", "jobs");
}

export function jobPath(home, id) {
  return path.join(jobsDir(home), `${id}.json`);
}

function genId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function createJob(home, { kind, repo, cc_task_id }) {
  const id = genId();
  const job = {
    id, kind, repo, cc_task_id: cc_task_id ?? null,
    status: "running",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    sub_jobs: [],
  };
  fs.mkdirSync(jobsDir(home), { recursive: true });
  fs.writeFileSync(jobPath(home, id), JSON.stringify(job, null, 2) + "\n", "utf8");
  return job;
}

export function readJob(home, id) {
  const p = jobPath(home, id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const TERMINAL = new Set(["completed", "failed", "canceled"]);

export function updateJob(home, id, patch) {
  const job = readJob(home, id);
  if (!job) throw new Error(`job not found: ${id}`);
  const next = { ...job, ...patch };
  if (TERMINAL.has(next.status) && !next.ended_at) {
    next.ended_at = new Date().toISOString();
  }
  fs.writeFileSync(jobPath(home, id), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function listJobsForRepo(home, repo) {
  const dir = jobsDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const p = path.join(dir, f);
      return { job: JSON.parse(fs.readFileSync(p, "utf8")), mtime: fs.statSync(p).mtimeMs };
    })
    .filter(({ job }) => job.repo === repo)
    .sort((a, b) => {
      const d = (b.job.started_at || "").localeCompare(a.job.started_at || "");
      return d !== 0 ? d : b.mtime - a.mtime;
    })
    .map(({ job }) => job);
}
