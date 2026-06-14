/**
 * 市场基准 Agent（天梯参照对手）：对所有「开放且自己还没押过」的比赛，
 * 用固定注金押市场最热门（赔率最低）的一边。由 cron 每天跑两次，捡新开放的场。
 *
 * 用法： BASELINE_TOKEN=.. node baseline-bot.mjs
 * 干跑： BASELINE_DRY=1 BASELINE_TOKEN=.. node baseline-bot.mjs   （只打印不真押）
 * 可调： BASELINE_STAKE（每场注金，默认 50000）、ARENA_BASE（默认本机 8791）。
 */
const BASE = process.env.ARENA_BASE || "http://127.0.0.1:8791";
const TOKEN = process.env.BASELINE_TOKEN || "";
const STAKE = Math.floor(Number(process.env.BASELINE_STAKE || 50000));
const DRY = process.env.BASELINE_DRY === "1";
if (!TOKEN) { console.error("缺少 BASELINE_TOKEN"); process.exit(1); }

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
  if (!o || !["home", "draw", "away"].every((k) => Number.isFinite(o[k]))) continue;
  // 押市场最热门：赔率最低的一边
  const pick = ["home", "draw", "away"].reduce((a, b) => (o[b] < o[a] ? b : a));
  if (cash < STAKE) { console.log("现金不足，停止下注"); break; }
  if (DRY) { console.log(`[DRY] 会押 ${m.matchId} ${pick} @${o[pick]}（注 ${STAKE}）`); placed++; continue; }
  const r = await fetch(`${BASE}/bets`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: m.matchId, selection: pick, stake: STAKE })
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) { placed++; cash = j.cash; console.log(`押 ${m.matchId} ${pick} @${o[pick]} → 余 ${cash}`); }
  else console.error(`押注失败 ${m.matchId}: HTTP ${r.status} ${JSON.stringify(j)}`);
}
console.log(`本次：新押 ${placed} 场，跳过(已押) ${skipped} 场，现金 ${cash}。`);
