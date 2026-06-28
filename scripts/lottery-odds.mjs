/**
 * 中国体育彩票·竞彩足球 世界杯(WCC) 胜平负(had)+让球(hhad) → data/matches.json 的 match.lottery。
 * 官方单一赔率源，无需聚合；按中文队名对齐小组赛场次（主客方向自动校正）。
 * 用法： node scripts/lottery-odds.mjs [data/matches.json]
 * 仅小组赛能匹配（淘汰赛球队未定）。app.js fetch 用 cache:no-store，写回即生效、无需 bump 版本。
 */
import fs from "node:fs";
import https from "node:https";

const FILE = process.argv[2] || "data/matches.json";
const API = "https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry";
const SPORTTERY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Origin": "https://www.sporttery.cn",
  "Referer": "https://www.sporttery.cn/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site"
};
// 竞彩简称 → matches.json 全称（仅差异项；其余队名两边一致）
const ALIAS = { 阿尔及利: "阿尔及利亚", 刚果金: "刚果民主共和国", 乌兹别克: "乌兹别克斯坦", 沙特: "沙特阿拉伯" };
const norm = (s) => ALIAS[s] || s;
const pairKey = (a, b) => [a, b].sort().join("::");
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmtHcap = (p) => (p > 0 ? "+" : "") + p;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 用 node:https（零依赖、兼容旧版 Node；中转机 CentOS7 只能跑 Node16、无全局 fetch）
function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: SPORTTERY_HEADERS,
      timeout: 15000
    }, (res) => {
      let data = ""; res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
  });
}
async function fetchPool(poolCode) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const d = await getJSON(`${API}?poolCode=${poolCode}&channel=c&_=${Date.now()}`);
      if (!d?.value?.matchInfoList) throw new Error(`返回结构异常：${JSON.stringify(d).slice(0, 160)}`);
      return d.value.matchInfoList;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        const delay = 1200 * attempt + Math.floor(Math.random() * 800);
        console.error(`竞彩 ${poolCode} 第 ${attempt} 次失败：${err.message}，${delay}ms 后重试`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`竞彩 ${poolCode} 抓取失败：${lastErr?.message || lastErr}`);
}
function indexWCC(list) {
  const out = new Map();
  for (const seg of list) for (const m of seg.subMatchList || []) {
    if (m.leagueCode === "WCC") out.set(m.matchId, m);
  }
  return out;
}

const [hadList, hhadList] = await Promise.all([fetchPool("had"), fetchPool("hhad")]);
const hadMap = indexWCC(hadList);
const hhadMap = indexWCC(hhadList);
if (!hhadMap.size) { console.log("竞彩世界杯暂无在售场次（可能尚未开售），matches.json 保持不变"); process.exit(0); }

const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
const byPair = new Map();
for (const m of payload.matches) if ((m.tags || []).includes("group")) byPair.set(pairKey(m.home, m.away), m);

const collectedAt = new Date().toISOString();
let matched = 0, oneXTwoN = 0;
const missed = [];
for (const cm of hhadMap.values()) {
  const home = norm(cm.homeTeamAbbName), away = norm(cm.awayTeamAbbName);
  const m = byPair.get(pairKey(home, away));
  if (!m) { missed.push(`${home} vs ${away}`); continue; }
  const same = m.home === home; // matches.json 主客与竞彩一致则正序，否则镜像

  // 让球盘（hhad）
  const hh = cm.hhad || {};
  const gl = num(hh.goalLine);
  let handicap = null;
  if (gl != null && [hh.h, hh.d, hh.a].every((x) => num(x) != null)) {
    handicap = same
      ? { line: fmtHcap(gl), home: num(hh.h), draw: num(hh.d), away: num(hh.a) }
      : { line: fmtHcap(-gl), home: num(hh.a), draw: num(hh.d), away: num(hh.h) };
  }

  // 胜平负（had；部分实力悬殊场竞彩不开，保持 null）
  const hd = hadMap.get(cm.matchId)?.had || {};
  let oneXTwo = null;
  if ([hd.h, hd.d, hd.a].every((x) => num(x) != null)) {
    oneXTwo = same
      ? { home: num(hd.h), draw: num(hd.d), away: num(hd.a) }
      : { home: num(hd.a), draw: num(hd.d), away: num(hd.h) };
    oneXTwoN++;
  }

  if (!oneXTwo && !handicap) continue;
  m.lottery = { source: "中国体育彩票·竞彩足球", collectedAt, oneXTwo, handicap };
  matched++;
}

payload.lotterySource = {
  name: "中国体育彩票·竞彩足球", league: "世界杯(WCC)",
  market: "胜平负(had)+让球(hhad)", collectedAt, matched, oneXTwo: oneXTwoN
};
fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + "\n");
console.log(`竞彩已写入 ${FILE}：对齐 ${matched} 场（含胜平负 ${oneXTwoN}）`);
if (missed.length) console.log(`未对齐 ${missed.length} 场：${missed.join("、")}`);
