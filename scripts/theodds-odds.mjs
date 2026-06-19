/**
 * 从 the-odds-api 拉 FIFA 世界杯小组赛 欧赔(h2h)+亚盘(spreads)+大小球(totals)，
 * 聚合多家博彩公司：欧赔取均价；亚盘/大小球取「共识线（众数）」再对该线均价。
 * 写入 data/matches.json 的 match.offshore.{oneXTwo,asian,totals}。
 *
 * 用法： ODDS_API_KEY=你的key node scripts/theodds-odds.mjs [data/matches.json]
 * 免费档 500 次/月；本脚本每次消耗 = 区域数 × 市场数（eu,uk,us × 3 = 9 次）。
 * 只有小组赛能匹配（淘汰赛球队未定）。app.js fetch 用 cache:no-store，scp 上线即刷新、无需 bump 版本。
 */
import fs from "node:fs";

const KEYS = (process.env.ODDS_API_KEYS || process.env.ODDS_API_KEY || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const CURSOR_FILE = process.env.ODDS_CURSOR || ".odds-key-cursor";
const SPORT = "soccer_fifa_world_cup";
const REGIONS = process.env.ODDS_REGIONS || "eu,uk,us";
const MARKETS = process.env.ODDS_MARKETS || "h2h,spreads,totals"; // 临场轻量可设 "h2h" 只刷胜平负
const FILE = process.argv[2] || "data/matches.json";
if (!KEYS.length) { console.error("缺少 ODDS_API_KEY 或 ODDS_API_KEYS"); process.exit(1); }

const EN2ZH = {
  Algeria:"阿尔及利亚",Argentina:"阿根廷",Australia:"澳大利亚",Austria:"奥地利",Belgium:"比利时","Bosnia & Herzegovina":"波黑",Brazil:"巴西",Canada:"加拿大","Cape Verde":"佛得角",Colombia:"哥伦比亚",Croatia:"克罗地亚","Curaçao":"库拉索",Curacao:"库拉索","Czech Republic":"捷克","DR Congo":"刚果民主共和国","D.R. Congo":"刚果民主共和国",Ecuador:"厄瓜多尔",Egypt:"埃及",England:"英格兰",France:"法国",Germany:"德国",Ghana:"加纳",Haiti:"海地",Iran:"伊朗",Iraq:"伊拉克","Ivory Coast":"科特迪瓦",Japan:"日本",Jordan:"约旦","Korea Republic":"韩国","South Korea":"韩国",Mexico:"墨西哥",Morocco:"摩洛哥",Netherlands:"荷兰","New Zealand":"新西兰",Norway:"挪威",Panama:"巴拿马",Paraguay:"巴拉圭",Portugal:"葡萄牙",Qatar:"卡塔尔","Saudi Arabia":"沙特阿拉伯",Scotland:"苏格兰",Senegal:"塞内加尔","South Africa":"南非",Spain:"西班牙",Sweden:"瑞典",Switzerland:"瑞士",Tunisia:"突尼斯",Turkey:"土耳其",USA:"美国",Uruguay:"乌拉圭",Uzbekistan:"乌兹别克斯坦"
};
const pairKey = (a, b) => [a, b].sort().join("::");
const mean = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100 : null);
const mode = (a) => { const c = {}; a.forEach((x) => (c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0]; };
const fmtHcap = (p) => (p > 0 ? "+" : "") + p;
const cleanNotes = (notes) => (Array.isArray(notes) ? notes : []).filter((note) => {
  const text = String(note);
  return !text.startsWith("海外欧赔") && !/竞彩固定奖金.*待接入|模型概率.*待接入|模型概率等待/.test(text);
});
const oddsOk = (value, max = 80) => Number.isFinite(value) && value > 1.01 && value <= max;
const implied = (values) => values.reduce((sum, value) => sum + 1 / value, 0);
const saneThreeWay = (odds) => {
  const values = [odds.home, odds.draw, odds.away];
  if (!values.every((value) => oddsOk(value))) return false;
  const total = implied(values);
  return total >= 0.9 && total <= 1.25;
};
const saneTotals = (row) => {
  if (!row || !Number.isFinite(row.line) || row.line < 1.5 || row.line > 5.5) return false;
  if (!oddsOk(row.over) || !oddsOk(row.under)) return false;
  const total = implied([row.over, row.under]);
  return total >= 0.9 && total <= 1.25;
};
const kickoffTime = (match) => {
  const raw = String(match.kickoff || "").trim();
  if (!raw) return NaN;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + ":00+08:00";
  return Date.parse(iso);
};
const hasStarted = (match, nowMs) => {
  const ts = kickoffTime(match);
  return Number.isFinite(ts) && nowMs >= ts;
};

const aggH2H = (e) => { const hs=[],ds=[],as=[]; for(const b of e.bookmakers){const mk=b.markets.find(x=>x.key==="h2h");if(!mk)continue;const o=Object.fromEntries(mk.outcomes.map(x=>[x.name,x.price]));const h=o[e.home_team],a=o[e.away_team],d=o["Draw"];if(saneThreeWay({home:h,draw:d,away:a})){hs.push(h);as.push(a);ds.push(d);}} return hs.length?{home:mean(hs),draw:mean(ds),away:mean(as),books:hs.length}:null; };
const aggSpreads = (e) => { const r=[]; for(const b of e.bookmakers){const mk=b.markets.find(x=>x.key==="spreads");if(!mk)continue;const H=mk.outcomes.find(o=>o.name===e.home_team),A=mk.outcomes.find(o=>o.name===e.away_team);if(H&&A&&Number.isFinite(H.price)&&Number.isFinite(A.price))r.push({hp:H.point,hpr:H.price,apr:A.price});} if(!r.length)return null; const c=Number(mode(r.map(x=>String(x.hp))));const at=r.filter(x=>x.hp===c);return{homePoint:c,home:mean(at.map(x=>x.hpr)),away:mean(at.map(x=>x.apr))}; };
const aggTotals = (e) => { const r=[]; for(const b of e.bookmakers){const mk=b.markets.find(x=>x.key==="totals");if(!mk)continue;const O=mk.outcomes.find(o=>o.name==="Over"),U=mk.outcomes.find(o=>o.name==="Under");if(O&&U&&O.point===U.point&&Number.isFinite(O.price)&&Number.isFinite(U.price))r.push({pt:O.point,o:O.price,u:U.price});} if(!r.length)return null; const c=Number(mode(r.map(x=>String(x.pt))));const at=r.filter(x=>x.pt===c);return{line:c,over:mean(at.map(x=>x.o)),under:mean(at.map(x=>x.u))}; };

// 多 key 轮询：从上次游标的下一个 key 开始，额度耗尽/失效（401/402/429 等）自动跳到下一个
let startIdx = 0;
try { startIdx = (parseInt(fs.readFileSync(CURSOR_FILE, "utf8").trim(), 10) + 1) % KEYS.length; } catch {}
let res = null, usedIdx = -1, lastErr = "";
for (let i = 0; i < KEYS.length; i++) {
  const idx = (startIdx + i) % KEYS.length;
  const r = await fetch(`https://api.the-odds-api.com/v4/sports/${SPORT}/odds/?apiKey=${KEYS[idx]}&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=decimal`);
  if (r.ok) { res = r; usedIdx = idx; break; }
  lastErr = `key#${idx + 1} → HTTP ${r.status} ${(await r.text()).slice(0, 120)}`;
  console.error(`key#${idx + 1}/${KEYS.length} 不可用（HTTP ${r.status}），尝试下一个`);
}
if (!res) throw new Error(`所有 ${KEYS.length} 个 key 均失败：${lastErr}`);
try { fs.writeFileSync(CURSOR_FILE, String(usedIdx)); } catch {}
console.log(`使用 key#${usedIdx + 1}/${KEYS.length}｜额度剩余: ${res.headers.get("x-requests-remaining")}｜本次消耗: ${res.headers.get("x-requests-last")}`);
const odds = await res.json();

const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
const byPair = new Map();
for (const m of payload.matches) if (m.tags.includes("group")) byPair.set(pairKey(m.home, m.away), m);

const collectedAt = new Date().toISOString();
const nowMs = Date.now();
let matched = 0, asianN = 0, totalsN = 0, skippedStarted = 0, rejectedOdds = 0;
for (const e of odds) {
  const zhH = EN2ZH[e.home_team], zhA = EN2ZH[e.away_team];
  if (!zhH || !zhA) continue;
  const m = byPair.get(pairKey(zhH, zhA)); if (!m) continue;
  if (hasStarted(m, nowMs)) { skippedStarted++; continue; }
  const h = aggH2H(e); if (!h) { rejectedOdds++; continue; }
  const same = m.home === zhH && m.away === zhA;
  const oneXTwo = same ? { home: h.home, draw: h.draw, away: h.away } : { home: h.away, draw: h.draw, away: h.home };
  if (!saneThreeWay(oneXTwo)) { rejectedOdds++; continue; }
  let asian = null; const sp = aggSpreads(e);
  if (sp) { asian = same ? { line: fmtHcap(sp.homePoint), home: sp.home, away: sp.away } : { line: fmtHcap(-sp.homePoint), home: sp.away, away: sp.home }; asianN++; }
  let totals = null; const to = aggTotals(e);
  if (saneTotals(to)) { totals = { line: to.line, over: to.over, under: to.under }; totalsN++; }
  const prevOff = m.offshore || {};
  m.offshore = { source: "the-odds-api", desc: `${h.books} 家博彩均值`, regions: REGIONS, collectedAt, oneXTwo, asian: asian || prevOff.asian || null, totals: totals || prevOff.totals || null };
  m.model = m.model || {};
  m.model.notes = cleanNotes(m.model.notes);
  m.model.notes.push(`海外欧赔/亚盘/大小 = the-odds-api 聚合多家博彩均值（${REGIONS}，${collectedAt.slice(0, 10)}）。`);
  matched++;
}
payload.updatedAt = collectedAt;
payload.oddsSource = { name: "the-odds-api", market: "h2h+spreads+totals", regions: REGIONS, aggregation: "mean across books, consensus line", collectedAt, matched };
fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + "\n");
console.log(`已写入 ${FILE}：匹配 ${matched} 场（含亚盘 ${asianN}、大小球 ${totalsN}）`);
if (skippedStarted || rejectedOdds) console.log(`保护跳过：已开赛 ${skippedStarted} 场，异常赔率 ${rejectedOdds} 场`);
