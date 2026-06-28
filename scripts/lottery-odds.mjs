#!/usr/bin/env node
/**
 * 中国体育彩票·竞彩足球 世界杯(WCC) 当前在售玩法 → data/matches.json 的 match.lottery。
 *
 * 支持两种来源：
 *   1) 直接请求 Sporttery had,hhad,ttg,crs,hafu；
 *   2) LOTTERY_RAW_JSON=/path/current-lottery-raw.json 或 --raw /path 读取服务器快照。
 *
 * 注意：Sporttery 的 matchNumStr（如“周一074”）不是稳定的 FIFA 比赛编号。
 * 当前淘汰赛必须优先按队名/开球时间匹配，避免把 074/075 等写错场。
 */
import fs from "node:fs";
import https from "node:https";

const args = process.argv.slice(2);
let rawPath = process.env.LOTTERY_RAW_JSON || "";
let fileArg = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--raw") rawPath = args[++i] || "";
  else fileArg = args[i];
}

const FILE = fileArg || "data/matches.json";
const API = "https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry";
const POOLS = (process.env.LOTTERY_POOLS || "had,hhad,ttg,crs,hafu").split(",").map((s) => s.trim()).filter(Boolean);
const ALIAS = {
  阿尔及利: "阿尔及利亚",
  刚果金: "刚果民主共和国",
  乌兹别克: "乌兹别克斯坦",
  沙特: "沙特阿拉伯"
};
const POOL_LABELS = {
  had: "胜平负",
  hhad: "让球胜平负",
  ttg: "总进球",
  crs: "比分",
  hafu: "半全场"
};
const TREND_LABELS = { "1": "升", "-1": "降", "0": "平", "": "平" };
const TREND_SYMBOLS = { "1": "↑", "-1": "↓", "0": "·", "": "·" };
const HALF_FULL_LABELS = { h: "主", d: "平", a: "客" };

const norm = (s) => ALIAS[String(s || "").trim()] || String(s || "").trim();
const teamKey = (s) => norm(s).replace(/\s+/g, "");
const pairKey = (a, b) => [teamKey(a), teamKey(b)].sort().join("::");
const firstText = (...values) => {
  for (const value of values) if (value !== null && value !== undefined && String(value) !== "") return String(value);
  return "";
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const odd = (v) => {
  const n = num(v);
  return n != null && n > 1 ? Math.round(n * 100) / 100 : null;
};
const placeholderTeam = (s) => /组第|第\d+场|胜者|负者|[A-L](?:\/[A-L])+组/.test(String(s || ""));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Referer: "https://www.sporttery.cn/"
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (error) { reject(error); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
  });
}

function normalizePoolRows(value) {
  if (!Array.isArray(value)) return [];
  if (value.some((item) => Array.isArray(item?.subMatchList))) {
    const rows = [];
    for (const segment of value) rows.push(...(segment.subMatchList || []));
    return rows.filter((row) => row?.leagueCode === "WCC" || row?.leagueAbbName === "世界杯");
  }
  return value.filter((row) => row && (row.leagueCode === "WCC" || row.leagueAbbName === "世界杯" || row.leagueAllName === "世界杯"));
}

async function fetchPool(poolCode) {
  const payload = await getJSON(`${API}?poolCode=${poolCode}&channel=c`);
  if (!payload?.value?.matchInfoList) throw new Error(`竞彩 ${poolCode} 返回结构异常`);
  return normalizePoolRows(payload.value.matchInfoList);
}

async function readRaw() {
  if (rawPath) return JSON.parse(fs.readFileSync(rawPath, "utf8"));

  const pools = {};
  const errors = {};
  const attempts = {};
  for (const pool of POOLS) {
    try {
      pools[pool] = await fetchPool(pool);
      attempts[pool] = 1;
    } catch (error) {
      pools[pool] = [];
      errors[pool] = error.message;
    }
  }
  return {
    fetchedAt: new Date().toISOString(),
    source: { name: "中国体育彩票·竞彩足球", league: "世界杯(WCC)", url: API },
    pools,
    errors,
    attempts
  };
}

function kickoffKeyForRow(row) {
  const date = firstText(row.matchDate, row.businessDate).slice(0, 10);
  const time = firstText(row.matchTime).slice(0, 5);
  return date && time ? `${date} ${time}` : "";
}

