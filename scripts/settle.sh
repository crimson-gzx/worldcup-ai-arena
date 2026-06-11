#!/usr/bin/env bash
# Agent 竞技场自动结算（由 root crontab 调用，部署在服务器 /opt/wc-odds/settle.sh）。
# 拉 the-odds-api 真实比分 → 对已完赛比赛调本机 arena /admin/settle 结算（幂等）。
set -uo pipefail
DIR=/opt/wc-odds
LOG="$DIR/settle.log"
MATCHES=${MATCHES:-/var/www/rezz/data/matches.json}
MARKETS=${MARKETS:-/opt/wc-arena/data/markets.json}
NODE=/usr/bin/node
ts() { date '+%F %T %z'; }

# 载入 ODDS_API_KEYS（odds.env）+ ARENA_ADMIN_TOKEN（arena.env），都是 600 root-only
set -a; . "$DIR/odds.env"; . /opt/wc-arena/arena.env; set +a

echo "[$(ts)] === settle start ===" >> "$LOG"
if [ "${FORCE_SETTLE:-0}" != "1" ] && [ -f "$MATCHES" ]; then
  SHOULD_POLL=$("$NODE" - "$MATCHES" "$MARKETS" <<'NODE' 2>/dev/null || echo 1
const fs = require("node:fs");
const matchesFile = process.argv[2];
const marketsFile = process.argv[3];
const d = JSON.parse(fs.readFileSync(matchesFile, "utf8"));
let openMarkets = new Set();
try {
  const mk = JSON.parse(fs.readFileSync(marketsFile, "utf8"));
  openMarkets = new Set((mk.markets || []).filter((m) => m.state !== "closed").map((m) => m.matchId));
} catch {}
const now = Date.now();
const liveBefore = Number(process.env.SETTLE_LIVE_BEFORE_MIN || 5) * 60000;
const liveAfter = Number(process.env.SETTLE_LIVE_AFTER_MIN || 130) * 60000;
const finalAge = Number(process.env.SETTLE_FINAL_AGE_MIN || 75) * 60000;
const maxAge = Number(process.env.SETTLE_MAX_AGE_HOURS || 72) * 3600000;
const liveEvery = Math.max(1, Number(process.env.SETTLE_LIVE_EVERY_MIN || 15));
const retryEvery = Math.max(1, Number(process.env.SETTLE_RETRY_EVERY_MIN || 15));
const minute = new Date(now).getMinutes();
const parseKickoff = (s) => Date.parse(String(s || "").replace(" ", "T") + ":00+08:00");
let hasLive = false;
let hasSettle = false;
for (const m of (d.matches || [])) {
  const t = parseKickoff(m.kickoff);
  if (!Number.isFinite(t)) continue;
  if (m.completed && !openMarkets.has(m.id)) continue;
  const liveWindow = t <= now + liveBefore && t >= now - liveAfter && !m.completed;
  if (liveWindow && minute % liveEvery === 0) hasLive = true;
  const needsSettle = openMarkets.has(m.id) && t <= now - finalAge && t >= now - maxAge;
  if (needsSettle && minute % retryEvery === 0) hasSettle = true;
}
process.stdout.write(hasSettle ? "settle" : hasLive ? "live" : "0");
NODE
)
  if [ "$SHOULD_POLL" = "0" ]; then
    echo "[$(ts)] skip: no pending finished match window" >> "$LOG"
    tail -n 1000 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
    exit 0
  fi
fi

if [ "${SHOULD_POLL:-settle}" = "settle" ]; then
  export SCORES_DAYS="${SCORES_DAYS:-1}"
else
  unset SCORES_DAYS
fi

if MATCHES_FILE="$MATCHES" "$NODE" "$DIR/settle.mjs" >> "$LOG" 2>&1; then
  [ -f "$MATCHES" ] && chown www-data:www-data "$MATCHES"
  echo "[$(ts)] settle done" >> "$LOG"
else
  echo "[$(ts)] settle FAILED" >> "$LOG"
fi
tail -n 1000 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
