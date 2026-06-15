import fs from "node:fs";

const FILE = process.argv[2] || "data/matches.json";
const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));

const stalePatterns = [
  /竞彩固定奖金和模型概率仍待接入/,
  /竞彩固定奖金与模型概率仍待接入/,
  /模型概率仍待接入/,
  /赔率、竞彩固定奖金和模型概率等待数据源接入/,
  /赔率、竞彩固定奖金和模型概率等待接入/
];

const keep = (note, match) => {
  const hasConnectedData = Boolean(
    match.lottery ||
    match.offshore ||
    ["home", "draw", "away"].some((key) => Number.isFinite(match.model?.[key]))
  );
  return !hasConnectedData || !stalePatterns.some((pattern) => pattern.test(String(note)));
};

if (Array.isArray(payload.notice) || typeof payload.notice === "string") {
  if (typeof payload.notice === "string" && stalePatterns.some((pattern) => pattern.test(payload.notice))) {
    payload.notice = "2026 世界杯真实赛程、竞彩固定奖金、海外赔率与模型概率研究页。";
  }
}

let cleaned = 0;
for (const match of payload.matches || []) {
  if (!match.model) continue;
  const notes = Array.isArray(match.model.notes) ? match.model.notes : [];
  const next = notes.filter((note) => keep(note, match));
  cleaned += notes.length - next.length;
  match.model.notes = next;
}

fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + "\n");
console.log(`已清理 ${FILE} 中 ${cleaned} 条过期备注`);
