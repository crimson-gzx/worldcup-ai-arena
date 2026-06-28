#!/bin/bash
# 数据新鲜度监控：检查生产 matches.json 的竞彩/海外更新时间，超阈值告警。
# 由美国服务器 cron 每小时跑。竞彩按小时更新，海外赔率可低频更新，二者分开告警。
# 告警渠道：填了 SERVERCHAN_KEY 就推 Server酱（方糖）；否则只记日志。
set -uo pipefail
DIR=/opt/wc-odds
MATCHES=/var/www/rezz/data/matches.json
LOG=$DIR/freshness.log
NODE=/usr/bin/node
LOTTERY_THRESHOLD_H=${LOTTERY_THRESHOLD_H:-4}
ODDS_THRESHOLD_H=${ODDS_THRESHOLD_H:-30}
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

LOTT_STALE=$(awk -v h="$LOTT_H" -v t="$LOTTERY_THRESHOLD_H" "BEGIN{print (h>t)?1:0}")
ODDS_STALE=$(awk -v h="$ODDS_H" -v t="$ODDS_THRESHOLD_H" "BEGIN{print (h>t)?1:0}")
STALE=$(awk -v a="$LOTT_STALE" -v b="$ODDS_STALE" "BEGIN{print (a==1 || b==1)?1:0}")

if [ "$STALE" = "1" ]; then
  MSG="世界杯站数据陈旧：竞彩 ${LOTT_H}h（阈值 ${LOTTERY_THRESHOLD_H}h）/ 海外 ${ODDS_H}h（阈值 ${ODDS_THRESHOLD_H}h）。$DETAIL。排查：VPS(wc-cn) lottery cron、current-lottery-raw.json 同步、/opt/wc-odds refresh.log。"
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
