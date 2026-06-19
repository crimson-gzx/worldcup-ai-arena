const state = {
  matches: [],
  selectedId: null,
  filter: "recent",
  openDays: new Set(), // 当前展开的比赛日
  dayInitDone: false,
  squads: null,
  votes: {} // matchId -> { crowd:{home,draw,away}, ai:{home,draw,away} }
};

const dataVersion = "20260613-standings";
const SQUADS_DATA_VERSION = "20260613-team-values";
const RECENT_PAST_MS = 36 * 60 * 60 * 1000;
const RECENT_FUTURE_MS = 72 * 60 * 60 * 1000;

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

function hasHandicapOdds(odds) {
  return Boolean(odds?.line) && ["home", "draw", "away"].every((key) => Number.isFinite(odds?.[key]));
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

function isRecentMatch(match, now = Date.now()) {
  const stamp = kickoffStamp(match);
  if (stamp === Number.MAX_SAFE_INTEGER) return false;
  if (matchScore(match)?.live) return true;
  return stamp >= now - RECENT_PAST_MS && stamp <= now + RECENT_FUTURE_MS;
}

function matchesFilter(match) {
  const f = state.filter;
  if (f === "recent") return isRecentMatch(match);
  if (f === "all") return true;
  if (f === "knockout") return match.tags.includes("knockout");
  if (f.startsWith("group-")) return groupOf(match) === f.slice(6);
  return match.tags.includes(f);
}

function signalText(match) {
  const score = matchScore(match);
  if (score?.completed) return t("已完赛");
  if (score?.live) return t("进行中");
  if (hasOneXTwo(match.offshore?.oneXTwo)) return t("海外欧赔已接入");
  return match.tags.includes("knockout") ? t("赛程席位待定") : t("真实赛程");
}

function matchScore(match) {
  const homeScore = Number(match.homeScore);
  const awayScore = Number(match.awayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return { homeScore, awayScore, result: match.result || null, completed: match.completed === true, live: match.live === true };
}

function matchResult(match) {
  const score = matchScore(match);
  if (!score || !score.result || !score.completed) return null;
  return score;
}

function resultLine(match) {
  const r = matchScore(match);
  if (!r) return "";
  const label = r.completed ? t("完赛") : t("进行中");
  return `<span class="result-score${r.live ? " is-live" : ""}"><strong>${r.homeScore}</strong><em>${label}</em><strong>${r.awayScore}</strong></span>`;
}

function resultDetailText(match) {
  const r = matchScore(match);
  if (!r) return t("待接入");
  return `${tTeam(match.home)} ${r.homeScore} - ${r.awayScore} ${tTeam(match.away)}`;
}

function labeledOdds(pairs) {
  const cells = pairs
    .map(([lab, val]) => `<span class="o-cell"><span class="o-lab">${lab || "&nbsp;"}</span><span class="o-val">${val}</span></span>`)
    .join(`<span class="o-sep">/</span>`);
  return `<strong class="odds-1x2">${cells}</strong>`;
}

function oddsLine(match) {
  const o = match.offshore?.oneXTwo;
  if (!hasOneXTwo(o)) return `<strong>${t("待开盘")}</strong>`;
  return labeledOdds([[t("胜"), o.home], [t("平"), o.draw], [t("负"), o.away]]);
}

function sortedMatches() {
  const all = [...state.matches];
  const filtered = all
    .filter(matchesFilter)
    .sort((a, b) => kickoffStamp(a) - kickoffStamp(b));
  if (filtered.length || state.filter !== "recent") return filtered;

  const now = Date.now();
  const upcoming = all
    .filter((match) => kickoffStamp(match) >= now)
    .sort((a, b) => kickoffStamp(a) - kickoffStamp(b));
  if (upcoming.length) return upcoming.slice(0, 8);

  return all
    .filter((match) => kickoffStamp(match) !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => kickoffStamp(a) - kickoffStamp(b))
    .slice(-8);
}

function defaultMatchForCurrentFilter() {
  const matches = sortedMatches();
  const now = Date.now();
  return matches.find((match) => matchScore(match)?.live)
    || matches.find((match) => kickoffStamp(match) >= now)
    || matches.at(-1)
    || state.matches[0]
    || null;
}

let squadsLoadPromise = null;
function loadSquadsData() {
  if (state.squads) return Promise.resolve(state.squads);
  if (!squadsLoadPromise) {
    squadsLoadPromise = fetch(`./data/squads.json?v=${SQUADS_DATA_VERSION}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        state.squads = (d && d.teams ? d.teams : d) || {};
        return state.squads;
      })
      .catch((error) => {
        squadsLoadPromise = null;
        throw error;
      });
  }
  return squadsLoadPromise;
}

function teamMarketData(teamName) {
  return state.squads && state.squads[teamName] ? state.squads[teamName] : null;
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
  if (side) m[matchId] = side;
  else delete m[matchId];
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

function voteTotal(tally) {
  return VOTE_SIDES.reduce((sum, side) => sum + Number(tally?.[side] || 0), 0);
}

function votePercent(part, total) {
  if (!total) return null;
  return `${Math.round((part / total) * 100)}%`;
}

function voteSideLabel(match, side) {
  if (side === "home") return tTeam(match.home);
  if (side === "away") return tTeam(match.away);
  return t("平局");
}

function isVoteLocked(match) {
  const score = matchScore(match);
  if (score?.completed || score?.live) return true;
  return kickoffStamp(match) <= Date.now();
}

function voteBeatText(tally, result, label) {
  const total = voteTotal(tally);
  if (!total) return null;
  const wrong = total - Number(tally?.[result] || 0);
  return `${votePercent(wrong, total)} ${label}`;
}

function voteRightText(tally, result, label) {
  const total = voteTotal(tally);
  if (!total) return null;
  const right = Number(tally?.[result] || 0);
  return `${votePercent(right, total)} ${label}`;
}

function renderVoteFeedback(match, crowd, ai, mine) {
  const result = matchResult(match);
  if (!result) {
    if (isVoteLocked(match)) {
      return `<div class="vote-feedback is-pending"><span>${t("投票已截止，等赛果揭晓。")}</span></div>`;
    }
    return "";
  }

  const winner = voteSideLabel(match, result.result);
  const score = `${result.homeScore}-${result.awayScore}`;
  const crowdBeat = voteBeatText(crowd, result.result, t("人类"));
  const aiBeat = voteBeatText(ai, result.result, t("AI注单"));
  const crowdRight = voteRightText(crowd, result.result, t("人类"));
  const aiRight = voteRightText(ai, result.result, t("AI注单"));
  const beatText = [crowdBeat, aiBeat].filter(Boolean).join(" / ");
  const rightText = [crowdRight, aiRight].filter(Boolean).join(" / ");
  const resultText = `${t("赛果")} ${score} · ${t("正确选项")} ${winner}`;

  if (!mine) {
    return `<div class="vote-feedback is-watch">
      <span>${t("赛后回看")}</span>
      <strong>${t("你赛前没参与这场")}</strong>
      <em>${resultText}${rightText ? ` · ${t("选中方占")} ${rightText}` : ""}</em>
    </div>`;
  }

  const hit = mine === result.result;
  const headline = hit ? t("你选中了") : t("这次没选中");
  const detail = hit
    ? `${resultText}${beatText ? ` · ${t("超越")} ${beatText}` : ""}`
    : `${resultText}${rightText ? ` · ${t("选中方占")} ${rightText}` : ""}`;
  return `<div class="vote-feedback${hit ? " is-hit" : " is-miss"}">
    ${hit ? '<i class="vote-hit-mark" aria-hidden="true">✓</i><i class="vote-hit-sparks" aria-hidden="true"><b></b><b></b><b></b></i>' : ""}
    <span>${t("赛后回看")}</span>
    <strong>${headline}</strong>
    <em>${detail}</em>
  </div>`;
}

function renderVoteBar(match) {
  const v = state.votes[match.id] || {};
  const crowd = v.crowd || emptyTally();
  const ai = v.ai || emptyTally();
  const mine = myVotes()[match.id];
  const result = matchResult(match)?.result;
  const locked = isVoteLocked(match);
  const btn = (side, label) =>
    `<button class="vote-btn${mine === side ? " is-mine" : ""}${result === side ? " is-result" : ""}" data-vmatch="${match.id}" data-vote="${side}" type="button"${locked ? " disabled" : ""}>${label}</button>`;
  return `<div class="vote-bar${locked ? " is-locked" : ""}">
      <div class="vote-q">${t("你押谁赢？")}</div>
      <div class="vote-buttons">
        ${btn("home", tTeam(match.home))}
        ${btn("draw", t("平局"))}
        ${btn("away", tTeam(match.away))}
      </div>
      <div class="vote-results">
        ${voteRow(t("人类"), crowd, t("票"))}
        ${voteRow("AI", ai, t("注"))}
      </div>
      ${renderVoteFeedback(match, crowd, ai, mine)}
    </div>`;
}

async function castVote(matchId, side) {
  if (!VOTE_SIDES.includes(side)) return;
  const previous = myVotes()[matchId] || null;
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
    } else {
      setMyVote(matchId, previous);
      renderMatchCards();
    }
  } catch {
    setMyVote(matchId, previous);
    renderMatchCards();
  }
}

function cardHtml(match) {
  const selected = match.id === state.selectedId ? " is-selected" : "";
  const xgText = hasXg(match.model)
    ? `${match.model.xgHome.toFixed(2)} : ${match.model.xgAway.toFixed(2)}`
    : t("待接入");
  return `
    <div class="match-card-wrap">
    <button class="match-card spotlight${selected}" data-match-id="${match.id}" type="button">
      <span class="match-meta">
        <span>${tRound(match.round)}</span>
        <span>${match.kickoff}</span>
      </span>
      <span class="teams">
        <span>${tTeam(match.home)}</span>
        ${resultLine(match) || `<span class="versus">${t("对阵")}</span>`}
        <span>${tTeam(match.away)}</span>
      </span>
      <span class="signal">${signalText(match)}</span>
      <span class="metric-stack">
        <span class="metric-row">
          <span>${t("欧赔")}</span>
          ${oddsLine(match)}
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
  // 首次渲染优先展开当前选中比赛所在日期
  if (!state.dayInitDone) {
    const selected = all.find((match) => match.id === state.selectedId);
    const selectedDate = selected?.kickoff.slice(0, 10);
    if (selectedDate && byDate.has(selectedDate)) state.openDays.add(selectedDate);
    else if (order[0]) state.openDays.add(order[0]);
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
    .map(([label, lotteryProb, offshoreProb, modelProb], i) => {
      const h = i === 0 ? [t("竞彩"), t("海外"), t("模型")] : ["", "", ""];
      return `
        <div class="model-row">
          <span>${label}</span>
          ${labeledOdds([[h[0], percent(lotteryProb)], [h[1], percent(offshoreProb)], [h[2], percent(modelProb)]])}
        </div>
      `;
    })
    .join("");
}

function marketStatus(match) {
  const score = matchScore(match);
  if (score?.completed) return t("已完赛");
  if (score?.live) return t("进行中");
  if (marketReady(match)) return t("已接入");
  if (hasOneXTwo(match.lottery?.oneXTwo) || hasHandicapOdds(match.lottery?.handicap) || hasOneXTwo(match.offshore?.oneXTwo)) return t("部分接入");
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
  const lo = match.lottery?.oneXTwo;
  const hc = match.lottery?.handicap;
  const hasMain = hasOneXTwo(lo);
  const hasHandicap = hasHandicapOdds(hc);

  if (!hasMain && !hasHandicap) {
    return `
      <section class="detail-block">
        <h3>${t("竞彩固定奖金")}</h3>
        <p class="empty-state">${t("待官方开售后导入。当前只展示真实赛程，不展示任何购彩建议。")}</p>
      </section>
    `;
  }

  const lottery = hasMain ? impliedProbabilities(lo) : null;
  return `
    <section class="detail-block">
      <h3>${t("竞彩固定奖金")}</h3>
      ${hasMain ? `
        <div class="odds-line"><span>${t("胜平负")}</span>${labeledOdds([[t("胜"), lo.home], [t("平"), lo.draw], [t("负"), lo.away]])}</div>
        <div class="odds-line"><span>${t("去水概率")}</span>${labeledOdds([[t("胜"), percent(lottery.fair.home)], [t("平"), percent(lottery.fair.draw)], [t("负"), percent(lottery.fair.away)]])}</div>
        <div class="odds-line"><span>${t("返还率")}</span><strong>${percent(lottery.returnRate)}</strong></div>
      ` : `<div class="odds-line"><span>${t("胜平负")}</span><strong>${t("待接入")}</strong></div>`}
      ${hasHandicap ? `<div class="odds-line"><span>${t("让球")} ${hc.line}</span>${labeledOdds([[t("胜"), hc.home], [t("平"), hc.draw], [t("负"), hc.away]])}</div>` : ""}
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
  const o = match.offshore.oneXTwo;
  const v = (m, k) => m?.[k] ?? t("待接入");
  return `
    <section class="detail-block">
      <h3>${t("海外市场均值")}</h3>
      <div class="odds-line"><span>${t("欧赔")}</span>${labeledOdds([[t("胜"), o.home], [t("平"), o.draw], [t("负"), o.away]])}</div>
      <div class="odds-line"><span>${t("去水概率")}</span>${labeledOdds([[t("胜"), percent(offshore.fair.home)], [t("平"), percent(offshore.fair.draw)], [t("负"), percent(offshore.fair.away)]])}</div>
      <div class="odds-line"><span>${t("亚盘")} ${marketLineLabel(match.offshore.asian)}</span>${labeledOdds([[t("主"), v(match.offshore.asian, "home")], [t("客"), v(match.offshore.asian, "away")]])}</div>
      <div class="odds-line"><span>${t("大小")} ${marketLineLabel(match.offshore.totals)}</span>${labeledOdds([[t("大"), v(match.offshore.totals, "over")], [t("小"), v(match.offshore.totals, "under")]])}</div>
    </section>
  `;
}

function formatMarketDelta(value, en = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (Math.abs(amount) < 1000000) return "€0M";
  const sign = amount > 0 ? "+" : "-";
  return `${sign}${formatMarketAmount(Math.abs(amount), en, "—")}`;
}

function marketValueEdgeText(match, homeValue, awayValue, en) {
  if (!homeValue || !awayValue) return en ? "Data pending" : "数据待接入";
  const diff = homeValue - awayValue;
  if (Math.abs(diff) < 1000000) return en ? "Nearly level" : "基本持平";
  const leader = diff > 0 ? match.home : match.away;
  const ratio = Math.max(homeValue, awayValue) / Math.max(Math.min(homeValue, awayValue), 1);
  const digits = ratio >= 10 ? 0 : 1;
  return en ? `${tTeam(leader)} about ${ratio.toFixed(digits)}x` : `${tTeam(leader)}约 ${ratio.toFixed(digits)}x`;
}

function renderTeamMarketBlock(match) {
  const en = _i18n.getLang && _i18n.getLang() === "en";
  const homeTeam = teamMarketData(match.home);
  const awayTeam = teamMarketData(match.away);
  const homeValue = Number(homeTeam?.market_value_eur) || 0;
  const awayValue = Number(awayTeam?.market_value_eur) || 0;
  const maxValue = Math.max(homeValue, awayValue, 1);
  const side = (teamName, team, value, cls) => {
    const pct = Math.max(3, Math.round((value / maxValue) * 100));
    const coverage = teamMarketCoverage(team, en) || (en ? "coverage pending" : "覆盖待接入");
    return `
      <div class="team-value-side ${cls}">
        <span class="team-value-name">${tTeam(teamName)}</span>
        <strong>${formatTeamMarketValue(team, en)}</strong>
        <small>${coverage}</small>
        <span class="team-value-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      </div>
    `;
  };
  return `
    <section class="detail-block team-value-block">
      <h3>${t("全队身价参考")}</h3>
      <div class="team-value-compare">
        ${side(match.home, homeTeam, homeValue, "home")}
        <span class="team-value-vs">${t("对阵")}</span>
        ${side(match.away, awayTeam, awayValue, "away")}
      </div>
      <div class="team-value-gap">
        <span>${t("身价差")}</span>
        <strong>${formatMarketDelta(homeValue - awayValue, en)} · ${marketValueEdgeText(match, homeValue, awayValue, en)}</strong>
      </div>
      <p class="team-value-note">${t("已匹配球员汇总，仅作强弱参考。")}</p>
    </section>
  `;
}

function renderDetail() {
  const match = state.matches.find((item) => item.id === state.selectedId) || state.matches[0];
  if (!match) return;
  const score = matchScore(match);

  selectors.detailTitle.textContent = `${tTeam(match.home)} ${t("对阵")} ${tTeam(match.away)}`;
  selectors.detailRisk.textContent = marketStatus(match);
  selectors.detailBody.innerHTML = `
    <div class="detail-grid">
      <section class="detail-block">
        <h3>${t("赛程信息")}</h3>
        <div class="odds-line"><span>${t("开球")}</span><strong>${match.kickoff} ${t("北京时间")}</strong></div>
        <div class="odds-line"><span>${t("阶段")}</span><strong>${tRound(match.round)}</strong></div>
        <div class="odds-line"><span>${t("场地")}</span><strong>${tVenue(match.venue)}</strong></div>
        ${score ? `<div class="odds-line result-line"><span>${score.completed ? t("赛果") : t("比分")}</span><strong>${resultDetailText(match)}</strong></div>` : ""}
        <div class="odds-line"><span>${t("数据状态")}</span><strong>${marketStatus(match)}</strong></div>
      </section>
      ${renderTeamMarketBlock(match)}
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

function fmtFresh(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    label: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    stale: (Date.now() - d.getTime()) / 3600000 > 26
  };
}
function renderDataFreshness() {
  const el = document.getElementById("data-freshness");
  if (!el) return;
  const odds = fmtFresh(state.updatedAt);
  const lott = fmtFresh(state.lotteryAt);
  const parts = [];
  if (odds) parts.push(`<span class="${odds.stale ? "fresh-stale" : ""}">${t("赔率更新")} ${odds.label}</span>`);
  if (lott) parts.push(`<span class="${lott.stale ? "fresh-stale" : ""}">${t("竞彩更新")} ${lott.label}</span>`);
  el.innerHTML = parts.join('<i class="fresh-dot">·</i>');
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
  state.updatedAt = payload.updatedAt || null;
  state.lotteryAt = (payload.lotterySource && payload.lotterySource.collectedAt) || null;
  state.selectedId = defaultMatchForCurrentFilter()?.id || null;
  render();
  renderDataFreshness();
  computeAdvanceProb();
  loadSquadsData().then(() => {
    renderDetail();
    window.__wcUpdateGroupMarketBadges?.();
  }).catch(() => {});
}

selectors.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.filter = chip.dataset.filter;
    state.openDays = new Set();
    state.dayInitDone = false;
    state.selectedId = defaultMatchForCurrentFilter()?.id || state.selectedId;
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

let currentBoard = "assets";
let agentBoardExpanded = false;
const AGENT_BOARD_LIMIT = 10;

// 三种榜口排序：资产 / 收益率 / 连胜（借鉴小炮英雄榜的奖金榜·盈利榜·连红榜）
function boardSort(rows, board) {
  const r = rows.slice();
  if (board === "hit")
    return r.sort((a, b) => (Number(b.hitRate) || 0) - (Number(a.hitRate) || 0) || (Number(b.settled) || 0) - (Number(a.settled) || 0) || (b.totalValue - a.totalValue));
  if (board === "streak")
    return r.sort((a, b) =>
      (Number(b.streak) || 0) - (Number(a.streak) || 0) ||
      (Number(b.bestStreak) || 0) - (Number(a.bestStreak) || 0) ||
      (b.totalValue - a.totalValue));
  return r.sort((a, b) => b.totalValue - a.totalValue);
}

// 每行右侧主数字 + 副标签随榜口变化
function boardMetric(row, board) {
  if (board === "hit") {
    const settled = Number(row.settled || 0);
    if (!settled) return { main: "—", sub: t("暂无战绩"), cls: "" };
    const hr = Number(row.hitRate || 0);
    return { main: (hr * 100).toFixed(0) + "%", sub: t("命中") + " " + (row.wins || 0) + "/" + settled, cls: hr >= 0.5 ? "pos" : "" };
  }
  if (board === "streak") {
    const s = Number(row.streak || 0);
    const settled = Number(row.settled || 0);
    const sub = settled > 0 ? t("命中") + " " + (row.wins || 0) + "/" + settled : t("暂无战绩");
    return { main: s > 0 ? s + t("连胜") : "—", sub, cls: s > 0 ? "pos" : "" };
  }
  return { main: formatAgentMoney(row.totalValue), sub: t("虚拟资产"), cls: "" };
}

function renderAgentLeaderboard(rows) {
  if (!agentArena.leaderboard) return;
  if (!rows.length) {
    agentArena.leaderboard.innerHTML = '<div class="agent-empty">' + escapeAgentHtml(t("等待第一位 Agent 入场。")) + "</div>";
    return;
  }
  const board = currentBoard;
  // 连胜榜在尚无人结算时给友好空状态，避免一排 0
  if ((board === "streak" || board === "hit") && rows.every((r) => !Number(r.settled))) {
    agentArena.leaderboard.innerHTML = '<div class="agent-empty">' + escapeAgentHtml(t("赛事未开打，暂无结算战绩。")) + "</div>";
    return;
  }
  const sorted = boardSort(rows, board);
  const visibleRows = agentBoardExpanded ? sorted : sorted.slice(0, AGENT_BOARD_LIMIT);
  const listHtml = visibleRows.map((row, index) => {
    const name = escapeAgentHtml(row.name || row.agentId || "Agent");
    const model = escapeAgentHtml(row.model || t("未标注模型"));
    const m = boardMetric(row, board);
    const champ = index === 0 ? " is-champion" : "";
    const nameCls = index === 0 ? ' class="wc-shiny"' : "";
    return '<div class="agent-leader-row spotlight' + champ + '">' +
      '<b class="agent-rank">' + (index + 1) + '</b>' +
      '<div><strong' + nameCls + '>' + name + '</strong><span>' + model + '</span></div>' +
      '<div class="agent-metric' + (m.cls ? " " + m.cls : "") + '"><strong>' + escapeAgentHtml(m.main) + '</strong><span>' + escapeAgentHtml(m.sub) + '</span></div>' +
      '</div>';
  }).join("");
  const toggleHtml = sorted.length > AGENT_BOARD_LIMIT
    ? '<button class="agent-board-toggle" type="button" data-agent-board-toggle>' +
      escapeAgentHtml(agentBoardExpanded ? t("收起榜单") : t("查看完整榜单")) +
      '</button>'
    : "";
  agentArena.leaderboard.innerHTML = listHtml + toggleHtml;
  agentArena.leaderboard.querySelector("[data-agent-board-toggle]")?.addEventListener("click", () => {
    agentBoardExpanded = !agentBoardExpanded;
    renderAgentLeaderboard(rows);
  });
}

function renderAgentArena(payload) {
  if (!agentArena.root) return;
  lastArenaPayload = payload;
  const leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
  countUpWhenVisible(agentArena.openMarkets, Number(payload.openMatches || 0));
  countUpWhenVisible(agentArena.capital, Number(payload.virtualCapital), { fmt: formatAgentMoney });
  countUpWhenVisible(agentArena.count, leaderboard.length);
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

// 排行榜维度切换（资产 / 收益率 / 连胜）
const boardTabs = agentArena.root ? Array.from(agentArena.root.querySelectorAll(".agent-tab")) : [];
boardTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const board = tab.dataset.board;
    if (!board || board === currentBoard) return;
    currentBoard = board;
    boardTabs.forEach((x) => x.classList.toggle("is-active", x === tab));
    const rows = lastArenaPayload && Array.isArray(lastArenaPayload.leaderboard) ? lastArenaPayload.leaderboard : [];
    renderAgentLeaderboard(rows);
  });
});

loadAgentArena().catch((error) => {
  if (agentArena.leaderboard) {
    agentArena.leaderboard.innerHTML = '<div class="agent-empty">' + escapeAgentHtml(error.message) + "</div>";
  }
});

// 语言切换 → 重渲染动态内容
window.addEventListener("wc:langchange", () => {
  if (state.matches.length) render();
  renderDataFreshness();
  if (lastArenaPayload) renderAgentArena(lastArenaPayload);
  else renderAgentLeaderboard([]);
});

/* ===================== 视觉增强（reactbits 风格，原生实现）===================== */
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 数字滚动：从 0 缓动到目标值（尊重 reduce 偏好）
function animateNumber(el, to, { dur = 1100, fmt = (n) => String(Math.round(n)) } = {}) {
  if (!el) return;
  const target = Number(to);
  if (prefersReduced || !Number.isFinite(target)) { el.textContent = fmt(target); return; }
  const begin = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const frame = (now) => {
    const p = Math.min(1, (now - begin) / dur);
    el.textContent = fmt(target * ease(p));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// 进入视口才开始滚：KPI 在第二屏，否则页面一加载就滚完，用户滚下去只看到终值
function countUpWhenVisible(el, to, opts) {
  if (!el) return;
  if (prefersReduced || !("IntersectionObserver" in window)) { animateNumber(el, to, opts); return; }
  el.textContent = opts && opts.fmt ? opts.fmt(0) : "0"; // 进视口前先归零，跳动更明显
  const io = new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      animateNumber(el, to, opts);
      obs.disconnect();
    }
  }, { threshold: 0.5 });
  io.observe(el);
}

// 光标聚光：单个委托监听，自动覆盖所有 .spotlight（含动态生成的卡片）
if (!prefersReduced) {
  document.addEventListener("pointermove", (event) => {
    const el = event.target.closest && event.target.closest(".spotlight");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  }, { passive: true });
}

// 给静态卡片挂上 spotlight
document.querySelectorAll(".agent-card, .glossary-grid article").forEach((el) => el.classList.add("spotlight"));

// 滚动入场：进入视口淡入上移（无 JS / reduce 时不隐藏，内容始终可见）
function setupReveal() {
  if (prefersReduced || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("js-reveal");
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-in"); obs.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".block .section-heading, .agent-arena-grid, .detail-layout, .glossary-grid article")
    .forEach((el) => { el.classList.add("reveal"); io.observe(el); });
}
setupReveal();

/* ===================== 48 强巡礼：小组卡片墙 ===================== */
const TEAM_ISO = {
  "阿根廷": "AR", "巴西": "BR", "法国": "FR", "西班牙": "ES", "英格兰": "GB-ENG",
  "葡萄牙": "PT", "荷兰": "NL", "德国": "DE", "比利时": "BE", "克罗地亚": "HR",
  "乌拉圭": "UY", "哥伦比亚": "CO", "墨西哥": "MX", "美国": "US", "加拿大": "CA",
  "日本": "JP", "韩国": "KR", "澳大利亚": "AU", "摩洛哥": "MA", "塞内加尔": "SN",
  "科特迪瓦": "CI", "加纳": "GH", "埃及": "EG", "阿尔及利亚": "DZ", "突尼斯": "TN",
  "南非": "ZA", "佛得角": "CV", "刚果民主共和国": "CD", "瑞士": "CH", "奥地利": "AT",
  "挪威": "NO", "瑞典": "SE", "苏格兰": "GB-SCT", "捷克": "CZ", "波黑": "BA",
  "土耳其": "TR", "伊朗": "IR", "伊拉克": "IQ", "沙特阿拉伯": "SA", "卡塔尔": "QA",
  "约旦": "JO", "乌兹别克斯坦": "UZ", "厄瓜多尔": "EC", "巴拉圭": "PY", "巴拿马": "PA",
  "海地": "HT", "库拉索": "CW", "新西兰": "NZ"
};
const WC_GROUPS = [
  ["A", ["墨西哥", "南非", "韩国", "捷克"]],
  ["B", ["加拿大", "波黑", "卡塔尔", "瑞士"]],
  ["C", ["巴西", "摩洛哥", "海地", "苏格兰"]],
  ["D", ["美国", "巴拉圭", "澳大利亚", "土耳其"]],
  ["E", ["德国", "库拉索", "科特迪瓦", "厄瓜多尔"]],
  ["F", ["荷兰", "日本", "瑞典", "突尼斯"]],
  ["G", ["比利时", "埃及", "伊朗", "新西兰"]],
  ["H", ["西班牙", "佛得角", "沙特阿拉伯", "乌拉圭"]],
  ["I", ["法国", "塞内加尔", "伊拉克", "挪威"]],
  ["J", ["阿根廷", "阿尔及利亚", "奥地利", "约旦"]],
  ["K", ["葡萄牙", "刚果民主共和国", "乌兹别克斯坦", "哥伦比亚"]],
  ["L", ["英格兰", "克罗地亚", "加纳", "巴拿马"]]
];
const groupStandingsState = new Map();

function isoToFlag(iso) {
  if (!iso) return "";
  return `<img class="gt-flag-img" src="./assets/flags/4x3/${iso.toLowerCase()}.svg" alt="" loading="lazy" width="22" height="16">`;
}
function groupSeedTeams(g) {
  const entry = WC_GROUPS.find((item) => item[0] === g);
  return entry ? entry[1] : [];
}
function groupSeedIndex(g, team) {
  const teams = groupSeedTeams(g);
  const index = teams.indexOf(team);
  return index === -1 ? 99 : index;
}
function compareStandings(a, b) {
  return (b.pts - a.pts) ||
    (b.gd - a.gd) ||
    (b.gf - a.gf) ||
    (a.seed - b.seed);
}
function standingRowsForGroup(g) {
  return groupStandingsState.get(g) || groupSeedTeams(g).map((team, seed) => ({
    team, seed, played: 0, pts: 0, gf: 0, ga: 0, gd: 0
  }));
}
function groupTeamRowHtml(zh, standing = {}, probText = "—") {
  return `<span class="group-team"><span class="gt-flag">${isoToFlag(TEAM_ISO[zh])}</span>` +
    `<span class="gt-name-wrap"><span class="gt-name" data-team="${zh}">${tTeam(zh)}</span><span class="gt-market">—</span></span>` +
    `<span class="gt-pts" data-team="${zh}">${standing.pts || 0}</span>` +
    `<span class="gt-prob" data-team="${zh}">${probText}</span></span>`;
}
function renderGroupCardRows(g, rows, prob = {}) {
  const card = document.querySelector(`.group-card[data-group="group-${g}"]`);
  if (!card) return;
  const currentProb = prob;
  card.querySelectorAll(".group-team").forEach((row) => row.remove());
  card.insertAdjacentHTML("beforeend", rows.map((standing) => {
    const p = currentProb[standing.team];
    return groupTeamRowHtml(standing.team, standing, p == null ? "—" : `${Math.round(p * 100)}%`);
  }).join(""));
  window.__wcUpdateGroupMarketBadges?.();
}
function formatMarketAmount(value, en = false, fallback = null) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return fallback ?? (en ? "TM pending" : "身价待接入");
  if (amount >= 1000000000) {
    return `€${(amount / 1000000000).toFixed(2).replace(/\.?0+$/, "")}B`;
  }
  return `€${Math.round(amount / 1000000)}M`;
}
function formatTeamMarketValue(team, en = false) {
  return formatMarketAmount(team?.market_value_eur, en);
}
function teamMarketCoverage(team, en = false) {
  const covered = Number(team?.market_value_covered || 0);
  const total = Number(team?.market_value_players || team?.players?.length || 0);
  if (!total) return "";
  return en ? `${covered}/${total} valued` : `${covered}/${total} 已估`;
}
function setupGroupParade() {
  const grid = document.getElementById("group-grid");
  if (!grid) return;
  grid.innerHTML = WC_GROUPS.map(([g, teams]) => {
    const rows = teams.map((zh, seed) => groupTeamRowHtml(zh, { pts: 0, seed })).join("");
    return `<button class="group-card spotlight" data-group="group-${g}" type="button">` +
      `<span class="gc-head"><span class="group-tag">${g}</span><span class="group-sub">GROUP</span></span>` +
      `<span class="gc-colhead"><span></span><span></span>` +
      `<span class="col-h" data-i18n="muster.col.pts">积分</span>` +
      `<span class="col-h" data-i18n="muster.col.adv">出线率</span></span>${rows}</button>`;
  }).join("");
  if (window.wcI18n && window.wcI18n.applyStatic) window.wcI18n.applyStatic();

  // 点小组卡 → 放大成中央大卡（出线形势详情）
  grid.querySelectorAll(".group-card").forEach((card) => {
    const g = card.dataset.group.replace("group-", "");
    card.addEventListener("click", () => openGroupModal(g));
  });

  // 语言切换时同步队名
  window.addEventListener("wc:langchange", () => {
    grid.querySelectorAll(".gt-name[data-team]").forEach((el) => {
      el.textContent = tTeam(el.dataset.team);
    });
    window.__wcUpdateGroupMarketBadges?.();
  });
}
setupGroupParade();

// ===== 小组放大卡：点 group-card → View Transitions morph 成屏幕中央大卡 =====
const GM = (function () {
  const modal = document.getElementById("group-modal");
  if (!modal) return null;
  const cardEl = modal.querySelector(".gm-card");
  const body = modal.querySelector(".gm-body");
  const supportsVT = typeof document.startViewTransition === "function";
  let lastFocus = null;
  let currentG = null;
  let squadsTried = false;
  function updateGroupMarketBadges() {
    if (!state.squads) return;
    document.querySelectorAll(".group-team .gt-name[data-team]").forEach((el) => {
      const team = state.squads[el.dataset.team];
      const badge = el.closest(".group-team")?.querySelector(".gt-market");
      if (badge) badge.textContent = formatTeamMarketValue(team, isEn());
    });
  }
  window.__wcUpdateGroupMarketBadges = updateGroupMarketBadges;
  function ensureSquads() {
    if (state.squads) { updateGroupMarketBadges(); return; }
    if (squadsTried) return;
    squadsTried = true;
    loadSquadsData().then(() => {
      updateGroupMarketBadges();
      if (currentG) build(currentG); // 名单到位后重渲染当前组，让有名单的球队变可点
    }).catch(() => {});
  }

  const isEn = () => document.documentElement.getAttribute("lang") === "en";
  function build(g) {
    currentG = g;
    ensureSquads();
    const card = document.querySelector(`.group-card[data-group="group-${g}"]`);
    const ptsLabel = isEn() ? "PTS" : "积分";
    const advLabel = isEn() ? "ADVANCE" : "出线率";
    const rows = standingRowsForGroup(g).map(({ team: zh }) => {
      const pe = card && card.querySelector(`.gt-prob[data-team="${zh}"]`);
      const te = card && card.querySelector(`.gt-pts[data-team="${zh}"]`);
      const probTxt = pe ? pe.textContent.trim() : "—";
      const ptsTxt = te ? te.textContent.trim() : "0";
      const w = Math.max(0, Math.min(100, parseInt(probTxt, 10) || 0));
      const team = state.squads && state.squads[zh];
      const hasSquad = !!(team && team.players && team.players.length);
      const valueTxt = formatTeamMarketValue(team, isEn());
      const coverageTxt = teamMarketCoverage(team, isEn());
      return (
        `<div class="gm-team${hasSquad ? " gm-clk" : ""}"${hasSquad ? ` data-team="${zh}"` : ""}>` +
        `<span class="gm-flag">${isoToFlag(TEAM_ISO[zh])}</span>` +
        `<span class="gm-name"><span class="gm-name-main">${tTeam(zh)}${hasSquad ? '<i class="gm-go">›</i>' : ""}</span><small>${valueTxt}${coverageTxt ? ` · ${coverageTxt}` : ""}</small></span>` +
        `<span class="gm-stat gm-pts"><b>${ptsTxt}</b><i>${ptsLabel}</i></span>` +
        `<span class="gm-stat gm-prob"><b>${probTxt}</b><i>${advLabel}</i></span>` +
        `<span class="gm-bar" data-w="${w}"><i></i></span>` +
        `</div>`
      );
    }).join("");
    const title = isEn() ? "Race for the Round of 32" : "小组出线形势";
    const note = isEn()
      ? "Advance rate = simulated chance of reaching the Round of 32 (top 2 + best thirds). Research only."
      : "出线率 = 模型推演晋级 32 强（每组前 2 + 8 个最佳第 3）概率，仅供研究。";
    const cta = isEn() ? `View Group ${g} odds →` : `查看 ${g} 组盘口 →`;
    body.innerHTML =
      `<div class="gm-head"><span class="gm-letter">${g}</span>` +
      `<span class="gm-meta"><span class="gm-grouplabel">GROUP ${g}</span>` +
      `<h3 id="gm-title">${title}</h3></span></div>` +
      `<div class="gm-teams">${rows}</div>` +
      `<p class="gm-note">${note}</p>` +
      `<button class="gm-cta" type="button" data-gm-go="${g}">${cta}</button>`;
  }

  function animateBars() {
    body.querySelectorAll(".gm-bar").forEach((bar) => {
      const w = (bar.dataset.w || 0) + "%";
      const fill = bar.querySelector("i");
      if (!fill) return;
      if (prefersReduced) { fill.style.width = w; return; }
      fill.style.width = "0%";
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = w; }));
    });
  }

  const POS_ORDER = ["GK", "DF", "MF", "FW"];
  function formatMarketValue(player, en) {
    const value = Number(player.market_value_eur);
    if (!Number.isFinite(value) || value <= 0) return en ? "TM pending" : "德转待接入";
    if (value >= 1000000) {
      const millions = value / 1000000;
      const digits = millions >= 100 ? 0 : millions >= 10 ? 1 : 2;
      return `德转 €${millions.toFixed(digits).replace(/\.0+$/, "")}M`;
    }
    return `德转 €${Math.round(value / 1000)}K`;
  }

  function renderSquad(zh) {
    const t = state.squads && state.squads[zh];
    if (!t || !t.players) return;
    const en = isEn();
    const posName = en
      ? { GK: "Goalkeepers", DF: "Defenders", MF: "Midfielders", FW: "Forwards" }
      : { GK: "门将", DF: "后卫", MF: "中场", FW: "前锋" };
    const byPos = {};
    t.players.forEach((p) => { (byPos[p.pos] || (byPos[p.pos] = [])).push(p); });
    const order = POS_ORDER.filter((k) => byPos[k]).concat(Object.keys(byPos).filter((k) => !POS_ORDER.includes(k)));
    const sections = order.map((k) => {
      const rows = byPos[k].slice().sort((a, b) => (a.no || 99) - (b.no || 99)).map((p) => {
        const name = en ? (p.en || p.zh || "") : (p.zh || p.en || "");
        const sub = en ? (p.zh || "") : (p.en || "");
        const club = en ? (p.club_en || p.club_zh || "") : (p.club_zh || p.club_en || "");
        const bits = [];
        if (club) bits.push(club);
        if (p.age) bits.push(en ? `${p.age}y` : `${p.age}岁`);
        if (p.caps != null) bits.push(en ? `${p.caps} caps` : `${p.caps}场`);
        bits.push(`<b class="pl-value">${formatMarketValue(p, en)}</b>`);
        return (
          `<div class="pl-row"><span class="pl-no">${p.no || ""}</span>` +
          `<span class="pl-main"><span class="pl-name">${name}${sub ? `<small>${sub}</small>` : ""}</span>` +
          `<span class="pl-meta">${bits.join(" · ")}</span></span></div>`
        );
      }).join("");
      return `<div class="pl-group"><h4>${posName[k] || k}<span>${byPos[k].length}</span></h4>${rows}</div>`;
    }).join("");
    const flagIso = t.iso ? t.iso.toUpperCase() : TEAM_ISO[zh];
    const valueLabel = en ? "Squad value" : "全队身价";
    const valueTxt = formatTeamMarketValue(t, en);
    const coverageTxt = teamMarketCoverage(t, en);
    body.innerHTML =
      `<div class="gm-head sq-head"><button class="sq-back" type="button" data-sq-back aria-label="${en ? "Back" : "返回"}">‹</button>` +
      `<span class="gm-flag sq-flag">${isoToFlag(flagIso)}</span>` +
      `<span class="gm-meta"><span class="gm-grouplabel">SQUAD · ${t.players.length}</span>` +
      `<h3>${tTeam(zh)}${t.en ? `<em>${t.en}</em>` : ""}</h3></span></div>` +
      `<div class="sq-value"><span>${valueLabel}</span><strong>${valueTxt}</strong><i>${coverageTxt}</i></div>` +
      `<div class="sq-list">${sections}</div>` +
      `<p class="gm-note">${en ? "Squad data from Chinese sports media + Wikipedia; market values from the public Transfermarkt dataset, matched by player name. Research only." : "名单资料来自国内体育媒体 + 维基百科；身价来自公开 Transfermarkt 数据集，按球员英文名匹配。仅供研究。"}</p>`;
  }

  function open(g) {
    build(g);
    lastFocus = document.activeElement;
    const card = document.querySelector(`.group-card[data-group="group-${g}"]`);
    const reveal = () => {
      modal.hidden = false;
      document.body.classList.add("gm-open");
      cardEl.focus();
    };
    if (!supportsVT || prefersReduced) {
      modal.removeAttribute("data-vt");
      reveal(); animateBars(); return;
    }
    modal.setAttribute("data-vt", "");
    if (card) card.style.viewTransitionName = "group-active";
    const vt = document.startViewTransition(() => {
      if (card) card.style.viewTransitionName = "";
      cardEl.style.viewTransitionName = "group-active";
      reveal();
    });
    vt.ready.then(animateBars, animateBars);
    vt.finished.finally(() => { cardEl.style.viewTransitionName = ""; });
  }

  function close() {
    if (modal.hidden) return;
    const goEl = body.querySelector("[data-gm-go]");
    const g = goEl && goEl.dataset.gmGo;
    const card = g && document.querySelector(`.group-card[data-group="group-${g}"]`);
    const hide = () => {
      modal.hidden = true;
      document.body.classList.remove("gm-open");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };
    if (!supportsVT || prefersReduced) { hide(); return; }
    cardEl.style.viewTransitionName = "group-active";
    const vt = document.startViewTransition(() => {
      cardEl.style.viewTransitionName = "";
      hide();
      if (card) card.style.viewTransitionName = "group-active";
    });
    vt.finished.finally(() => { if (card) card.style.viewTransitionName = ""; });
  }

  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-gm-close]")) { close(); return; }
    if (e.target.closest("[data-sq-back]")) { build(currentG); animateBars(); cardEl.scrollTop = 0; return; }
    const teamRow = e.target.closest(".gm-team.gm-clk[data-team]");
    if (teamRow) { renderSquad(teamRow.dataset.team); cardEl.scrollTop = 0; return; }
    const go = e.target.closest("[data-gm-go]");
    if (go) {
      const g = go.dataset.gmGo;
      modal.hidden = true;
      document.body.classList.remove("gm-open");
      const chip = document.querySelector(`.chip[data-filter="group-${g}"]`);
      if (chip) chip.click();
      const radar = document.querySelector("#radar");
      if (radar) radar.scrollIntoView({ block: "start" });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });

  ensureSquads();
  return { open, close, updateGroupMarketBadges };
})();
function openGroupModal(g) { if (GM) GM.open(g); }

