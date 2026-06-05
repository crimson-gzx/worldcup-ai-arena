/**
 * 用 OpenAI 兼容 LLM 给小组赛生成「自建模型」胜平负概率 + xG，写入 match.model。
 * 模型独立判断（不喂市场赔率），与海外均值的差异 → 站点的「分歧指数」。
 *
 * 用法：
 *   MODEL_API_BASE=https://vip-sg.freemodel.dev MODEL_API_KEY=xxx node scripts/model-probs.mjs [data/matches.json]
 *   可选 MODEL_NAME（默认 gpt-5.4）。
 * 注意：只处理小组赛（淘汰赛球队未定）。matches.json fetch 用 cache:no-store，scp 上线即刷新。
 */
import fs from "node:fs";

const BASE = process.env.MODEL_API_BASE;
const KEY = process.env.MODEL_API_KEY;
const NAME = process.env.MODEL_NAME || "gpt-5.5";
const FILE = process.argv[2] || "data/matches.json";
if (!BASE || !KEY) { console.error("需要 MODEL_API_BASE 和 MODEL_API_KEY 环境变量"); process.exit(1); }

const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
const groups = payload.matches.filter((m) => m.tags.includes("group"));
const SRC_NOTE = `模型胜平负概率由 ${NAME} 独立估计（未参考市场赔率），仅供研究。`;
const sys = "你是 2026 FIFA 世界杯的足球赛果预测模型。根据球队实力、世界排名、近况和阵容质量，独立估计每场的主胜/平局/客胜概率（小数，相加=1.0）以及双方预期进球(xG, 0.2~3.5)。不要参考博彩赔率。只输出 JSON。";

const ask = async (batch) => {
  const user = "为下列比赛预测，严格输出 {\"predictions\":[{matchId,home,draw,away,xgHome,xgAway,note}]}（home=主胜概率,note≤16字中文）：\n" +
    batch.map((m) => `${m.id}: ${m.home}(主) vs ${m.away}(客)`).join("\n");
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: NAME, messages: [{ role: "system", content: sys }, { role: "user", content: user }], response_format: { type: "json_object" } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
  return parsed.predictions || parsed;
};

const byId = new Map(groups.map((m) => [m.id, m]));
let done = 0;
for (let i = 0; i < groups.length; i += 24) {
  const preds = await ask(groups.slice(i, i + 24));
  for (const p of preds) {
    const m = byId.get(p.matchId); if (!m) continue;
    const sum = p.home + p.draw + p.away; if (!(sum > 0)) continue;
    const offNote = (m.model?.notes || []).find((n) => n.startsWith("海外"));
    m.model = {
      home: Math.round((p.home / sum) * 1000) / 1000,
      draw: Math.round((p.draw / sum) * 1000) / 1000,
      away: Math.round((p.away / sum) * 1000) / 1000,
      xgHome: Math.round((p.xgHome || 0) * 100) / 100,
      xgAway: Math.round((p.xgAway || 0) * 100) / 100,
      notes: [p.note, SRC_NOTE].concat(offNote ? [offNote] : [])
    };
    done++;
  }
  console.log(`累计 ${done}/${groups.length}`);
}
payload.updatedAt = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + "\n");
console.log(`已写入 ${FILE}：模型概率 ${done} 场`);
