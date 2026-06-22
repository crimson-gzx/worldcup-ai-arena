/**
 * 世界杯盘口研究所 · Agent 竞技场后端（纯 Node，零依赖，文件存储）。
 * nginx 反代 /api/v1/arena/ -> 127.0.0.1:ARENA_PORT
 * 全程虚拟资金，不涉及任何真实购彩。
 */
import http from "node:http";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ARENA_PORT || 8787);
const HOST = process.env.ARENA_HOST || "127.0.0.1";
const DATA_DIR = process.env.ARENA_DATA || join(HERE, "data");
const ADMIN_TOKEN = process.env.ARENA_ADMIN_TOKEN || "";
const VIRTUAL_CAPITAL = Number(process.env.ARENA_CAPITAL || 1000000);
const MAX_BODY = 8 * 1024;

const STATE_FILE = join(DATA_DIR, "state.json");
const MARKETS_FILE = join(DATA_DIR, "markets.json");
const VOTES_FILE = join(DATA_DIR, "votes.json");
const JOURNAL_FILE = join(DATA_DIR, "events.ndjson");
const STATE_BACKUP_DIR = join(DATA_DIR, "backups");
const STATE_BACKUP_KEEP = Math.max(5, Number(process.env.ARENA_STATE_BACKUP_KEEP || 120));

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(STATE_BACKUP_DIR, { recursive: true });

// ---------- 持久化 ----------
const loadJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
};
let state = loadJson(STATE_FILE, { config: { virtualCapital: VIRTUAL_CAPITAL }, agents: [], bets: [], events: [] });
if (!state.config) state.config = { virtualCapital: VIRTUAL_CAPITAL };
let markets = loadJson(MARKETS_FILE, { updatedAt: null, markets: [] });
let votes = loadJson(VOTES_FILE, { tallies: {}, voters: {} });

const saveAtomic = (file, obj) => {
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file);
};
const timestampId = () => new Date().toISOString().replace(/\D/g, "").slice(0, 17);
const pruneStateBackups = () => {
  const files = readdirSync(STATE_BACKUP_DIR)
    .filter((name) => /^state\.\d{17}\.json$/.test(name))
    .sort();
  for (const name of files.slice(0, Math.max(0, files.length - STATE_BACKUP_KEEP))) {
    unlinkSync(join(STATE_BACKUP_DIR, name));
  }
};
const backupState = () => {
  if (!existsSync(STATE_FILE)) return;
  copyFileSync(STATE_FILE, join(STATE_BACKUP_DIR, `state.${timestampId()}.json`));
  pruneStateBackups();
};
const journal = (entry) => {
  appendFileSync(JOURNAL_FILE, JSON.stringify({ ts: now(), ...entry }) + "\n");
};
const saveState = () => {
  backupState();
  saveAtomic(STATE_FILE, state);
};

// ---------- 工具 ----------
const sha = (s) => createHash("sha256").update(s).digest("hex");
const newId = (p) => p + randomBytes(6).toString("hex");
const now = () => new Date().toISOString();
const clampStr = (v, n) => String(v == null ? "" : v).slice(0, n).trim();
const normalizeAgentName = (v) => clampStr(v, 40).replace(/\s+/g, " ");
const agentNameTaken = (name, selfId = "") =>
  state.agents.some((a) => a.agentId !== selfId && String(a.name || "").toLowerCase() === name.toLowerCase());
const RENAME_COOLDOWN_MS = 24 * 3600_000;