// 晋级 32 强模拟（2026 赛制：每组前 2 + 8 个最佳第 3）。一次全局模拟所有组。
// 注：模型只有胜平负概率、无净胜球，第 3 名跨组比较只按积分、同分随机（简化）。
function simulateAdvance(byGroup, iters = 8000) {
  const keys = Object.keys(byGroup);
  const teamsOf = {};
  for (const g of keys) {
    const ts = [];
    for (const m of byGroup[g]) {
      if (!ts.includes(m.homeTeam)) ts.push(m.homeTeam);
      if (!ts.includes(m.awayTeam)) ts.push(m.awayTeam);
    }
    teamsOf[g] = ts;
  }
  const adv = {};
  for (const g of keys) for (const t of teamsOf[g]) adv[t] = 0;
  for (let it = 0; it < iters; it++) {
    const thirds = [];
    for (const g of keys) {
      const teams = teamsOf[g];
      const pts = {};
      teams.forEach((t) => (pts[t] = 0));
      for (const m of byGroup[g]) {
        if (m.result === "home") pts[m.homeTeam] += 3;
        else if (m.result === "away") pts[m.awayTeam] += 3;
        else if (m.result === "draw") { pts[m.homeTeam] += 1; pts[m.awayTeam] += 1; }
        else {
          const r = Math.random();
          if (r < m.home) pts[m.homeTeam] += 3;
          else if (r < m.home + m.draw) { pts[m.homeTeam] += 1; pts[m.awayTeam] += 1; }
          else pts[m.awayTeam] += 3;
        }
      }
      const ranked = teams.slice().sort((a, b) => (pts[b] - pts[a]) || (Math.random() - 0.5));
      adv[ranked[0]]++;
      adv[ranked[1]]++;
      if (ranked[2] != null) thirds.push({ team: ranked[2], pts: pts[ranked[2]] });
    }
    thirds.sort((a, b) => (b.pts - a.pts) || (Math.random() - 0.5));
    for (let i = 0; i < 8 && i < thirds.length; i++) adv[thirds[i].team]++;
  }
  const out = {};
  for (const t in adv) out[t] = adv[t] / iters;
  return out;
}

