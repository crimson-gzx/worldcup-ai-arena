/**
 * 从 ../data/matches.json 生成 arena 的 data/markets.json：
 * 小组赛且有 offshore 赔率 → state=open（带 cutoffAt=开球、oneXTwo=海外均值）；其余 → scheduled。
 * 用法： node arena/build-markets.mjs   （在仓库根目录跑）
 * 刷新赔率后重建盘口：先跑 scripts/theodds-odds.mjs，再跑本脚本，再 scp arena/data/markets.json → /opt/wc-arena/data/ 并 systemctl restart wc-arena。
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATCHES_FILE = process.env.MATCHES_JSON || join(HERE, "../data/matches.json");
const OUT_FILE = process.env.MARKETS_OUT || join(HERE, "data/markets.json");
const matches = JSON.parse(fs.readFileSync(MATCHES_FILE, "utf8"));

// 保留上次已结算（state=closed）的盘口，避免每日重建把已结算结果冲掉
let prev = {};
try {
  prev = Object.fromEntries(JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).markets.map((m) => [m.matchId, m]));
} catch {}

const markets = matches.matches.map((m) => {
  if (prev[m.id] && prev[m.id].state === "closed") return prev[m.id]; // 已结算原样保留
  const grp = m.tags.includes("group");
  const odds = m.offshore && m.offshore.oneXTwo;
  return {
    matchId: m.id,
    home: m.home,
    away: m.away,
    state: grp && odds ? "open" : "scheduled",
    source: odds ? "the-odds-api 多家均值" : "official-sporttery",
    cutoffAt: m.kickoff.replace(" ", "T") + ":00+08:00",
    oneXTwo: odds ? m.offshore.oneXTwo : null
  };
});

// 钩子场：最早一场（开幕战）标 openNow，让竞技场现在就能投注（server 端 openNow 即刻开放、开赛即关）；其余仍走 48h 窗口。
const openable = markets.filter((m) => m.state === "open" && m.cutoffAt);
let opener = null;
for (const m of openable) {
  if (!opener || Date.parse(m.cutoffAt) < Date.parse(opener.cutoffAt)) opener = m;
}
if (opener) opener.openNow = true;

const out = { updatedAt: new Date().toISOString(), markets };
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(
  `已写 ${OUT_FILE}：${markets.length} 场，open ${markets.filter((x) => x.state === "open").length}` +
    (opener ? `，钩子场 openNow=${opener.home} vs ${opener.away}（${opener.cutoffAt}）` : "")
);
