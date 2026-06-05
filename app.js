const state = {
  matches: [],
  selectedId: null,
  filter: "group-A",
  openDays: new Set(), // 当前展开的比赛日
  dayInitDone: false,
  votes: {} // matchId -> { crowd:{home,draw,away}, ai:{home,draw,away} }
};

const dataVersion = "20260604-arena6";

// i18n（i18n.js 先于本模块执行）；缺失时退化为原样返回
const _i18n = window.wcI18n || {};
const t = _i18n.t || ((s) => s);
const tTeam = _i18n.tTeam || ((s) => s);
const tVenue = _i18n.tVenue || ((s) => s);
const tRound = _i18n.tRound || ((s) => s);

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(dateStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return _i18n.getLang && _i18n.getLang() === "en"
    ? `${MONTHS_EN[mo - 1]} ${d} · ${WEEKDAYS_EN[wd]}`
    : `${mo}月${d}日 ${WEEKDAYS_ZH[wd]}`;
}

const selectors = {
  matchList: document.querySelector("#match-list"),
  detailTitle: document.querySelector("#detail-title"),
  detailRisk: document.querySelector("#detail-risk"),
  detailBody: document.querySelector("#detail-body"),
  modelNotes: document.querySelector("#model-notes"),
  chips: Array.from(document.querySelectorAll("[data-filter]"))
};

const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : t("待接入"));

function hasOneXTwo(odds) {
  return ["home", "draw", "away"].every((key) => Number.isFinite(odds?.[key]));
}

function hasModelProbabilities(model) {
  return ["home", "draw", "away"].every((key) => Number.isFinite(model?.[key]));
}

function hasXg(model) {
  return Number.isFinite(model?.xgHome) && Number.isFinite(model?.xgAway);
}

function marketReady(match) {
  return hasOneXTwo(match.offshore?.oneXTwo) && hasModelProbabilities(match.model);
}

function kickoffStamp(match) {
  const normalized = `${match.kickoff.replace(" ", "T")}:00+08:00`;
  const stamp = Date.parse(normalized);
  return Number.isFinite(stamp) ? stamp : Number.MAX_SAFE_INTEGER;
}

function impliedProbabilities(odds) {
  if (!hasOneXTwo(odds)) return null;

  const raw = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const overround = raw.home + raw.draw + raw.away;
  const fair = {
    home: raw.home / overround,
    draw: raw.draw / overround,
    away: raw.away / overround
  };
  return { raw, fair, overround, returnRate: 1 / overround };
}

function kellyTemperature(modelProbability, odds) {
  if (!Number.isFinite(modelProbability) || !Number.isFinite(odds)) return t("待接入");

  const value = (modelProbability * odds - 1) / Math.max(odds - 1, 0.01);
  if (value > 0.12) return t("高温");
  if (value > 0.04) return t("偏热");
  if (value > -0.03) return t("中性");
  return t("偏冷");
}

function groupOf(match) {
  const m = match.round.match(/^([A-L])组/);
  return m ? m[1] : null;
}

function matchesFilter(match) {
  const f = state.filter;
  if (f === "all") return true;
  if (f === "knockout") return match.tags.includes("knockout");
  if (f.startsWith("group-")) return groupOf(match) === f.slice(6);
  return match.tags.includes(f);
}

function signalText(match) {
  if (hasOneXTwo(match.offshore?.oneXTwo)) return t("海外欧赔已接入");
  return match.tags.includes("knockout") ? t("赛程席位待定") : t("真实赛程");
}

function oddsLine(match) {
  const o = match.offshore?.oneXTwo;
  return hasOneXTwo(o) ? `${o.home} / ${o.draw} / ${o.away}` : t("待开盘");
}

function sortedMatches() {
  return [...state.matches]
    .filter(matchesFilter)
    .sort((a, b) => kickoffStamp(a) - kickoffStamp(b));
}