// 小组实时排名：按已出结果的比赛算；积分、净胜球、进球数排序，最后用赛程原顺序兜底。
function computeStandings(ms, g) {
  const table = new Map();
  for (const team of groupSeedTeams(g)) {
    table.set(team, { team, seed: groupSeedIndex(g, team), played: 0, pts: 0, gf: 0, ga: 0, gd: 0 });
  }
  const rowFor = (team) => {
    if (!table.has(team)) table.set(team, { team, seed: groupSeedIndex(g, team), played: 0, pts: 0, gf: 0, ga: 0, gd: 0 });
    return table.get(team);
  };
  for (const mt of ms) {
    if (!mt.result) continue;
    const home = rowFor(mt.homeTeam);
    const away = rowFor(mt.awayTeam);
    const hs = Number(mt.homeScore);
    const as = Number(mt.awayScore);
    home.played++;
    away.played++;
    if (Number.isFinite(hs) && Number.isFinite(as)) {
      home.gf += hs;
      home.ga += as;
      away.gf += as;
      away.ga += hs;
    }
    if (mt.result === "home") home.pts += 3;
    else if (mt.result === "away") away.pts += 3;
    else { home.pts += 1; away.pts += 1; }
  }
  for (const row of table.values()) row.gd = row.gf - row.ga;
  return [...table.values()].sort(compareStandings);
}