function kickoffKeyForMatch(match) {
  return String(match.kickoff || "").slice(0, 16);
}

function updateLabel(poolData) {
  return [firstText(poolData.updateDate), firstText(poolData.updateTime)].filter(Boolean).join(" ");
}

function trendPayload(poolData, rawKey) {
  const code = firstText(poolData[`${rawKey}f`]);
  return { code, label: TREND_LABELS[code] || "平", symbol: TREND_SYMBOLS[code] || "·" };
}

function option(poolData, rawKey, key, label) {
  const odds = odd(poolData?.[rawKey]);
  if (odds == null) return null;
  return { key, rawKey, label, odds, trend: trendPayload(poolData, rawKey) };
}

function fmtLine(value, mirror = false) {
  const n = num(value);
  if (n == null) return firstText(value);
  const v = mirror ? -n : n;
  const rounded = Math.round(v * 100) / 100;
  const body = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return rounded > 0 ? `+${body}` : body;
}

function sideOptions(poolData, mirror, labels) {
  const map = mirror
    ? [["a", "home", labels.home], ["d", "draw", labels.draw], ["h", "away", labels.away]]
    : [["h", "home", labels.home], ["d", "draw", labels.draw], ["a", "away", labels.away]];
  return map.map(([rawKey, key, label]) => option(poolData, rawKey, key, label)).filter(Boolean);
}

function totalGoalOptions(poolData) {
  const defs = Array.from({ length: 7 }, (_, i) => [`s${i}`, `总${i}球`]);
  defs.push(["s7", "总7+球"]);
  return defs.map(([rawKey, label]) => option(poolData, rawKey, rawKey, label)).filter(Boolean);
}

function mirrorScoreKey(key) {
  const exact = key.match(/^s(\d{2})s(\d{2})$/);
  if (exact) return `s${exact[2]}s${exact[1]}`;
  if (key === "s1sh") return "s1sa";
  if (key === "s1sa") return "s1sh";
  return key;
}

function scoreSortKey(key) {
  const exact = key.match(/^s(\d{2})s(\d{2})$/);
  if (exact) return [0, Number(exact[1]), Number(exact[2]), key];
  const tailOrder = { s1sh: 0, s1sd: 1, s1sa: 2 };
  return [1, tailOrder[key] ?? 99, 0, key];
}

function scoreLabel(key) {
  const exact = key.match(/^s(\d{2})s(\d{2})$/);
  if (exact) return `${Number(exact[1])}-${Number(exact[2])}`;
  return { s1sh: "主胜其他", s1sd: "平局其他", s1sa: "客胜其他" }[key] || key;
}

function scoreOptions(poolData, mirror) {
  const rows = [];
  for (const [rawKey, value] of Object.entries(poolData || {})) {
    if (rawKey.endsWith("f") || ["goalLine", "goalLineValue", "updateDate", "updateTime", "id"].includes(rawKey)) continue;
    if (odd(value) == null) continue;
    const key = mirror ? mirrorScoreKey(rawKey) : rawKey;
    const item = option(poolData, rawKey, key, scoreLabel(key));
    if (item) rows.push(item);
  }
  return rows.sort((a, b) => {
    const ak = scoreSortKey(a.key);
    const bk = scoreSortKey(b.key);
    return ak[0] - bk[0] || ak[1] - bk[1] || ak[2] - bk[2] || ak[3].localeCompare(bk[3]);
  });
}

function mirrorHalfFullKey(key) {
  return String(key || "").replace(/[ha]/g, (ch) => (ch === "h" ? "a" : "h"));
}

function halfFullLabel(key) {
  return `半${HALF_FULL_LABELS[key[0]] || key[0]}/全${HALF_FULL_LABELS[key[1]] || key[1]}`;
}

function halfFullSort(key) {
  const order = { h: 0, d: 1, a: 2 };
  return (order[key[0]] ?? 9) * 3 + (order[key[1]] ?? 9);
}

function halfFullOptions(poolData, mirror) {
  const rows = [];
  for (const first of ["h", "d", "a"]) {
    for (const final of ["h", "d", "a"]) {
      const rawKey = `${first}${final}`;
      const key = mirror ? mirrorHalfFullKey(rawKey) : rawKey;
      const item = option(poolData, rawKey, key, halfFullLabel(key));
      if (item) rows.push(item);
    }
  }
  return rows.sort((a, b) => halfFullSort(a.key) - halfFullSort(b.key));
}

