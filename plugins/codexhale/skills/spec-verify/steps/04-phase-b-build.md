## Phase B — Verify the Running Program

All code is finalized. No more code changes except critical bugs found during execution.

**If runtime profile is Minimal:** Run build check (Step 4a), then skip to Final section.

⛔ **For API and Full profiles: before declaring "I can't reach a live instance", run the 4-tier live-target probe in Step 7's sub-step `7a-pre`.** That probe applies to Phase B as a whole, not just to E2E — it tells the model to (1) reuse a running local server, (2) start one if a start command exists, (3) detect deploy backends and attempt a preview deploy with eligible credentials, and only then (4) fall back to unit-only with an explicit recorded gap. Skipping this probe and claiming "no live target available" without naming the tiers attempted is a `must_fix` finding.

## Step 4: Build, Deploy, and Verify Code Identity

#### 4a: Build

Build/compile the project. Verify zero errors.

#### 4b: Deploy (if applicable)

If project builds artifacts deployed separately from source: copy to install location, restart services. Check `ps aux | grep <service>` before restarting shared services.

**For platform deploys (Vercel / Fly / Netlify / etc.):** the live-target probe in `07-e2e-and-final-regression.md` § 7a-pre Tier 3 handles preview deploys automatically. Re-using its credential-detection logic here avoids two divergent code paths.

#### 4c: Code Identity Verification

**⛔ Prove the running instance uses your new code before testing it.**

1. Identify a behavioral change unique to this implementation
2. Craft a request only new code handles correctly (e.g., query with new parameter — new code returns filtered results, old code ignores parameter)
3. If response matches OLD behavior → redeploy, restart, re-verify
4. **Do NOT proceed** to execution testing until code identity is confirmed