function computeAdvanceProb() {
  if (!state.matches.length) return;
  const byGroup = {};
  for (const m of state.matches) {
    const mm = m.round.match(/^([A-L])组/);
    if (!mm) continue;
    const mo = m.model || {};
    if (!(Number.isFinite(mo.home) && Number.isFinite(mo.draw) && Number.isFinite(mo.away))) continue;
    (byGroup[mm[1]] ||= []).push({
      homeTeam: m.home,
      awayTeam: m.away,
      home: mo.home,
      draw: mo.draw,
      away: mo.away,
      result: m.result,
      homeScore: m.homeScore,
      awayScore: m.awayScore
    });
  }
  const prob = simulateAdvance(byGroup);
  for (const [g] of WC_GROUPS) {
    const ms = byGroup[g];
    if (!ms || ms.length < 6) continue;
    const rows = computeStandings(ms, g);
    groupStandingsState.set(g, rows);
    renderGroupCardRows(g, rows, prob);
  }
}

// 回到顶部
(() => {
  const btn = document.getElementById("back-to-top");
  if (!btn) return;
  const onScroll = () => btn.classList.toggle("is-visible", window.scrollY > 600);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
})();

/* ===================== 视觉增强 II：全站铺开 ===================== */

// 标题金光：错开节拍，依次掠过各 section 标题（muster 竖排标题结构特殊，跳过）
document.querySelectorAll(".section-heading h2").forEach((el, i) => {
  if (el.classList.contains("muster-title")) return;
  el.classList.add("wc-shiny-h");
  el.style.animationDelay = `${i * 1.2}s`;
});

