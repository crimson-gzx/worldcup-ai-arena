/**
 * 通用策略陪练 Agent（天梯参照对手）：对所有「开放且自己还没押过」的比赛各押一注。
 * 和 baseline-bot.mjs 同源，只是把「押哪边」抽成可选策略，方便铺多个性格不同的对手。
 *
 * 策略 STRATEGY：
 *   favorite  押最热门（赔率最低）      underdog  押最冷门（赔率最高，搏大赔率）
 *   draw      只押平局                 random    随机押一边（瞎蒙对照组）
 *
 * 用法： STRATEGY=underdog BOT_TOKEN=.. node strategy-bot.mjs
 * 干跑： BOT_DRY=1 STRATEGY=draw BOT_TOKEN=.. node strategy-bot.mjs   （只打印不真押）
 * 可调： BOT_STAKE（每场注金，默认 100000）、ARENA_BASE（默认本机 8791）。
 */
const BASE = process.env.ARENA_BASE || "http://127.0.0.1:8791";
const TOKEN = process.env.BOT_TOKEN || "";
const STRATEGY = (process.env.STRATEGY || "favorite").toLowerCase();
const STAKE = Math.floor(Number(process.env.BOT_STAKE || 100000));
const DRY = process.env.BOT_DRY === "1";
if (!TOKEN) { console.error("缺少 BOT_TOKEN"); process.exit(1); }

const SIDES = ["home", "draw", "away"];
function pickSide(o) {
  if (STRATEGY === "draw") return "draw";
  if (STRATEGY === "random") return SIDES[Math.floor(Math.random() * SIDES.length)];
  if (STRATEGY === "underdog") return SIDES.reduce((a, b) => (o[b] > o[a] ? b : a)); // 赔率最高
  return SIDES.reduce((a, b) => (o[b] < o[a] ? b : a)); // favorite：赔率最低
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const mk = await (await fetch(`${BASE}/markets`)).json();
const markets = mk.markets || [];
const me = await (await fetch(`${BASE}/agents/me`, { headers: auth })).json();
if (me.error) { console.error("token 无效或查询失败:", me.error); process.exit(1); }
const alreadyBet = new Set((me.bets || []).map((b) => b.matchId));
let cash = me.cash;

let placed = 0, skipped = 0;
for (const m of markets) {
  if (alreadyBet.has(m.matchId)) { skipped++; continue; }
  const o = m.oneXTwo;
  if (!o || !SIDES.every((k) => Number.isFinite(o[k]))) continue;
  const pick = pickSide(o);
  if (cash < STAKE) { console.log("现金不足，停止下注"); break; }
  if (DRY) { console.log(`[DRY ${STRATEGY}] 会押 ${m.matchId} ${pick} @${o[pick]}（注 ${STAKE}）`); placed++; continue; }
  const r = await fetch(`${BASE}/bets`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: m.matchId, selection: pick, stake: STAKE })
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) { placed++; cash = j.cash; console.log(`[${STRATEGY}] 押 ${m.matchId} ${pick} @${o[pick]} → 余 ${cash}`); }
  else console.error(`押注失败 ${m.matchId}: HTTP ${r.status} ${JSON.stringify(j)}`);
}
console.log(`[${STRATEGY}] 本次：新押 ${placed} 场，跳过(已押) ${skipped} 场，现金 ${cash}。`);