function buildPool(pool, row, mirror) {
  const poolData = row?.[pool] || {};
  if (!poolData || !Object.keys(poolData).length) return null;

  let line = firstText(poolData.goalLineValue, poolData.goalLine);
  let options = [];
  if (pool === "had") {
    options = sideOptions(poolData, mirror, { home: "主胜", draw: "平局", away: "客胜" });
    line = "";
  } else if (pool === "hhad") {
    line = fmtLine(line, mirror);
    options = sideOptions(poolData, mirror, { home: "让胜", draw: "让平", away: "让负" });
  } else if (pool === "ttg") {
    line = "";
    options = totalGoalOptions(poolData);
  } else if (pool === "crs") {
    line = "";
    options = scoreOptions(poolData, mirror);
  } else if (pool === "hafu") {
    line = "";
    options = halfFullOptions(poolData, mirror);
  }

  if (!options.length) return null;
  return { pool, label: POOL_LABELS[pool] || pool, line, updateAt: updateLabel(poolData), options };
}

function poolOptionMap(pool) {
  return Object.fromEntries((pool?.options || []).map((item) => [item.key, item.odds]));
}

function oneXTwoFromPool(pool) {
  const odds = poolOptionMap(pool);
  return ["home", "draw", "away"].every((key) => Number.isFinite(odds[key]))
    ? { home: odds.home, draw: odds.draw, away: odds.away }
    : null;
}

function handicapFromPool(pool) {
  const odds = oneXTwoFromPool(pool);
  return odds && pool?.line ? { line: pool.line, ...odds } : null;
}

function groupRawRows(raw) {
  const grouped = new Map();
  const poolCounts = {};
  for (const pool of POOLS) {
    const rows = normalizePoolRows((raw.pools || {})[pool] || []);
    poolCounts[pool] = rows.length;
    for (const row of rows) {
      const key = firstText(row.matchId, `${row.homeTeamAbbName}::${row.awayTeamAbbName}::${kickoffKeyForRow(row)}`);
      const entry = grouped.get(key) || { base: row, rows: {} };
      entry.rows[pool] = row;
      grouped.set(key, entry);
    }
  }
  return { entries: [...grouped.values()], poolCounts };
}

function buildIndexes(matches) {
  const byId = new Map();
  const byPair = new Map();
  const byKickoff = new Map();
  for (const match of matches) {
    byId.set(match.id, match);
    if (!placeholderTeam(match.home) && !placeholderTeam(match.away)) {
      const key = pairKey(match.home, match.away);
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(match);
    }
    const kickoff = kickoffKeyForMatch(match);
    if (kickoff) {
      if (!byKickoff.has(kickoff)) byKickoff.set(kickoff, []);
      byKickoff.get(kickoff).push(match);
    }
  }
  return { byId, byPair, byKickoff };
}

function rowTeamNames(row) {
  return {
    home: norm(firstText(row.homeTeamAbbName, row.homeTeamAllName)),
    away: norm(firstText(row.awayTeamAbbName, row.awayTeamAllName))
  };
}

function extractSportteryNo(row) {
  const raw = firstText(row.matchNumStr, row.matchNum);
  const match = raw.match(/(\d{3})$/);
  return match ? match[1] : "";
}

function findMatch(row, indexes) {
  const { home, away } = rowTeamNames(row);
  const pairMatches = indexes.byPair.get(pairKey(home, away)) || [];
  if (pairMatches.length === 1) return { match: pairMatches[0], method: "pair" };

  const kickoffMatches = indexes.byKickoff.get(kickoffKeyForRow(row)) || [];
  if (kickoffMatches.length === 1) return { match: kickoffMatches[0], method: "kickoff" };

  const no = extractSportteryNo(row);
  const byId = no ? indexes.byId.get(`wc26-m${no}`) : null;
  if (byId && (!kickoffKeyForRow(row) || kickoffKeyForMatch(byId) === kickoffKeyForRow(row))) {
    return { match: byId, method: "sporttery-no" };
  }
  return { match: null, method: "miss" };
}