// 赔率数字滚动：进入视口时从 0 滚到位（仅纯数字/百分比，亚盘文字盘口跳过）
const fxNumRe = /^[-+]?\d+(?:\.\d+)?%?$/;
let fxOddsIO = null;
function fxRollNumbers(root) {
  if (prefersReduced || !root || !("IntersectionObserver" in window)) return;
  if (!fxOddsIO) {
    fxOddsIO = new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        obs.unobserve(e.target);
        const raw = e.target.dataset.fxTarget || "";
        const isPct = raw.endsWith("%");
        const dec = (raw.replace("%", "").split(".")[1] || "").length;
        animateNumber(e.target, parseFloat(raw), {
          dur: 900,
          fmt: (n) => n.toFixed(dec) + (isPct ? "%" : "")
        });
      });
    }, { threshold: 0.6 });
  }
  root.querySelectorAll(".o-val").forEach((el) => {
    if (!el.closest(".match-card")) return;
    if (el.dataset.fxTarget) return;
    const text = el.textContent.trim();
    if (!fxNumRe.test(text)) return;
    el.dataset.fxTarget = text;
    fxOddsIO.observe(el);
  });
}

// 赔率涨跌闪：与上次访问对比（localStorage），涨绿跌红泛两下
function fxFlashOddsDiff() {
  if (prefersReduced || !state.matches.length) return;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem("wc.odds.seen") || "{}"); } catch { /* 损坏即重建 */ }
  const next = {};
  state.matches.forEach((m) => {
    const o = m.offshore?.oneXTwo;
    if (hasOneXTwo(o)) next[m.id] = [o.home, o.draw, o.away];
  });
  document.querySelectorAll(".match-card[data-match-id]").forEach((card) => {
    const prev = seen[card.dataset.matchId];
    const cur = next[card.dataset.matchId];
    if (!prev || !cur) return;
    const cells = card.querySelectorAll(".odds-1x2 .o-cell");
    cur.forEach((v, i) => {
      if (!Number.isFinite(prev[i]) || !cells[i] || v === prev[i]) return;
      cells[i].classList.add(v > prev[i] ? "fx-up" : "fx-down");
    });
  });
  try { localStorage.setItem("wc.odds.seen", JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
}

// 动态渲染区（卡片列表 / 单场详情）每次重建后自动接管新数字
(() => {
  if (!("MutationObserver" in window)) return;
  let queued = false;
  let flashed = false;
  const onChange = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      fxRollNumbers(document.querySelector("main") || document.body);
      if (!flashed && state.matches.length && selectors.matchList?.querySelector(".match-card")) {
        flashed = true;
        fxFlashOddsDiff();
      }
    });
  };
  const mo = new MutationObserver((muts) => {
    // 数字滚动本身每帧都在改 .o-val 文本，过滤掉避免自激
    if (muts.every((m) => m.target.closest && m.target.closest(".o-val"))) return;
    onChange();
  });
  mo.observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  onChange();
})();

