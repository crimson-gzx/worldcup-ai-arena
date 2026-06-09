#!/usr/bin/env bash
# 多策略陪练 Agent（root crontab 调用，部署在服务器 /opt/wc-odds/bots.sh）。
# 押冷门 / 押平局 / 随机 三个性格，连同 baseline(押热门) 一起把天梯铺满、制造分化。
set -uo pipefail
DIR=/opt/wc-odds
LOG="$DIR/bots.log"
NODE=/usr/bin/node
ts() { date '+%F %T %z'; }

set -a; . "$DIR/bots.env"; set +a   # UNDERDOG_TOKEN / DRAW_TOKEN / RANDOM_TOKEN（600，仅 root）

run() {  # 策略 token
  local strat="$1" tok="$2"
  if [ -z "$tok" ]; then echo "[$(ts)] $strat 无 token，跳过" >> "$LOG"; return; fi
  if STRATEGY="$strat" BOT_TOKEN="$tok" "$NODE" "$DIR/strategy-bot.mjs" >> "$LOG" 2>&1; then
    echo "[$(ts)] $strat done" >> "$LOG"
  else
    echo "[$(ts)] $strat FAILED" >> "$LOG"
  fi
}

echo "[$(ts)] === bots start ===" >> "$LOG"
run underdog "${UNDERDOG_TOKEN:-}"
run draw     "${DRAW_TOKEN:-}"
run random   "${RANDOM_TOKEN:-}"
tail -n 1000 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
