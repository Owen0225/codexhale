## Step 0: Permission Mode + Model Switching Pre-Flight

<!-- CC-ONLY -->
**0a. Permission mode.** Check if the spec_mode_guard hook injected a permission mode note. If you see a system-reminder containing "Current permission mode is", briefly warn the user:

> "Your current permission mode is **{mode}**. For uninterrupted `/spec` execution, **Bypass Permissions** mode is recommended (Shift+Tab to cycle). Proceeding — the workflow may pause for permission prompts."

Do not stop or wait for the user to switch. The user's mode choice is respected — bypass permissions is recommended, not required.

**0b. Automated model switching info (show this verbatim to the user).** Read the toggle, then show the matching message:

```bash
echo "MODEL_SWITCH=${PILOT_MODEL_SWITCH_ENABLED:-true}"
```

- **If `MODEL_SWITCH` is `true` (default):**

  > ℹ️ Automated model switching is ON — planning runs on **Opus**, implementation & verification on **Sonnet**, automatically. This requires the **Opus Plan** model: if your status bar isn't already on it, run `/model opusplan` now (future sessions set this automatically). On **Fable 5** (`/model fable`), ignore the opusplan reminder — `/spec` runs the whole workflow on Fable; model switching does not apply (there is no `fableplan`). Prefer Opus for everything? Disable **Model Switching** in the Pilot Console → Settings → Automation.

- **If `MODEL_SWITCH` is `false`:**

  > ℹ️ Model Switching is OFF — `/spec` runs entirely on **Opus** (or on **Fable 5** when that is your active model).

We can only see that the active model is "Sonnet" — not whether it's really Opus Plan — so this is guidance, not a hard check. After showing the message, continue with the workflow.
<!-- /CC-ONLY -->
<!-- CODEX-START
**Skip** — permission mode and model switching are not applicable in Codex CLI. Proceed directly to Step 1.
CODEX-END -->
