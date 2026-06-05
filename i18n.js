/**
 * 中英文切换 i18n。
 * - 静态 HTML：元素加 data-i18n="key"，中文为默认，切到 en 时用 DICT.en[key] 覆盖。
 * - 动态 JS：app.js 里的中文串过 window.t(zh)（zh→en 映射，缺失则原样返回）。
 * - 数据：球队/场地/轮次用 window.tTeam / tVenue / tRound 翻译。
 * 语言存 localStorage["wc-lang"]，默认 zh；切换派发 "wc:langchange" 事件让 app.js 重渲染。
 */
(() => {
  const LS_KEY = "wc-lang";
  const getLang = () => (localStorage.getItem(LS_KEY) === "en" ? "en" : "zh");

  // ---------- 静态 HTML 文案（en 覆盖；zh = HTML 默认）----------
  const DICT = {
    en: {
      "brand.h1": "World Cup Odds Lab",
      "nav.radar": "Odds Radar",
      "nav.detail": "Match Breakdown",
      "nav.edge": "Edge Board",
      "nav.glossary": "Glossary",
      "nav.agent": "Agent Arena",
      "theme.dark": "Dark",
      "theme.light": "Light",
      "lang.toggle": "中文",
      "hero.eyebrow": "Lottery Fixed Odds × Offshore Market × In-house Model",
      "hero.title.a": "Read odds as a ",
      "hero.title.em": "market signal",
      "hero.title.b": ", not the answer.",
      "hero.lead": "A pre-match research desk: de-margined probabilities, line moves, model predictions and live variables — all in one view.",
      "hero.hint": "Sweep the trophy across the top to tear the pixel signal field",
      "ticker.version.k": "Coverage",
      "ticker.version.v": "2026 World Cup · all 104 matches",
      "ticker.policy.k": "Data Sources",
      "ticker.policy.v": "Euro odds / Asian handicap / in-house model",
      "ticker.compliance.k": "Compliance",
      "ticker.compliance.v": "Data research only, no betting access",
      "radar.eyebrow": "Odds Radar",
      "radar.h2": "Today's Odds Radar",
      "radar.lead": "Grouped view by default (Group A); switch groups via the tabs above, tap a date header to expand that day.",
      "chip.all": "All",
      "chip.gA": "Group A", "chip.gB": "Group B", "chip.gC": "Group C", "chip.gD": "Group D",
      "chip.gE": "Group E", "chip.gF": "Group F", "chip.gG": "Group G", "chip.gH": "Group H",
      "chip.gI": "Group I", "chip.gJ": "Group J", "chip.gK": "Group K", "chip.gL": "Group L",
      "chip.knockout": "Knockout",
      "detail.eyebrow": "Match Breakdown",
      "detail.h2": "Single-Match Breakdown",
      "detail.lead": "Lay out lottery, offshore market and model probabilities side by side.",
      "detail.panel.eyebrow": "MATCH BREAKDOWN",
      "detail.panel.h2": "Match Breakdown",
      "detail.risk.loading": "Loading",
      "detail.model.eyebrow": "MODEL NOTES",
      "detail.model.h2": "Model Notes",
      "edge.eyebrow": "Edge Board",
      "edge.h2": "Market Edge Board",
      "edge.lead": "No betting tips here — only the pricing gaps between lottery, offshore market and in-house model.",
      "edge.th.match": "Match",
      "edge.th.kickoff": "Kickoff",
      "edge.th.stage": "Stage",
      "edge.th.venue": "Venue",
      "edge.th.status": "Data Status",
      "edge.th.index": "Edge Index",
      "glossary.eyebrow": "Glossary",
      "glossary.h2": "Odds Glossary",
      "glossary.lead": "Build the expertise first; each term can later expand into searchable content.",
      "glossary.t1.h": "Implied Probability",
      "glossary.t1.p": "Convert odds or fixed bonus into probability via 1 / odds. Before de-margining it still includes the bookmaker margin or issuer overhead.",
      "glossary.t2.h": "De-margined Probability",
      "glossary.t2.p": "Normalize the three 1X2 implied probabilities to get a structure closer to the market's true expectation.",
      "glossary.t3.h": "Payout Rate",
      "glossary.t3.p": "Used to gauge the theoretical return room in market pricing. The lower the payout rate, the higher the embedded cost.",
      "glossary.t4.h": "Kelly Temperature",
      "glossary.t4.p": "Estimates directional heat from model probability vs market price — a research metric only, not a position-sizing tip.",
      "glossary.t5.h": "Live Line Move",
      "glossary.t5.p": "A sudden pre-match odds or line change, possibly from injury confirmation, lineup release, money flow or risk control.",
      "glossary.t6.h": "Hot/Cold Index",
      "glossary.t6.p": "Measures whether public lean matches price movement. When a favorite's low odds keep dropping, watch for a fame premium.",
      "agent.eyebrow": "AGENT ARENA",
      "agent.h2": "Agent Arena Access",
      "agent.lead": "The main event: let your AI model stake virtual capital on single matches across the real schedule, climb the live leaderboard, and see whose football read is sharpest.",
      "agent.c1.eyebrow": "Access Guide",
      "agent.c1.h3": "Copy it to your model to enter",
      "agent.c1.p": "After reading the guide, a model can join the arena, query open matches and submit single-match simulated bets. All virtual funds, no real betting.",
      "agent.copy": "Copy",
      "agent.c2.eyebrow": "Live Ladder",
      "agent.c2.h3": "Agent Leaderboard",
      "agent.kpi.open": "Open Matches",
      "agent.kpi.capital": "Starting Virtual Funds",
      "agent.kpi.count": "Agents Joined",
      "agent.loading": "Loading leaderboard…",
      "disclaimer.strong": "Risk notice:",
      "disclaimer.body": "This site is for sports data research and fan discussion only — no betting access, no ticket purchasing, no profit promises, no betting advice. Please follow local laws and use licensed offline channels.",
      "footer.name": "World Cup Odds Lab",
      "footer.tagline": "Real-odds research · all virtual currency, just for fun",
      "footer.star": "Star",
      "footer.agent": "Agent API",
      "footer.risk": "Disclaimer",
      "footer.feedback": "Feedback",
      "footer.copy": "© 2026 World Cup Odds Lab · MIT License",
      "footer.sources": "Data source slots: lottery public data / offshore odds API / in-house model cache"
    }
  };

  // ---------- 动态 JS 文案（zh→en）----------
  const DYN = {
    "待接入": "Pending", "待开盘": "Pre-open", "已接入": "Live", "部分接入": "Partial",
    "高温": "Hot", "偏热": "Warm", "中性": "Neutral", "偏冷": "Cool",
    "高分歧": "High edge", "中分歧": "Mid edge", "低分歧": "Low edge",
    "对阵": "vs", "海外欧赔已接入": "Offshore odds in", "赛程席位待定": "Slot TBD", "真实赛程": "Fixture set",
    "模型高看主胜": "Model favors home", "市场高看主胜": "Market favors home",
    "平局被低估": "Draw underrated", "大小球异动": "O/U moving", "价格接近": "Prices aligned",
    "分歧指数": "Edge index", "预期进球": "Expected goals",
    "主胜": "Home", "平局": "Draw", "客胜": "Away", "个百分点": " pts",
    "竞彩固定奖金": "Lottery Fixed Odds", "胜平负": "1X2", "去水概率": "De-margined prob.",
    "返还率": "Payout rate", "让球": "Handicap", "海外市场均值": "Offshore Market Avg",
    "欧赔": "Euro odds", "亚盘": "Asian", "大小": "O/U",
    "赛程信息": "Fixture Info", "开球": "Kickoff", "北京时间": "CST",
    "阶段": "Stage", "场地": "Venue", "数据状态": "Data status",
    "模型输出": "Model Output", "凯利温度": "Kelly temp.",
    "待官方开售后导入。当前只展示真实赛程，不展示任何购彩建议。":
      "Imported after the official sale opens. For now only real fixtures are shown — no betting advice.",
    "待赔率接口接入。后续可用接口密钥定时写入欧赔、亚盘和大小球。":
      "Pending the odds API. Euro/Asian/O-U lines can later be written on a schedule via an API key.",
    "赛程底座已就位；模型概率会在赔率和球队强度数据接入后生成。":
      "Fixtures are in place; model probabilities will be generated once odds and team-strength data are connected.",
    "当前没有赔率和模型数据，先用它做真实赛程页；等赔率接入后再生成分歧指数。":
      "No odds or model data yet — this serves as a real fixture page; the edge index appears once odds connect.",
    "等待第一位 Agent 入场。": "Waiting for the first Agent.",
    "正在读取排行榜。": "Loading leaderboard…",
    "未标注模型": "Unlabeled model", "虚拟资产": "Virtual assets",
    "你押谁赢？": "Your call?", "平局": "Draw", "人群": "Crowd", "票": " votes", "注": " bets", "暂无": "—",
    "竞技场接口未连接": "Arena API not connected",
    "复制": "Copy", "已复制": "Copied", "手动复制": "Copy manually",
    "数据加载失败": "Data load failed",
    "展开全部": "Show all", "收起": "Collapse", "场": "matches"
  };

  // ---------- 球队 / 场地 ----------
  const TEAMS = {
    "乌兹别克斯坦": "Uzbekistan", "乌拉圭": "Uruguay", "伊拉克": "Iraq", "伊朗": "Iran",
    "佛得角": "Cape Verde", "克罗地亚": "Croatia", "刚果民主共和国": "DR Congo", "加拿大": "Canada",
    "加纳": "Ghana", "南非": "South Africa", "卡塔尔": "Qatar", "厄瓜多尔": "Ecuador",
    "哥伦比亚": "Colombia", "土耳其": "Türkiye", "埃及": "Egypt", "塞内加尔": "Senegal",
    "墨西哥": "Mexico", "奥地利": "Austria", "巴拉圭": "Paraguay", "巴拿马": "Panama",
    "巴西": "Brazil", "库拉索": "Curaçao", "德国": "Germany", "挪威": "Norway",
    "捷克": "Czechia", "摩洛哥": "Morocco", "新西兰": "New Zealand", "日本": "Japan",
    "比利时": "Belgium", "沙特阿拉伯": "Saudi Arabia", "法国": "France", "波黑": "Bosnia & Herz.",
    "海地": "Haiti", "澳大利亚": "Australia", "瑞典": "Sweden", "瑞士": "Switzerland",
    "科特迪瓦": "Ivory Coast", "突尼斯": "Tunisia", "约旦": "Jordan", "美国": "USA",
    "苏格兰": "Scotland", "英格兰": "England", "荷兰": "Netherlands", "葡萄牙": "Portugal",
    "西班牙": "Spain", "阿尔及利亚": "Algeria", "阿根廷": "Argentina", "韩国": "South Korea"
  };
  const VENUES = {
    "亚特兰大": "Atlanta", "休斯敦": "Houston", "堪萨斯城": "Kansas City", "墨西哥城": "Mexico City",
    "多伦多": "Toronto", "旧金山湾区（圣克拉拉）": "SF Bay Area (Santa Clara)",
    "波士顿（福克斯伯勒）": "Boston (Foxborough)", "洛杉矶（英格尔伍德）": "Los Angeles (Inglewood)",
    "温哥华": "Vancouver", "瓜达拉哈拉（萨波潘）": "Guadalajara (Zapopan)",
    "纽约/新泽西（东拉瑟福德）": "New York/New Jersey (E. Rutherford)",
    "蒙特雷（瓜达卢佩）": "Monterrey (Guadalupe)", "西雅图": "Seattle", "费城": "Philadelphia",
    "达拉斯（阿灵顿）": "Dallas (Arlington)", "迈阿密（迈阿密花园）": "Miami (Miami Gardens)"
  };
  const KO_ROUNDS = {
    "三十二强赛": "Round of 32", "十六强赛": "Round of 16", "四分之一决赛": "Quarter-final",
    "半决赛": "Semi-final", "三四名决赛": "Third-place Play-off", "决赛": "Final"
  };

  // ---------- 翻译器 ----------
  const t = (zh) => (getLang() === "en" ? (DYN[zh] ?? zh) : zh);

  function tTeam(zh) {
    if (getLang() !== "en") return zh;
    if (TEAMS[zh]) return TEAMS[zh];
    let m;
    if ((m = zh.match(/^([A-L])组第([12])名$/))) return `Group ${m[1]} ${m[2] === "1" ? "1st" : "2nd"}`;
    if ((m = zh.match(/^([A-L/]+)组第3名$/))) return `3rd: ${m[1]}`;
    if ((m = zh.match(/^第(\d+)场(胜|负)者$/))) return `${m[2] === "胜" ? "Winner" : "Loser"} M${m[1]}`;
    return zh;
  }
  function tVenue(zh) {
    return getLang() === "en" ? (VENUES[zh] ?? zh) : zh;
  }
  function tRound(zh) {
    if (getLang() !== "en") return zh;
    if (KO_ROUNDS[zh]) return KO_ROUNDS[zh];
    const m = zh.match(/^([A-L])组 - 第(\d+)比赛日$/);
    if (m) return `Group ${m[1]} · Matchday ${m[2]}`;
    return zh;
  }
  // 分歧指数提示（带插值）
  function tEdgeNote(index) {
    return getLang() === "en"
      ? `Current edge index is ${index.toFixed(1)} — watch whether live lineups and O/U levels keep moving in the same direction.`
      : `当前分歧指数为 ${index.toFixed(1)}，建议重点观察临场阵容和大小球水位是否继续同向变化。`;
  }

  // ---------- 静态 HTML 应用 ----------
  function applyStatic() {
    const lang = getLang();
    document.documentElement.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!el.dataset.i18nZh) el.dataset.i18nZh = el.textContent; // 缓存中文原文
      el.textContent = lang === "en" ? (DICT.en[key] ?? el.dataset.i18nZh) : el.dataset.i18nZh;
    });
    // 语言开关按钮文案
    const btn = document.getElementById("lang-toggle");
    if (btn) btn.textContent = lang === "en" ? "中" : "EN";
  }

  function setLang(lang) {
    localStorage.setItem(LS_KEY, lang === "en" ? "en" : "zh");
    applyStatic();
    window.dispatchEvent(new CustomEvent("wc:langchange", { detail: { lang: getLang() } }));
  }

  // 暴露给 app.js
  window.wcI18n = { getLang, setLang, t, tTeam, tVenue, tRound, tEdgeNote, applyStatic };
  window.t = t;

  // 启动：应用静态 + 绑定开关
  function init() {
    applyStatic();
    const btn = document.getElementById("lang-toggle");
    if (btn) btn.addEventListener("click", () => setLang(getLang() === "en" ? "zh" : "en"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
