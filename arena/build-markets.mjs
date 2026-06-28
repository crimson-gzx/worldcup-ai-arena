/**
 * 从 ../data/matches.json 生成 arena 的 data/markets.json。
 * 有竞彩胜平负时优先使用官方固定奖金；否则使用 offshore 兼容共识价。
 * 同时保留 lottery/offshore/bookmakers 分源字段，前端和 Agent 可自行拆看。
 * 用法：node arena/build-markets.mjs（在仓库根目录跑）
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATCHES_FILE = process.env.MATCHES_JSON || join(HERE, "../data/matches.json");
const OUT_FILE = process.env.MARKETS_OUT || join(HERE, "data/markets.json");
const matches = JSON.parse(fs.readFileSync(MATCHES_FILE, "utf8"));

// 保留上次已结算（state=closed）的盘口，避免每日重建把已结算结果冲掉。
let prev = {};
try {
  prev = Object.fromEntries(JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).markets.map((m) => [m.matchId, m]));
} catch {}

const markets = matches.matches.map((m) => {
  if (prev[m.id] && prev[m.id].state === "closed") return prev[m.id];
  const lotteryOdds = m.lottery?.oneXTwo || null;
  const offshoreOdds = m.offshore?.oneXTwo || null;
  const odds = lotteryOdds || offshoreOdds;
  const fixture = m.tags.includes("fixture");

  return {
    matchId: m.id,
    home: m.home,
    away: m.away,
    state: fixture && odds ? "open" : "scheduled",
    source: lotteryOdds ? "中国体育彩票·竞彩足球" : (offshoreOdds ? "the-odds-api 分源赔率" : "pending"),
    cutoffAt: m.kickoff.replace(" ", "T") + ":00+08:00",
    oneXTwo: odds || null,
    lottery: m.lottery || null,
    offshore: m.offshore || null,
    bookmakers: Array.isArray(m.offshore?.bookmakers) ? m.offshore.bookmakers : []
  };
});

// 钩子场：最早一场标 openNow，让竞技场现在就能投注（server 端 openNow 即刻开放、开赛即关）；其余仍走 48h 窗口。
const openable = markets.filter((m) => m.state === "open" && m.cutoffAt && Date.parse(m.cutoffAt) > Date.now());
let opener = null;
for (const m of openable) {
  if (!opener || Date.parse(m.cutoffAt) < Date.parse(opener.cutoffAt)) opener = m;
}
if (opener) opener.openNow = true;

const out = {
  updatedAt: new Date().toISOString(),
  lotterySource: matches.lotterySource || null,
  oddsSource: matches.oddsSource || null,
  markets
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(
  `已写 ${OUT_FILE}：${markets.length} 场，open ${markets.filter((x) => x.state === "open").length}` +
    (opener ? `，钩子场 openNow=${opener.home} vs ${opener.away}（${opener.cutoffAt}）` : "")
);
