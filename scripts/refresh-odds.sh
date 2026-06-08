#!/usr/bin/env bash
# 世界杯海外赔率每日刷新（由 root crontab 调用，部署在服务器 /opt/wc-odds/refresh.sh）。
# 流程：抓 the-odds-api 多家均值 → 写回 /var/www/rezz/data/matches.json
#       → 重建 arena 盘口（保留开幕战 openNow / 已结算场）→ 重启 wc-arena。
# the-odds-api 失败时脚本会抛错且不写坏 matches.json；本脚本另存一份 prev 兜底回滚。
set -uo pipefail
DIR=/opt/wc-odds
LOG="$DIR/refresh.log"
MATCHES=/var/www/rezz/data/matches.json
MARKETS=/opt/wc-arena/data/markets.json
NODE=/usr/bin/node
ts() { date '+%F %T %z'; }

set -a; . "$DIR/odds.env"; set +a   # 载入 ODDS_API_KEYS（600，仅 root 可读）
export ODDS_CURSOR="$DIR/.odds-key-cursor"   # 多 key 轮询游标（记住上次用的第几个）

echo "[$(ts)] === refresh start ===" >> "$LOG"
cp -f "$MATCHES" "$DIR/matches.prev.json"

if "$NODE" "$DIR/theodds-odds.mjs" "$MATCHES" >> "$LOG" 2>&1; then
  chown www-data:www-data "$MATCHES"
  # 注：竞彩固定奖金由国内 VPS 抓取后直接推回 matches.json（美国 IP 被 sporttery 567 拦截）。
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
