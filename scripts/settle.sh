#!/usr/bin/env bash
# Agent 竞技场自动结算（由 root crontab 调用，部署在服务器 /opt/wc-odds/settle.sh）。
# 拉 the-odds-api 真实比分 → 对已完赛比赛调本机 arena /admin/settle 结算（幂等）。
set -uo pipefail
DIR=/opt/wc-odds
LOG="$DIR/settle.log"
NODE=/usr/bin/node
ts() { date '+%F %T %z'; }

# 载入 ODDS_API_KEYS（odds.env）+ ARENA_ADMIN_TOKEN（arena.env），都是 600 root-only
set -a; . "$DIR/odds.env"; . /opt/wc-arena/arena.env; set +a

echo "[$(ts)] === settle start ===" >> "$LOG"
if "$NODE" "$DIR/settle.mjs" >> "$LOG" 2>&1; then
  echo "[$(ts)] settle done" >> "$LOG"
else
  echo "[$(ts)] settle FAILED" >> "$LOG"
fi
tail -n 1000 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
