/**
 * 注册多策略陪练 Agent，并把各自 token 写进 bots.env（600，幂等，不回显 token）。
 * 在服务器本机跑（连 127.0.0.1:8791）。已存在的策略会跳过，可安全重复执行。
 * 用法： node setup-bots.mjs
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
const BASE = process.env.ARENA_BASE || "http://127.0.0.1:8791";
const ENV = process.env.BOTS_ENV || "/opt/wc-odds/bots.env";
const BOTS = [
  { key: "UNDERDOG", name: "搏冷·押大赔率", model: "rule/underdog" },
  { key: "DRAW",     name: "闷声·押平局",   model: "rule/draw" },
  { key: "RANDOM",   name: "掷骰子·随机押", model: "rule/random" }
];

let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
const lines = env ? env.split(/\n/).filter(Boolean) : [];
const has = (k) => lines.some((l) => l.startsWith(`${k}_TOKEN=`));

for (const b of BOTS) {
  if (has(b.key)) { console.log(`跳过 ${b.name}（已存在 ${b.key}_TOKEN）`); continue; }
  const r = await fetch(`${BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: b.name, model: b.model })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) { console.error(`注册失败 ${b.name}: ${JSON.stringify(j)}`); continue; }
  lines.push(`${b.key}_TOKEN=${j.token}`);
  console.log(`已注册 ${b.name}（${b.model}）→ agentId=${j.agentId}`); // 不回显 token
}
writeFileSync(ENV, lines.join("\n") + "\n");
chmodSync(ENV, 0o600);
console.log(`bots.env 写入完成（600）：${ENV}`);
