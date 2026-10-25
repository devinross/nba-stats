#!/bin/zsh
# Nightly NBA data refresh, run locally on your Mac (residential IP reaches
# stats.nba.com). Refreshes the CURRENT season only — completed seasons are
# fetched once by `npm run fetch -- --missing` and never change — then pushes,
# which triggers a Vercel redeploy. Invoked by the launchd agent in
# scripts/com.nba.refresh.plist (see HOSTING.md).

REPO="$HOME/source-code/nba-analytics"
LOG="$HOME/Library/Logs/nba-refresh.log"
# Vercel deploys production from master, so that's where the data has to land.
BRANCH="master"

# Make node/npm/git findable from launchd's bare environment.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# If you use nvm, load it so `npm` resolves (harmless if you don't):
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$REPO" || { echo "$(date)  repo not found at $REPO" >> "$LOG"; exit 1; }

# Everything below goes to the log. Run by hand from a terminal it also goes to
# the screen, so you can watch the fetch instead of tailing the log in another
# window; under launchd (no terminal) it's the log alone, exactly as before.
if [ -t 1 ]; then
  exec > >(tee -a "$LOG") 2>&1
  echo "(also logging to $LOG)"
else
  exec >> "$LOG" 2>&1
fi

started=$SECONDS
echo "=== $(date)  refresh start ==="

# This runs in your working checkout, so don't commit onto whatever branch you
# left it on — a feature branch would swallow the data and never deploy.
current=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ "$current" != "$BRANCH" ]; then
  echo "$(date)  checkout is on '${current:-detached HEAD}', not $BRANCH — skipping tonight's refresh"
  exit 1
fi
# Start from the remote's tip so the push below is a fast-forward. Fails (and
# stops the run) only if master has diverged, which needs a human anyway.
git pull --ff-only --quiet origin "$BRANCH" || { echo "$(date)  git pull failed — skipping"; exit 1; }

npm run fetch

# Guard: never commit an empty/blocked snapshot over a good one. Reads the
# current season's league file, which `npm run fetch` rewrites in place — a
# failed fetch leaves the previous one there, so this stays > 0 and the
# unchanged-file check below is what decides there is nothing to commit.
read -r teams carried <<<"$(node --input-type=commonjs -e "
const fs = require('fs');
try {
  const index = JSON.parse(fs.readFileSync('public/data/index.json', 'utf8'));
  const season = index.currentSeason;
  const league = JSON.parse(fs.readFileSync('public/data/' + season + '/league.json', 'utf8'));
  const carried = Object.keys(league.stale || {}).length;
  process.stdout.write((league.teams || []).length + ' ' + carried);
} catch (e) { process.stdout.write('0 0'); }
")"

if [ "$teams" -gt 0 ]; then
  # data-cache/ holds the per-game rotation files. They aren't deployed, but
  # committing them is what lets each night add to the backfill instead of
  # starting from nothing. New games arrive as untracked files, hence `add`
  # before the check rather than `git diff`.
  git add public/data data-cache
  if git diff --cached --quiet -- public/data data-cache; then
    echo "$(date)  no data change ($teams teams) — nothing to push"
  else
    echo "$(date)  data changed — committing and pushing to $BRANCH …"
    # The pathspec keeps anything else you had staged out of the bot's commit.
    git commit -m "chore: nightly NBA data refresh" -- public/data data-cache
    if git push origin "$BRANCH"; then
      note=""
      [ "$carried" -gt 0 ] && note=" — $carried league-wide dataset(s) carried over from the previous fetch"
      echo "$(date)  pushed refresh ($teams teams)$note"
    else
      # The commit stays local; the next run's pull + push sends it along.
      echo "$(date)  PUSH FAILED — refresh committed locally but not deployed"
      exit 1
    fi
  fi
else
  echo "$(date)  fetch returned no teams — likely blocked; skipping commit"
fi

echo "=== $(date)  refresh done in $((SECONDS - started))s ==="