/* ===================== 视觉增强 III：流体金雾 / 乱码解密 / 3D 卡片 / 像素火花 ===================== */

// Hero 流体金雾：域扭曲 fbm 噪声 shader，暗金雾在像素画布下层流动
(() => {
  if (prefersReduced) return;
  const hero = document.querySelector(".hero");
  if (!hero) return;
  const cv = document.createElement("canvas");
  cv.className = "hero-shader";
  cv.setAttribute("aria-hidden", "true");
  const gl = cv.getContext("webgl", { alpha: true, antialias: false });
  if (!gl) return; // 无 WebGL 保持原 hero-glow 背景
  hero.prepend(cv);

  const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FRAG = `
precision mediump float;
uniform float u_t;uniform vec2 u_r;
float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/u_r;
  vec2 p=uv*vec2(u_r.x/u_r.y,1.)*2.4;
  float t=u_t*.05;
  vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+2.4*q+vec2(1.7,9.2)+t*1.5),fbm(p+2.4*q+vec2(8.3,2.8)-t*1.2));
  float f=fbm(p+2.4*r);
  float glow=smoothstep(.46,1.,f);
  vec3 gold=vec3(.94,.78,.35);
  vec3 ember=vec3(.5,.32,.1);
  vec3 col=mix(ember,gold,glow);
  float a=glow*glow*.34;
  a*=smoothstep(0.,.22,uv.y)*smoothstep(1.04,.5,uv.y); // 上下渐隐，别压导航和分界线
  gl_FragColor=vec4(col*a,a);
}`;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { cv.remove(); return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(prog, "u_t");
  const uR = gl.getUniformLocation(prog, "u_r");
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const SCALE = 0.35; // 降采样渲染，CSS 拉伸，省 GPU
  const fit = () => {
    cv.width = Math.max(2, (hero.clientWidth * SCALE) | 0);
    cv.height = Math.max(2, (hero.clientHeight * SCALE) | 0);
    gl.viewport(0, 0, cv.width, cv.height);
  };
  fit();
  window.addEventListener("resize", fit, { passive: true });

  let heroVisible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { heroVisible = es.some((e) => e.isIntersecting); }).observe(hero);
  }
  const frame = (now) => {
    if (heroVisible && !document.hidden) {
      gl.uniform1f(uT, now / 1000);
      gl.uniform2f(uR, cv.width, cv.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();

// 标题乱码解密：进入视口时谍战终端式逐字破译（全角/半角分集，避免宽度抖动）
(() => {
  if (prefersReduced || !("IntersectionObserver" in window)) return;
  const WIDE = "█▓▒░◆◈▣◉";
  const SLIM = "<>/\\=+*#01";
  const isWide = (c) => c.charCodeAt(0) > 0x2e7f;
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      obs.unobserve(e.target);
      const el = e.target;
      const orig = el.dataset.fxText;
      const total = Math.max(16, orig.length * 4);
      let frame = 0;
      const tick = () => {
        frame += 1;
        const reveal = Math.floor((frame / total) * orig.length);
        if (reveal >= orig.length) { el.textContent = orig; return; }
        el.textContent = orig.slice(0, reveal) + [...orig.slice(reveal)]
          .map((c) => {
            if (c === " ") return " ";
            const pool = isWide(c) ? WIDE : SLIM;
            return pool[(Math.random() * pool.length) | 0];
          })
          .join("");
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.7 });
  document.querySelectorAll(".section-heading h2:not(.muster-title), .hero-tag .eyebrow").forEach((el) => {
    const text = el.textContent.trim();
    if (!text || el.children.length) return; // 只处理纯文本节点
    el.dataset.fxText = text;
    io.observe(el);
  });
})();

// 比赛卡片 3D 倾斜：hover 跟手立体转动，离开回弹
(() => {
  if (prefersReduced || window.matchMedia("(hover: none)").matches) return;
  const MAX = 7; // 最大倾角（度）
  document.addEventListener("pointermove", (event) => {
    const card = event.target.closest && event.target.closest(".match-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width - 0.5;
    const y = (event.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateX(${(-y * MAX).toFixed(2)}deg) rotateY(${(x * MAX).toFixed(2)}deg) translateZ(6px)`;
  }, { passive: true });
  document.addEventListener("pointerout", (event) => {
    const card = event.target.closest && event.target.closest(".match-card");
    if (!card || (event.relatedTarget && card.contains(event.relatedTarget))) return;
    card.style.transform = "";
  }, { passive: true });
})();

// 点击迸金色像素火花：呼应像素信号场
(() => {
  if (prefersReduced) return;
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    for (let i = 0; i < 9; i++) {
      const s = document.createElement("i");
      s.className = "fx-spark";
      const ang = Math.random() * Math.PI * 2;
      const dist = 16 + Math.random() * 30;
      const size = 3 + ((Math.random() * 3) | 0);
      s.style.cssText = `left:${event.clientX}px;top:${event.clientY}px;width:${size}px;height:${size}px;--dx:${(Math.cos(ang) * dist).toFixed(1)}px;--dy:${(Math.sin(ang) * dist).toFixed(1)}px;`;
      document.body.appendChild(s);
      s.addEventListener("animationend", () => s.remove());
      window.setTimeout(() => s.remove(), 900); // animationend 兜底
    }
  }, { passive: true });
})();
