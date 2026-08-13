#!/bin/zsh
# Nightly NBA data refresh, run locally on your Mac (residential IP reaches
# stats.nba.com). Refreshes the CURRENT season only — completed seasons are
# fetched once by `npm run fetch -- --missing` and never change — then pushes,
# which triggers a Vercel redeploy. Invoked by the launchd agent (see HOSTING.md).

REPO="$HOME/source-code/nba-analytics"
LOG="$HOME/Library/Logs/nba-refresh.log"
BRANCH="data"

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
  if git diff --quiet public/data; then
    echo "$(date)  no data change ($teams teams) — nothing to push"
  else
    echo "$(date)  data changed — committing and pushing to $BRANCH …"
    git add public/data
    git commit -m "chore: nightly NBA data refresh"
    git push origin "$BRANCH"
    note=""
    [ "$carried" -gt 0 ] && note=" — $carried league-wide dataset(s) carried over from the previous fetch"
    echo "$(date)  pushed refresh ($teams teams)$note"
  fi
else
  echo "$(date)  fetch returned no teams — likely blocked; skipping commit"
fi

echo "=== $(date)  refresh done in $((SECONDS - started))s ==="