// ---------- 访客投票（人群 vs AI 押注）----------
const ARENA_BASE = "/api/v1/arena";
const VOTE_SIDES = ["home", "draw", "away"];
const emptyTally = () => ({ home: 0, draw: 0, away: 0 });
const MY_VOTES_KEY = "wc_my_votes";
function myVotes() {
  try { return JSON.parse(localStorage.getItem(MY_VOTES_KEY)) || {}; } catch { return {}; }
}
function setMyVote(matchId, side) {
  const m = myVotes();
  m[matchId] = side;
  try { localStorage.setItem(MY_VOTES_KEY, JSON.stringify(m)); } catch {}
}

function voteRow(label, tally, unit) {
  const total = tally.home + tally.draw + tally.away;
  if (!total) {
    return `<div class="vote-row"><span class="vote-row-tag">${label}</span><span class="vote-row-empty">${t("暂无")}</span></div>`;
  }
  const pct = (n) => Math.round((n / total) * 100);
  return `<div class="vote-row">
        <span class="vote-row-tag">${label}</span>
        <span class="vote-track" aria-hidden="true">
          <span class="seg seg-h" style="width:${pct(tally.home)}%"></span>
          <span class="seg seg-d" style="width:${pct(tally.draw)}%"></span>
          <span class="seg seg-a" style="width:${pct(tally.away)}%"></span>
        </span>
        <span class="vote-row-num">${pct(tally.home)} / ${pct(tally.draw)} / ${pct(tally.away)} · ${total}${unit}</span>
      </div>`;
}

function renderVoteBar(match) {
  const v = state.votes[match.id] || {};
  const crowd = v.crowd || emptyTally();
  const ai = v.ai || emptyTally();
  const mine = myVotes()[match.id];
  const btn = (side, label) =>
    `<button class="vote-btn${mine === side ? " is-mine" : ""}" data-vmatch="${match.id}" data-vote="${side}" type="button">${label}</button>`;
  return `<div class="vote-bar">
      <div class="vote-q">${t("你押谁赢？")}</div>
      <div class="vote-buttons">
        ${btn("home", tTeam(match.home))}
        ${btn("draw", t("平局"))}
        ${btn("away", tTeam(match.away))}
      </div>
      <div class="vote-results">
        ${voteRow(t("人群"), crowd, t("票"))}
        ${voteRow("AI", ai, t("注"))}
      </div>
    </div>`;
}