function orientation(match, row, method) {
  const { home, away } = rowTeamNames(row);
  const matchHome = norm(match.home);
  const matchAway = norm(match.away);
  const hasPlaceholder = placeholderTeam(matchHome) || placeholderTeam(matchAway);

  if (teamKey(matchHome) === teamKey(home) && teamKey(matchAway) === teamKey(away)) return { ok: true, mirror: false };
  if (teamKey(matchHome) === teamKey(away) && teamKey(matchAway) === teamKey(home)) return { ok: true, mirror: true };

  if (hasPlaceholder && home && away) {
    match.originalHome ||= match.home;
    match.originalAway ||= match.away;
    match.home = home;
    match.away = away;
    return { ok: true, mirror: false };
  }

  if (method === "kickoff") return { ok: false, mirror: false, reason: `开球时间匹配但队名不一致：${match.home} vs ${match.away} / ${home} vs ${away}` };
  return { ok: false, mirror: false, reason: `队名不一致：${match.home} vs ${match.away} / ${home} vs ${away}` };
}

function buildLottery(entry, raw, mirror) {
  const pools = {};
  for (const pool of POOLS) {
    const payload = buildPool(pool, entry.rows[pool], mirror);
    if (payload) pools[pool] = payload;
  }
  if (!Object.keys(pools).length) return null;
  const base = entry.base;
  const collectedAt = firstText(raw.fetchedAt, raw.generatedAt, new Date().toISOString());
  return {
    source: "中国体育彩票·竞彩足球",
    collectedAt,
    matchNum: firstText(base.matchNumStr, base.matchNum),
    sportteryMatchId: firstText(base.matchId),
    matchStatus: firstText(base.matchStatus, base.sellStatus),
    oneXTwo: oneXTwoFromPool(pools.had),
    handicap: handicapFromPool(pools.hhad),
    pools
  };
}

function updateLotteryNote(match, lottery) {
  match.model = match.model || {};
  const notes = Array.isArray(match.model.notes) ? match.model.notes : [];
  const poolNames = Object.values(lottery.pools || {}).map((pool) => pool.label).join("、");
  match.model.notes = notes
    .filter((note) => !(String(note).includes("竞彩固定奖金") && /待接入|等待/.test(String(note))))
    .filter((note) => !String(note).startsWith("竞彩已接入"));
  match.model.notes.push(`竞彩已接入：${poolNames || "当前在售玩法"}；官方固定奖金按玩法分开展示，不做赔率平均。`);
}

const raw = await readRaw();
const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
const matches = payload.matches || [];

for (const match of matches) {
  if (match.lottery?.source === "中国体育彩票·竞彩足球") match.lottery = null;
}

const indexes = buildIndexes(matches);
const { entries, poolCounts } = groupRawRows(raw);
let matched = 0;
let oneXTwoN = 0;
let poolRows = 0;
const missed = [];

for (const entry of entries) {
  const { match, method } = findMatch(entry.base, indexes);
  const teams = rowTeamNames(entry.base);
  if (!match) {
    missed.push(`${kickoffKeyForRow(entry.base)} ${teams.home} vs ${teams.away}（未找到赛程）`);
    continue;
  }
  const orient = orientation(match, entry.base, method);
  if (!orient.ok) {
    missed.push(`${kickoffKeyForRow(entry.base)} ${teams.home} vs ${teams.away}（${orient.reason}）`);
    continue;
  }
  const lottery = buildLottery(entry, raw, orient.mirror);
  if (!lottery) continue;
  match.lottery = lottery;
  updateLotteryNote(match, lottery);
  matched++;
  if (lottery.oneXTwo) oneXTwoN++;
  poolRows += Object.keys(lottery.pools || {}).length;
}

payload.lotterySource = {
  name: "中国体育彩票·竞彩足球",
  league: "世界杯(WCC)",
  market: POOLS.map((pool) => `${POOL_LABELS[pool] || pool}(${pool})`).join("+"),
  collectedAt: firstText(raw.fetchedAt, raw.generatedAt, new Date().toISOString()),
  matched,
  oneXTwo: oneXTwoN,
  poolRows,
  poolCounts,
  errors: raw.errors || {}
};

fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + "\n");
console.log(`竞彩已写入 ${FILE}：对齐 ${matched} 场，胜平负 ${oneXTwoN} 场，玩法行 ${poolRows} 条`);
if (missed.length) console.log(`未对齐 ${missed.length} 条：${missed.join("；")}`);
