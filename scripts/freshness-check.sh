#!/bin/bash
# 数据新鲜度监控：检查生产 matches.json 的竞彩/海外更新时间，超阈值告警。
# 由美国服务器 cron 每小时跑。竞彩正常每 12h 更新一次，超 16h 视为中转链路异常。
# 告警渠道：填了 SERVERCHAN_KEY 就推 Server酱（方糖）；否则只记日志。
set -uo pipefail
DIR=/opt/wc-odds
MATCHES=/var/www/rezz/data/matches.json
LOG=$DIR/freshness.log
NODE=/usr/bin/node
THRESHOLD_H=16
SERVERCHAN_KEY="${SERVERCHAN_KEY:-}"   # 可选：在本文件或 odds.env 里填，填了即启用主动推送
ts() { date '+%F %T %z'; }

# 用 node 算竞彩/海外距今小时数
read LOTT_H ODDS_H DETAIL <<<"$("$NODE" -e '
const fs=require("fs");
function ageH(t){ return t ? ((Date.now()-new Date(t).getTime())/3600000) : 9999; }
try{
  const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const lott=(d.lotterySource||{}).collectedAt||null;
  const odds=d.updatedAt||null;
  console.log(ageH(lott).toFixed(1), ageH(odds).toFixed(1), "竞彩="+(lott||"无")+" 海外="+(odds||"无"));
}catch(e){ console.log("9999","9999","读取失败:"+e.message); }
' "$MATCHES")"

WORST=$(awk -v a="$LOTT_H" -v b="$ODDS_H" "BEGIN{print (a>b)?a:b}")
STALE=$(awk -v h="$WORST" -v t="$THRESHOLD_H" "BEGIN{print (h>t)?1:0}")

if [ "$STALE" = "1" ]; then
  MSG="世界杯站数据陈旧：竞彩 ${LOTT_H}h / 海外 ${ODDS_H}h 未更新（阈值 ${THRESHOLD_H}h）。$DETAIL。排查：VPS(wc-cn) relay.sh 日志、cron、网络。"
  echo "[$(ts)] ⚠️ $MSG" >> "$LOG"
  if [ -n "$SERVERCHAN_KEY" ]; then
    curl -s -m 10 "https://sctapi.ftqq.com/${SERVERCHAN_KEY}.send" \
      --data-urlencode "title=⚠️世界杯站数据陈旧" --data-urlencode "desp=$MSG" >/dev/null 2>&1 \
      && echo "[$(ts)] 已推 Server酱" >> "$LOG"
  fi
else
  echo "[$(ts)] OK 竞彩 ${LOTT_H}h / 海外 ${ODDS_H}h 内" >> "$LOG"
fi
tail -n 500 "$LOG" 2>/dev/null > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
