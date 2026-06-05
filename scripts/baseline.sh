#!/usr/bin/env bash
# 市场基准 Agent（由 root crontab 调用，部署在服务器 /opt/wc-odds/baseline.sh）。
# 对开放且未押的比赛押市场热门，作为天梯参照对手。
set -uo pipefail
DIR=/opt/wc-odds
LOG="$DIR/baseline.log"
NODE=/usr/bin/node
ts() { date '+%F %T %z'; }

set -a; . "$DIR/baseline.env"; set +a   # 载入 BASELINE_TOKEN（600 root-only）

echo "[$(ts)] === baseline start ===" >> "$LOG"
if "$NODE" "$DIR/baseline-bot.mjs" >> "$LOG" 2>&1; then
  echo "[$(ts)] done" >> "$LOG"
else
  echo "[$(ts)] FAILED" >> "$LOG"
fi
tail -n 1000 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