function tokenOk(raw, hash) {
  if (!raw || !hash) return false;
  const a = Buffer.from(sha(raw));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
function findAgentByToken(raw) {
  if (!raw) return null;
  const h = sha(raw);
  return state.agents.find((a) => a.tokenHash === h) || null;
}

// 持仓中的注金（未结算）
const openStake = (agentId) =>
  state.bets.filter((b) => b.agentId === agentId && b.status === "open").reduce((s, b) => s + b.stake, 0);
const totalValue = (a) => Math.round(a.cash + openStake(a.agentId));
const hasPlacedBets = (row) => Number(row.betCount || 0) > 0;

// 某 agent 已结算注单的战绩与当前连胜（按结算时间排序，从最近一场往前数连续命中）
function agentStats(agentId) {
  const agentBets = state.bets.filter((b) => b.agentId === agentId);
  const settled = agentBets
    .filter((b) => b.status === "won" || b.status === "lost")
    .sort((a, b) => Date.parse(a.settledAt || 0) - Date.parse(b.settledAt || 0));
  let wins = 0, losses = 0, best = 0, run = 0;
  for (const b of settled) {
    if (b.status === "won") { wins++; run++; if (run > best) best = run; }
    else { losses++; run = 0; }
  }
  let streak = 0;
  for (let i = settled.length - 1; i >= 0; i--) {
    if (settled[i].status === "won") streak++; else break;
  }
  return {
    wins,
    losses,
    settled: settled.length,
    streak,
    best,
    betCount: agentBets.length,
    openBets: agentBets.filter((b) => b.status === "open").length
  };
}

function leaderboard() {
  const cap = state.config.virtualCapital || VIRTUAL_CAPITAL;
  return state.agents
    .map((a) => {
      const tv = totalValue(a);
      const s = agentStats(a.agentId);
      return {
        agentId: a.agentId, name: a.name, model: a.model,
        totalValue: tv,
        profit: tv - cap,
        roi: cap > 0 ? (tv - cap) / cap : 0,
        wins: s.wins, losses: s.losses, settled: s.settled,
        hitRate: s.settled > 0 ? s.wins / s.settled : 0,
        streak: s.streak, bestStreak: s.best,
        betCount: s.betCount, openBets: s.openBets
      };
    })
    .sort((x, y) =>
      Number(hasPlacedBets(y)) - Number(hasPlacedBets(x)) ||
      y.totalValue - x.totalValue ||
      y.settled - x.settled ||
      y.betCount - x.betCount ||
      String(x.name || "").localeCompare(String(y.name || ""), "zh-Hans-CN")
    );
}
const OPEN_HOURS_BEFORE = 48; // 每场默认开赛前多少小时开放投注（钩子场 openNow 除外）
const bettable = (m) => {
  if (m.state !== "open") return false;
  if (!m.cutoffAt) return true;
  const cut = Date.parse(m.cutoffAt);
  const now = Date.now();
  if (now >= cut) return false; // 已开赛一律关
  if (m.openNow) return true; // 钩子场（开幕战）：即刻开放，开赛即关
  return now >= cut - OPEN_HOURS_BEFORE * 3600000;
};
const openMarkets = () => markets.markets.filter(bettable);
const marketById = (matchId) => markets.markets.find((m) => m.matchId === matchId);
const voteClosed = (market) => {
  if (!market) return false;
  if (market.state === "closed") return true;
  const cut = Date.parse(market.cutoffAt || "");
  return Number.isFinite(cut) && Date.now() >= cut;
};

// ---------- 访客投票（人群 vs AI）----------
const VOTE_SIDES = ["home", "draw", "away"];
const emptyTally = () => ({ home: 0, draw: 0, away: 0 });
const saveVotes = () => saveAtomic(VOTES_FILE, votes);
// 把竞技场里所有 AI 的下注按 matchId 聚合成胜平负笔数分布
function allAiTally() {
  const out = {};
  for (const b of state.bets) {
    if (!VOTE_SIDES.includes(b.selection)) continue;
    (out[b.matchId] ||= emptyTally())[b.selection]++;
  }
  return out;
}

// ---------- 限流（内存，按 IP）----------
const hits = new Map();
function rateLimit(ip, bucket, max, windowMs) {
  const key = ip + ":" + bucket;
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  return arr.length <= max;
}

// ---------- HTTP 帮助 ----------
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
const bearer = (req) => {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
};
const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "0.0.0.0";

// ---------- 路由 ----------
async function route(req, res, path) {
  const ip = clientIp(req);

  // GET /home —— 前端首页契约
  if (req.method === "GET" && path === "/home") {
    return send(res, 200, {
      leaderboard: leaderboard(),
      openMatches: openMarkets().length,
      virtualCapital: state.config.virtualCapital,
      agentCount: state.agents.length
    });
  }

  if (req.method === "GET" && path === "/leaderboard") {
    return send(res, 200, { leaderboard: leaderboard() });
  }

  // GET /markets —— 开放盘口（给 agent 查）
  if (req.method === "GET" && path === "/markets") {
    return send(res, 200, {
      updatedAt: markets.updatedAt,
      virtualCapital: state.config.virtualCapital,
      markets: openMarkets().map((m) => ({
        matchId: m.matchId,
        home: m.home,
        away: m.away,
        state: m.state,
        oneXTwo: m.oneXTwo,
        cutoffAt: m.cutoffAt
      }))
    });
  }

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { ok: true, agents: state.agents.length, bets: state.bets.length });
  }

  // GET /votes —— 人群投票 + AI 押注分布（公开，给前端比赛卡片用）
  if (req.method === "GET" && path === "/votes") {
    return send(res, 200, { crowd: votes.tallies, ai: allAiTally() });
  }

  // POST /votes —— 访客投胜平负（匿名；同 IP+同场去重，可改票）
  if (req.method === "POST" && path === "/votes") {
    if (!rateLimit(ip, "vote", 60, 60_000)) return send(res, 429, { error: "投票过于频繁" });
    const body = await readBody(req);
    const matchId = clampStr(body.matchId, 40);
    const selection = clampStr(body.selection, 10);
    if (!/^[a-z0-9-]{3,40}$/.test(matchId)) return send(res, 400, { error: "matchId 非法" });
    const market = marketById(matchId);
    if (!market) return send(res, 400, { error: "matchId 不存在", matchId });
    if (voteClosed(market)) return send(res, 409, { error: "该场投票已截止", matchId, cutoffAt: market.cutoffAt });
    if (!VOTE_SIDES.includes(selection)) return send(res, 400, { error: "selection 须为 home/draw/away" });
    const tally = (votes.tallies[matchId] ||= emptyTally());
    const voterKey = sha(ip) + ":" + matchId;
    const prev = votes.voters[voterKey];
    if (prev !== selection) {
      if (prev && VOTE_SIDES.includes(prev) && tally[prev] > 0) tally[prev]--; // 改票：撤回旧票
      tally[selection]++;
      votes.voters[voterKey] = selection;
      saveVotes();
    }
    return send(res, 200, { matchId, crowd: tally, ai: allAiTally()[matchId] || emptyTally(), mine: selection });
  }

  // POST /agents —— 注册
  if (req.method === "POST" && path === "/agents") {
    if (!rateLimit(ip, "register", 5, 3600_000)) return send(res, 429, { error: "注册过于频繁，请稍后再试" });
    const body = await readBody(req);
    const name = normalizeAgentName(body.name);
    const model = clampStr(body.model, 40);
    if (name.length < 1) return send(res, 400, { error: "需要 name（队伍/Agent 名）" });
    if (agentNameTaken(name)) return send(res, 409, { error: "Agent 名已被占用，请换一个" });
    const token = randomBytes(24).toString("hex");
    const ts = now();
    const agent = {
      agentId: newId("a_"),
      name,
      model: model || "未标注模型",
      tokenHash: sha(token),
      cash: state.config.virtualCapital,
      joinedAt: ts,
      ip
    };
    state.agents.push(agent);
    state.events.push({ ts, type: "register", agentId: agent.agentId, name });
    journal({ type: "register", agentId: agent.agentId, name: agent.name, model: agent.model, ip });
    saveState();
    return send(res, 201, {
      agentId: agent.agentId,
      token,
      name: agent.name,
      model: agent.model,
      cash: agent.cash,
      note: "请妥善保存 token，提交投注时用 Authorization: Bearer <token>。全程虚拟资金。"
    });
  }

  // GET /agents/me —— 自己的状态
  if (req.method === "GET" && path === "/agents/me") {
    const agent = findAgentByToken(bearer(req));
    if (!agent) return send(res, 401, { error: "token 无效" });
    const myBets = state.bets.filter((b) => b.agentId === agent.agentId);
    return send(res, 200, {
      agentId: agent.agentId,
      name: agent.name,
      model: agent.model,
      cash: agent.cash,
      openStake: openStake(agent.agentId),
      totalValue: totalValue(agent),
      bets: myBets
    });
  }

  // PATCH /agents/me —— Agent 自助改名（只能改自己的展示名）
  if (req.method === "PATCH" && path === "/agents/me") {
    if (!rateLimit(ip, "rename", 10, 3600_000)) return send(res, 429, { error: "改名过于频繁，请稍后再试" });
    const agent = findAgentByToken(bearer(req));
    if (!agent) return send(res, 401, { error: "token 无效" });
    const body = await readBody(req);
    const name = normalizeAgentName(body.name);
    if (name.length < 1) return send(res, 400, { error: "需要 name（新的 Agent 名）" });
    if (name === agent.name) return send(res, 200, { ok: true, agentId: agent.agentId, name: agent.name, model: agent.model, unchanged: true });
    if (agentNameTaken(name, agent.agentId)) return send(res, 409, { error: "Agent 名已被占用，请换一个" });
    const lastRenamedAt = Date.parse(agent.renamedAt || agent.lastRenamedAt || 0);
    const elapsed = Date.now() - lastRenamedAt;
    if (Number.isFinite(lastRenamedAt) && elapsed < RENAME_COOLDOWN_MS) {
      return send(res, 429, {
        error: "改名冷却中，每 24 小时最多改一次",
        retryAfterSeconds: Math.ceil((RENAME_COOLDOWN_MS - elapsed) / 1000)
      });
    }
    const oldName = agent.name;
    const ts = now();
    agent.name = name;
    agent.renamedAt = ts;
    state.events.push({ ts, type: "rename_agent", agentId: agent.agentId, oldName, name });
    journal({ type: "rename_agent", agentId: agent.agentId, oldName, name, ip });
    saveState();
    return send(res, 200, { ok: true, agentId: agent.agentId, name: agent.name, model: agent.model, renamedAt: agent.renamedAt });
  }

  // POST /bets —— 提交单场模拟投注
  if (req.method === "POST" && path === "/bets") {
    if (!rateLimit(ip, "bet", 30, 60_000)) return send(res, 429, { error: "投注过于频繁" });
    const agent = findAgentByToken(bearer(req));
    if (!agent) return send(res, 401, { error: "token 无效" });
    const body = await readBody(req);
    const matchId = clampStr(body.matchId, 40);
    const selection = clampStr(body.selection, 10);
    const stake = Math.floor(Number(body.stake));
    if (!["home", "draw", "away"].includes(selection)) return send(res, 400, { error: "selection 须为 home/draw/away" });
    if (!Number.isFinite(stake) || stake <= 0) return send(res, 400, { error: "stake 须为正整数" });
    if (stake > agent.cash) return send(res, 400, { error: "余额不足", cash: agent.cash });
    const market = openMarkets().find((m) => m.matchId === matchId);
    if (!market) return send(res, 400, { error: "该场未开放投注（盘口未 open）", matchId });
    const odds = market.oneXTwo && market.oneXTwo[selection];
    if (!Number.isFinite(odds)) return send(res, 400, { error: "该选项赔率不可用" });

    agent.cash -= stake;
    const placedAt = now();
    const bet = {
      betId: newId("b_"),
      agentId: agent.agentId,
      matchId,
      selection,
      stake,
      odds,
      status: "open",
      placedAt
    };
    state.bets.push(bet);
    state.events.push({ ts: placedAt, type: "bet", agentId: agent.agentId, betId: bet.betId, matchId, selection, stake });
    journal({ type: "bet", agentId: agent.agentId, betId: bet.betId, matchId, selection, stake, odds, cashAfter: agent.cash, ip });
    saveState();
    return send(res, 201, { bet, cash: agent.cash });
  }

  // ---------- 管理端（需 ARENA_ADMIN_TOKEN）----------
  const isAdmin = ADMIN_TOKEN && bearer(req) === ADMIN_TOKEN;

  // POST /admin/markets —— 设置/开放盘口
  if (req.method === "POST" && path === "/admin/markets") {
    if (!isAdmin) return send(res, 403, { error: "需要管理员 token" });
    const body = await readBody(req);
    if (!Array.isArray(body.markets)) return send(res, 400, { error: "需要 markets 数组" });
    markets = { updatedAt: now(), markets: body.markets };
    saveAtomic(MARKETS_FILE, markets);
    return send(res, 200, { ok: true, count: markets.markets.length });
  }

  // POST /admin/settle —— 按比赛结果结算
  if (req.method === "POST" && path === "/admin/settle") {
    if (!isAdmin) return send(res, 403, { error: "需要管理员 token" });
    const body = await readBody(req); // { matchId, result: 'home'|'draw'|'away'|'void' }
    const matchId = clampStr(body.matchId, 40);
    const result = clampStr(body.result, 10);
    if (!["home", "draw", "away", "void"].includes(result)) return send(res, 400, { error: "result 非法" });
    let settled = 0;
    const settledAt = now();
    const settledBetIds = [];
    for (const b of state.bets) {
      if (b.matchId !== matchId || b.status !== "open") continue;
      if (result === "void") {
        const a = state.agents.find((x) => x.agentId === b.agentId);
        if (a) a.cash += b.stake; // 退注
        b.status = "void";
      } else if (b.selection === result) {
        const a = state.agents.find((x) => x.agentId === b.agentId);
        if (a) a.cash += Math.round(b.stake * b.odds);
        b.status = "won";
      } else {
        b.status = "lost";
      }
      b.settledAt = settledAt;
      settled++;
      settledBetIds.push(b.betId);
    }
    const mk = markets.markets.find((m) => m.matchId === matchId);
    if (mk) mk.state = "closed";
    saveAtomic(MARKETS_FILE, markets);
    state.events.push({ ts: settledAt, type: "settle", matchId, result, settled });
    journal({ type: "settle", matchId, result, settled, settledBetIds });
    saveState();
    return send(res, 200, { ok: true, matchId, result, settled });
  }

  if (req.method === "OPTIONS") return send(res, 204, {});
  return send(res, 404, { error: "未知接口", path });
}

const server = http.createServer((req, res) => {
  // 归一化路径：去掉可能的 /api/v1/arena 前缀
  let path = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
  path = path.replace(/^\/api\/v1\/arena/, "") || "/";
  route(req, res, path).catch((err) => {
    send(res, 400, { error: String(err.message || err) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[arena] listening http://${HOST}:${PORT}  data=${DATA_DIR}  capital=${state.config.virtualCapital}`);
});
