#!/usr/bin/env bash
# 世界杯赔率刷新（由 root crontab 调用，部署在服务器 /opt/wc-odds/refresh.sh）。
# 流程：抓 the-odds-api 分源赔率 → 可选导入 current-lottery-raw.json 竞彩快照
#       → 写回 /var/www/rezz/data/matches.json → 重建 arena 盘口 → 重启 wc-arena。
# the-odds-api 失败时脚本会抛错且不写坏 matches.json；本脚本另存一份 prev 兜底回滚。
set -uo pipefail
DIR=/opt/wc-odds
LOG="$DIR/refresh.log"
MATCHES=/var/www/rezz/data/matches.json
MARKETS=/opt/wc-arena/data/markets.json
LOTTERY_RAW_JSON="${LOTTERY_RAW_JSON:-$DIR/current-lottery-raw.json}"
NODE=/usr/bin/node
ts() { date '+%F %T %z'; }

set -a; . "$DIR/odds.env"; set +a   # 载入 ODDS_API_KEYS（600，仅 root 可读）
export ODDS_CURSOR="$DIR/.odds-key-cursor"   # 多 key 轮询游标（记住上次用的第几个）

echo "[$(ts)] === refresh start ===" >> "$LOG"
cp -f "$MATCHES" "$DIR/matches.prev.json"

if "$NODE" "$DIR/theodds-odds.mjs" "$MATCHES" >> "$LOG" 2>&1; then
  if [ -s "$LOTTERY_RAW_JSON" ]; then
    if LOTTERY_RAW_JSON="$LOTTERY_RAW_JSON" "$NODE" "$DIR/lottery-odds.mjs" "$MATCHES" >> "$LOG" 2>&1; then
      echo "[$(ts)] OK — 竞彩快照已导入 matches.json：$LOTTERY_RAW_JSON" >> "$LOG"
    else
      echo "[$(ts)] LOTTERY 导入失败（保留 the-odds 更新，继续重建盘口）" >> "$LOG"
    fi
  else
    echo "[$(ts)] LOTTERY 跳过：未找到 $LOTTERY_RAW_JSON" >> "$LOG"
  fi
  chown www-data:www-data "$MATCHES"
  if MATCHES_JSON="$MATCHES" MARKETS_OUT="$MARKETS" "$NODE" "$DIR/build-markets.mjs" >> "$LOG" 2>&1; then
    chown www-data:www-data "$MARKETS"
    systemctl restart wc-arena
    echo "[$(ts)] OK — 赔率已刷新、盘口已重建、arena 已重启" >> "$LOG"
  else
    echo "[$(ts)] BUILD-MARKETS 失败（matches.json 已更新，盘口保持不变）" >> "$LOG"
  fi
else
  echo "[$(ts)] THEODDS 失败，回滚 matches.json（保持上一次赔率）" >> "$LOG"
  cp -f "$DIR/matches.prev.json" "$MATCHES"
  chown www-data:www-data "$MATCHES"
fi

# 日志只留最近 2000 行
tail -n 2000 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
