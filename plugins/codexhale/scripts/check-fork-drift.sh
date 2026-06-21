#!/usr/bin/env bash
# Reports divergence between the vendored fork and the current global Pilot skills,
# ignoring the intended delta (namespaced Skill() calls). Exit 0 = only intended delta.
#
# spec-verify and spec-bugfix-verify are EXPECTED to report DRIFT (they carry the
# debate-review edits). The four namespace-only forks should report in-sync.
set -uo pipefail
GLOBAL="$HOME/.claude/skills"
FORK="$(cd "$(dirname "$0")/../skills" && pwd)"
status=0
for s in spec spec-plan spec-bugfix-plan spec-implement spec-verify spec-bugfix-verify; do
  [ -d "$FORK/$s" ] || { echo "MISSING-FORK: $s"; status=1; continue; }
  while IFS= read -r f; do
    g="$GLOBAL/$s/$f"
    k="$FORK/$s/$f"
    if [ ! -f "$g" ]; then
      echo "NEW-IN-FORK: $s/$f"
      continue
    fi
    # Normalize the intended namespacing delta before diffing.
    if ! diff -q <(sed 's/codexhale:spec-/spec-/g' "$k") "$g" >/dev/null 2>&1; then
      echo "DRIFT: $s/$f (beyond namespacing)"
      status=1
    fi
  done < <(cd "$FORK/$s" && find . -type f -name '*.md')
done
[ "$status" = 0 ] && echo "fork in sync (only intended namespacing delta)"
exit "$status"