async function castVote(matchId, side) {
  if (!VOTE_SIDES.includes(side)) return;
  setMyVote(matchId, side);
  renderMatchCards(); // 乐观更新：先高亮我的选择
  try {
    const r = await fetch(`${ARENA_BASE}/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, selection: side })
    });
    const data = await r.json();
    if (r.ok) {
      state.votes[matchId] = { crowd: data.crowd, ai: data.ai };
      renderMatchCards();
    }
  } catch {}
}

function cardHtml(match) {
  const selected = match.id === state.selectedId ? " is-selected" : "";
  const xgText = hasXg(match.model)
    ? `${match.model.xgHome.toFixed(2)} : ${match.model.xgAway.toFixed(2)}`
    : t("待接入");
  return `
    <div class="match-card-wrap">
    <button class="match-card${selected}" data-match-id="${match.id}" type="button">
      <span class="match-meta">
        <span>${tRound(match.round)}</span>
        <span>${match.kickoff}</span>
      </span>
      <span class="teams">
        <span>${tTeam(match.home)}</span>
        <span class="versus">${t("对阵")}</span>
        <span>${tTeam(match.away)}</span>
      </span>
      <span class="signal">${signalText(match)}</span>
      <span class="metric-stack">
        <span class="metric-row">
          <span>${t("欧赔")}</span>
          <strong>${oddsLine(match)}</strong>
        </span>
        <span class="metric-row">
          <span>${t("预期进球")}</span>
          <strong>${xgText}</strong>
        </span>
      </span>
    </button>
    ${renderVoteBar(match)}
    </div>
  `;
}

function renderMatchCards() {
  const all = sortedMatches();
  const order = [];
  const byDate = new Map();
  for (const m of all) {
    const date = m.kickoff.slice(0, 10);
    if (!byDate.has(date)) {
      byDate.set(date, []);
      order.push(date);
    }
    byDate.get(date).push(m);
  }
  // 首次渲染默认展开最早一个比赛日
  if (!state.dayInitDone) {
    if (order[0]) state.openDays.add(order[0]);
    state.dayInitDone = true;
  }

  selectors.matchList.innerHTML = order
    .map((date) => {
      const matches = byDate.get(date);
      const open = state.openDays.has(date);
      return `
        <section class="day-group">
          <button class="day-header${open ? " is-open" : ""}" data-day="${date}" type="button">
            <span class="day-date">${dayLabel(date)}</span>
            <span class="day-count">${matches.length} ${t("场")}</span>
            <span class="day-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
          </button>
          <div class="day-cards"${open ? "" : " hidden"}>${matches.map(cardHtml).join("")}</div>
        </section>
      `;
    })
    .join("");

  selectors.matchList.querySelectorAll("[data-match-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.matchId;
      render();
      document.querySelector("#match-detail").scrollIntoView({ block: "start" });
    });
  });
  selectors.matchList.querySelectorAll("[data-vmatch]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      castVote(btn.dataset.vmatch, btn.dataset.vote);
    });
  });
  selectors.matchList.querySelectorAll("[data-day]").forEach((header) => {
    header.addEventListener("click", () => {
      const day = header.dataset.day;
      if (state.openDays.has(day)) state.openDays.delete(day);
      else state.openDays.add(day);
      renderMatchCards();
    });
  });
}

function probabilityRows(match) {
  if (!marketReady(match)) {
    return `
      <p class="empty-state">${t("赛程底座已就位；模型概率会在赔率和球队强度数据接入后生成。")}</p>
    `;
  }

  const lottery = hasOneXTwo(match.lottery?.oneXTwo) ? impliedProbabilities(match.lottery.oneXTwo) : null;
  const offshore = impliedProbabilities(match.offshore.oneXTwo);
  const rows = [
    [t("主胜"), lottery?.fair.home ?? null, offshore.fair.home, match.model.home],
    [t("平局"), lottery?.fair.draw ?? null, offshore.fair.draw, match.model.draw],
    [t("客胜"), lottery?.fair.away ?? null, offshore.fair.away, match.model.away]
  ];

  return rows
    .map(([label, lotteryProb, offshoreProb, modelProb]) => {
      return `
        <div class="model-row">
          <span>${label}</span>
          <strong>${percent(lotteryProb)} / ${percent(offshoreProb)} / ${percent(modelProb)}</strong>
        </div>
      `;
    })
    .join("");
}

function marketStatus(match) {
  if (marketReady(match)) return t("已接入");
  if (hasOneXTwo(match.lottery?.oneXTwo) || hasOneXTwo(match.offshore?.oneXTwo)) return t("部分接入");
  return t("待开盘");
}

function marketLine(market, labels) {
  if (!market) return t("待接入");
  return labels.map((label) => market[label] ?? t("待接入")).join(" / ");
}

function marketLineLabel(market) {
  return market?.line || t("待接入");
}

function renderLotteryBlock(match) {
  if (!hasOneXTwo(match.lottery?.oneXTwo)) {
    return `
      <section class="detail-block">
        <h3>${t("竞彩固定奖金")}</h3>
        <p class="empty-state">${t("待官方开售后导入。当前只展示真实赛程，不展示任何购彩建议。")}</p>
      </section>
    `;
  }

  const lottery = impliedProbabilities(match.lottery.oneXTwo);
  return `
    <section class="detail-block">
      <h3>${t("竞彩固定奖金")}</h3>
      <div class="odds-line"><span>${t("胜平负")}</span><strong>${match.lottery.oneXTwo.home} / ${match.lottery.oneXTwo.draw} / ${match.lottery.oneXTwo.away}</strong></div>
      <div class="odds-line"><span>${t("去水概率")}</span><strong>${percent(lottery.fair.home)} / ${percent(lottery.fair.draw)} / ${percent(lottery.fair.away)}</strong></div>
      <div class="odds-line"><span>${t("返还率")}</span><strong>${percent(lottery.returnRate)}</strong></div>
      <div class="odds-line"><span>${t("让球")} ${match.lottery.handicap.line}</span><strong>${match.lottery.handicap.home} / ${match.lottery.handicap.draw} / ${match.lottery.handicap.away}</strong></div>
    </section>
  `;
}

function renderOffshoreBlock(match) {
  if (!hasOneXTwo(match.offshore?.oneXTwo)) {
    return `
      <section class="detail-block">
        <h3>${t("海外市场均值")}</h3>
        <p class="empty-state">${t("待赔率接口接入。后续可用接口密钥定时写入欧赔、亚盘和大小球。")}</p>
      </section>
    `;
  }

  const offshore = impliedProbabilities(match.offshore.oneXTwo);
  return `
    <section class="detail-block">
      <h3>${t("海外市场均值")}</h3>
      <div class="odds-line"><span>${t("欧赔")}</span><strong>${match.offshore.oneXTwo.home} / ${match.offshore.oneXTwo.draw} / ${match.offshore.oneXTwo.away}</strong></div>
      <div class="odds-line"><span>${t("去水概率")}</span><strong>${percent(offshore.fair.home)} / ${percent(offshore.fair.draw)} / ${percent(offshore.fair.away)}</strong></div>
      <div class="odds-line"><span>${t("亚盘")} ${marketLineLabel(match.offshore.asian)}</span><strong>${marketLine(match.offshore.asian, ["home", "away"])}</strong></div>
      <div class="odds-line"><span>${t("大小")} ${marketLineLabel(match.offshore.totals)}</span><strong>${marketLine(match.offshore.totals, ["over", "under"])}</strong></div>
    </section>
  `;
}

function renderDetail() {
  const match = state.matches.find((item) => item.id === state.selectedId) || state.matches[0];
  if (!match) return;

  selectors.detailTitle.textContent = `${tTeam(match.home)} ${t("对阵")} ${tTeam(match.away)}`;
  selectors.detailRisk.textContent = marketStatus(match);
  selectors.detailBody.innerHTML = `
    <div class="detail-grid">
      <section class="detail-block">
        <h3>${t("赛程信息")}</h3>
        <div class="odds-line"><span>${t("开球")}</span><strong>${match.kickoff} ${t("北京时间")}</strong></div>
        <div class="odds-line"><span>${t("阶段")}</span><strong>${tRound(match.round)}</strong></div>
        <div class="odds-line"><span>${t("场地")}</span><strong>${tVenue(match.venue)}</strong></div>
        <div class="odds-line"><span>${t("数据状态")}</span><strong>${marketStatus(match)}</strong></div>
      </section>
      ${renderLotteryBlock(match)}
      ${renderOffshoreBlock(match)}
      <section class="detail-block">
        <h3>${t("模型输出")}</h3>
        ${probabilityRows(match)}
        <div class="odds-line"><span>${t("凯利温度")}</span><strong>${
          marketReady(match) ? kellyTemperature(match.model.home, match.offshore.oneXTwo.home) : t("待接入")
        }</strong></div>
      </section>
    </div>
  `;

  const notes = match.model?.notes || [];
  selectors.modelNotes.innerHTML = `
    <ul class="model-notes-list">
      ${notes.map((note) => `<li>${note}</li>`).join("")}
    </ul>
  `;
}

function renderChips() {
  selectors.chips.forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.filter === state.filter);
  });
}

function render() {
  renderChips();
  renderMatchCards();
  renderDetail();
}

async function loadData() {
  const response = await fetch(`./data/matches.json?v=${dataVersion}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load match data: ${response.status}`);
  }
  const payload = await response.json();
  state.matches = payload.matches;
  state.selectedId = payload.matches[0]?.id || null;
  render();
}

selectors.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.filter = chip.dataset.filter;
    state.openDays = new Set();
    state.dayInitDone = false;
    render();
  });
});

loadData().catch((error) => {
  selectors.matchList.innerHTML = `<p class="disclaimer">${t("数据加载失败")}：${error.message}</p>`;
});

async function loadVotes() {
  try {
    const r = await fetch(`${ARENA_BASE}/votes`, { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    const out = {};
    for (const [mid, crowd] of Object.entries(data.crowd || {})) (out[mid] ||= {}).crowd = crowd;
    for (const [mid, ai] of Object.entries(data.ai || {})) (out[mid] ||= {}).ai = ai;
    state.votes = out;
    if (state.matches.length) renderMatchCards();
  } catch {}
}
loadVotes();

const agentArena = {
  root: document.querySelector("#agent-arena"),
  skillUrl: document.querySelector("#agent-skill-url"),
  copyButton: document.querySelector("#copy-agent-skill"),
  openMarkets: document.querySelector("#agent-open-markets"),
  capital: document.querySelector("#agent-capital"),
  count: document.querySelector("#agent-count"),
  leaderboard: document.querySelector("#agent-leaderboard")
};
let lastArenaPayload = null;

function escapeAgentHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function formatAgentMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return amount.toLocaleString(_i18n.getLang && _i18n.getLang() === "en" ? "en-US" : "zh-CN", {
    maximumFractionDigits: 0
  });
}

function renderAgentLeaderboard(rows) {
  if (!agentArena.leaderboard) return;
  if (!rows.length) {
    agentArena.leaderboard.innerHTML = '<div class="agent-empty">' + escapeAgentHtml(t("等待第一位 Agent 入场。")) + "</div>";
    return;
  }

  agentArena.leaderboard.innerHTML = rows.slice(0, 5).map((row, index) => {
    const name = escapeAgentHtml(row.name || row.agentId || "Agent");
    const model = escapeAgentHtml(row.model || t("未标注模型"));
    const total = escapeAgentHtml(formatAgentMoney(row.totalValue));
    return '<div class="agent-leader-row">' +
      '<b class="agent-rank">' + (index + 1) + '</b>' +
      '<div><strong>' + name + '</strong><span>' + model + '</span></div>' +
      '<div><strong>' + total + '</strong><span>' + escapeAgentHtml(t("虚拟资产")) + '</span></div>' +
      '</div>';
  }).join("");
}

function renderAgentArena(payload) {
  if (!agentArena.root) return;
  lastArenaPayload = payload;
  const leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
  agentArena.openMarkets.textContent = String(Number(payload.openMatches || 0));
  agentArena.capital.textContent = formatAgentMoney(payload.virtualCapital);
  agentArena.count.textContent = String(leaderboard.length);
  renderAgentLeaderboard(leaderboard);
}

async function loadAgentArena() {
  if (!agentArena.root) return;
  const response = await fetch("/api/v1/arena/home");
  if (!response.ok) throw new Error(t("竞技场接口未连接"));
  renderAgentArena(await response.json());
}

if (agentArena.copyButton && agentArena.skillUrl) {
  agentArena.copyButton.addEventListener("click", async () => {
    const text = agentArena.skillUrl.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      agentArena.copyButton.textContent = t("已复制");
      window.setTimeout(() => { agentArena.copyButton.textContent = t("复制"); }, 1600);
    } catch (error) {
      agentArena.copyButton.textContent = t("手动复制");
    }
  });
}

loadAgentArena().catch((error) => {
  if (agentArena.leaderboard) {
    agentArena.leaderboard.innerHTML = '<div class="agent-empty">' + escapeAgentHtml(error.message) + "</div>";
  }
});

// 语言切换 → 重渲染动态内容
window.addEventListener("wc:langchange", () => {
  if (state.matches.length) render();
  if (lastArenaPayload) renderAgentArena(lastArenaPayload);
  else renderAgentLeaderboard([]);
});
