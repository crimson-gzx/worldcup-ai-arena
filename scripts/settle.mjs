/**
 * Agent 竞技场自动结算：从 the-odds-api scores 拉 FIFA 世界杯真实比分，
 * 对 live / completed 的比赛：
 * 1) 写回 matches.json 的直播比分/完赛赛果，供前端、积分和出线率实时刷新；
 * 2) 对 completed 的比赛按比分调用本机 arena 的 /admin/settle 结算（幂等：已 closed 的盘口自动跳过）。
 *
 * 用法： ODDS_API_KEYS=.. ARENA_ADMIN_TOKEN=.. node scripts/settle.mjs
 * scores 端点：不带 daysFrom 消耗 1 credit/次（直播/赛前）；带 daysFrom 消耗 2 credits/次（含近期完赛）。
 * 多 key 依次尝试，第一个可用的就用。
 * 调试： SCORES_TEST_FILE=fake.json SETTLE_DRY_RUN=1 node scripts/settle.mjs  （从文件读比分、只打印不真结算）
 */
import fs from "node:fs";

const KEYS = (process.env.ODDS_API_KEYS || process.env.ODDS_API_KEY || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN = process.env.ARENA_ADMIN_TOKEN || "";
const ARENA_BASE = process.env.ARENA_BASE || "http://127.0.0.1:8791";
const MARKETS_FILE = process.env.MARKETS_OUT || "/opt/wc-arena/data/markets.json";
const MATCHES_FILE = process.env.MATCHES_FILE || process.env.MATCHES_JSON || "/var/www/rezz/data/matches.json";
const SPORT = "soccer_fifa_world_cup";
const DAYS_FROM = process.env.SCORES_DAYS || "";
const DRY_RUN = process.env.SETTLE_DRY_RUN === "1";
const TEST_FILE = process.env.SCORES_TEST_FILE || "";

if (!TEST_FILE && !KEYS.length) { console.error("缺少 ODDS_API_KEYS"); process.exit(1); }
if (!DRY_RUN && !ADMIN) { console.error("缺少 ARENA_ADMIN_TOKEN"); process.exit(1); }

const EN2ZH = {
  Algeria:"阿尔及利亚",Argentina:"阿根廷",Australia:"澳大利亚",Austria:"奥地利",Belgium:"比利时","Bosnia & Herzegovina":"波黑",Brazil:"巴西",Canada:"加拿大","Cape Verde":"佛得角",Colombia:"哥伦比亚",Croatia:"克罗地亚","Curaçao":"库拉索",Curacao:"库拉索","Czech Republic":"捷克","DR Congo":"刚果民主共和国","D.R. Congo":"刚果民主共和国",Ecuador:"厄瓜多尔",Egypt:"埃及",England:"英格兰",France:"法国",Germany:"德国",Ghana:"加纳",Haiti:"海地",Iran:"伊朗",Iraq:"伊拉克","Ivory Coast":"科特迪瓦",Japan:"日本",Jordan:"约旦","Korea Republic":"韩国","South Korea":"韩国",Mexico:"墨西哥",Morocco:"摩洛哥",Netherlands:"荷兰","New Zealand":"新西兰",Norway:"挪威",Panama:"巴拿马",Paraguay:"巴拉圭",Portugal:"葡萄牙",Qatar:"卡塔尔","Saudi Arabia":"沙特阿拉伯",Scotland:"苏格兰",Senegal:"塞内加尔","South Africa":"南非",Spain:"西班牙",Sweden:"瑞典",Switzerland:"瑞士",Tunisia:"突尼斯",Turkey:"土耳其",USA:"美国",Uruguay:"乌拉圭",Uzbekistan:"乌兹别克斯坦"
};
const pairKey = (a, b) => [a, b].sort().join("::");
const nowIso = () => new Date().toISOString();
const atomicWriteJson = (file, data) => {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
};

// ---- 取比分：测试文件优先，否则多 key 依次尝试拉 the-odds-api scores ----
let events;
if (TEST_FILE) {
  events = JSON.parse(fs.readFileSync(TEST_FILE, "utf8"));
  console.log(`[测试] 从 ${TEST_FILE} 读入 ${events.length} 场比分`);
} else {
  let res = null, lastErr = "";
  const daysParam = DAYS_FROM ? `&daysFrom=${encodeURIComponent(DAYS_FROM)}` : "";
  for (const k of KEYS) {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${SPORT}/scores/?apiKey=${k}${daysParam}`);
    if (r.ok) { res = r; break; }
    lastErr = `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`;
    console.error(`scores key 不可用（${r.status}），尝试下一个`);
  }
  if (!res) throw new Error(`scores 拉取失败：${lastErr}`);
  console.log(`scores 额度剩余: ${res.headers.get("x-requests-remaining")}｜本次消耗: ${res.headers.get("x-requests-last")}`);
  events = await res.json();
}

// ---- 建 队名pair → 盘口 映射（拿 matchId、判断是否已 closed）----
const marketByPair = new Map();
try {
  const mk = JSON.parse(fs.readFileSync(MARKETS_FILE, "utf8")).markets;
  for (const m of mk) marketByPair.set(pairKey(m.home, m.away), m);
} catch (e) {
  console.error(`读 markets 失败：${MARKETS_FILE}`, e.message);
}

// ---- 建 队名pair → 前端赛程，用于写回比分/赛果 ----
let matchesPayload = null;
const matchByPair = new Map();
try {
  matchesPayload = JSON.parse(fs.readFileSync(MATCHES_FILE, "utf8"));
  for (const m of matchesPayload.matches || []) matchByPair.set(pairKey(m.home, m.away), m);
} catch (e) {
  console.error(`读 matches 失败：${MATCHES_FILE}`, e.message);
}

// ---- 逐场：有比分就写回；completed → 算 result → 调 /admin/settle ----
let settled = 0, skipped = 0, unmatched = 0, scoreUpdated = 0, scoreUnchanged = 0, liveUpdated = 0;
for (const e of events) {
  const zhH = EN2ZH[e.home_team], zhA = EN2ZH[e.away_team];
  if (!zhH || !zhA) { unmatched++; continue; }

  const sc = {};
  for (const s of (e.scores || [])) sc[s.name] = Number(s.score);
  const hs = sc[e.home_team], as = sc[e.away_team];
  if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
  const key = pairKey(zhH, zhA);
  const match = matchByPair.get(key);
  const market = marketByPair.get(key);
  const siteHome = match?.home || market?.home || zhH;
  const siteHomeIsEventHome = siteHome === zhH;
  const homeScore = siteHomeIsEventHome ? hs : as;
  const awayScore = siteHomeIsEventHome ? as : hs;
  const score = `${homeScore}-${awayScore}`;
  const isCompleted = e.completed === true;
  const result = isCompleted ? (homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw") : null;

  if (match) {
    const changed =
      Number(match.homeScore) !== homeScore ||
      Number(match.awayScore) !== awayScore ||
      match.score !== score ||
      match.completed !== isCompleted ||
      match.live !== !isCompleted ||
      (isCompleted && match.result !== result);
    if (changed) {
      match.homeScore = homeScore;
      match.awayScore = awayScore;
      match.score = score;
      match.completed = isCompleted;
      match.live = !isCompleted;
      match.scoreSource = "the-odds-api";
      match.scoreUpdatedAt = nowIso();
      if (isCompleted) match.result = result;
      else delete match.result;
      scoreUpdated++;
      if (!isCompleted) liveUpdated++;
    } else {
      scoreUnchanged++;
    }
  } else {
    console.log(`未匹配赛程：${zhH} vs ${zhA}`);
  }

  if (!isCompleted) continue;
  if (!market) { console.log(`未匹配盘口：${zhH} vs ${zhA}`); unmatched++; continue; }
  if (market.state === "closed") { skipped++; continue; } // 已结算

  if (DRY_RUN) {
    console.log(`[DRY] 将结算 ${market.matchId}  ${market.home} ${homeScore}-${awayScore} ${market.away} → ${result}`);
    settled++;
    continue;
  }
  try {
    const r = await fetch(`${ARENA_BASE}/admin/settle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: market.matchId, result })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { console.log(`结算 ${market.matchId}  ${market.home} ${homeScore}-${awayScore} ${market.away} → ${result}（${j.settled ?? "?"} 注）`); settled++; }
    else console.error(`结算失败 ${market.matchId}：HTTP ${r.status} ${JSON.stringify(j)}`);
  } catch (e) {
    console.error(`结算失败 ${market.matchId}：${e.message}`);
  }
}

if (matchesPayload && scoreUpdated) {
  matchesPayload.updatedAt = nowIso();
  matchesPayload.scoreUpdatedAt = matchesPayload.updatedAt;
  if (DRY_RUN) {
    console.log(`[DRY] 将写回赛果 ${scoreUpdated} 场到 ${MATCHES_FILE}`);
  } else {
    atomicWriteJson(MATCHES_FILE, matchesPayload);
    console.log(`已写回赛果 ${scoreUpdated} 场到 ${MATCHES_FILE}`);
  }
}
console.log(`比分处理完成：比分更新 ${scoreUpdated} 场（直播 ${liveUpdated} 场），比分不变 ${scoreUnchanged} 场，结算 ${settled} 场，跳过(已结算) ${skipped} 场，未匹配 ${unmatched} 场。`);
