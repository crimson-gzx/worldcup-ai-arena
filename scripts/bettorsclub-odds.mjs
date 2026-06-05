import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCE_URL = "https://www.bettors.club/live-soccer-scores-results/worldcup/world-cup/1056/";
const OFFSHORE_NOTE = "海外欧赔来自 Bettors.Club 公共页面；竞彩固定奖金、亚盘、大小球和模型概率仍待接入。";

const TEAM_NAMES = {
  Algeria: "阿尔及利亚",
  Argentina: "阿根廷",
  Australia: "澳大利亚",
  Austria: "奥地利",
  Belgium: "比利时",
  "Bosnia & Herzegovina": "波黑",
  Brazil: "巴西",
  Canada: "加拿大",
  "Cape Verde": "佛得角",
  Colombia: "哥伦比亚",
  Croatia: "克罗地亚",
  Curacao: "库拉索",
  "Curaçao": "库拉索",
  "Czech Republic": "捷克",
  "D.R. Congo": "刚果民主共和国",
  "DR Congo": "刚果民主共和国",
  Ecuador: "厄瓜多尔",
  Egypt: "埃及",
  England: "英格兰",
  France: "法国",
  Germany: "德国",
  Ghana: "加纳",
  Haiti: "海地",
  Iran: "伊朗",
  Iraq: "伊拉克",
  "Ivory Coast": "科特迪瓦",
  Japan: "日本",
  Jordan: "约旦",
  "Korea Republic": "韩国",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Netherlands: "荷兰",
  "New Zealand": "新西兰",
  Norway: "挪威",
  Panama: "巴拿马",
  Paraguay: "巴拉圭",
  Portugal: "葡萄牙",
  Qatar: "卡塔尔",
  "Saudi Arabia": "沙特阿拉伯",
  Scotland: "苏格兰",
  Senegal: "塞内加尔",
  "South Africa": "南非",
  "South Korea": "韩国",
  Spain: "西班牙",
  Sweden: "瑞典",
  Switzerland: "瑞士",
  Tunisia: "突尼斯",
  Turkey: "土耳其",
  USA: "美国",
  Uruguay: "乌拉圭",
  Uzbekistan: "乌兹别克斯坦"
};

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, entity) => {
      const entities = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: "\""
      };
      return entities[entity.toLowerCase()] ?? `&${entity};`;
    });
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " "));
}

function compactText(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function teamFor(sourceName) {
  const normalized = compactText(sourceName);
  return TEAM_NAMES[normalized] || normalized;
}

function teamKey(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function matchKey(home, away) {
  return `${teamKey(home)}:${teamKey(away)}`;
}

function parseOdd(value) {
  const number = Number(String(value).match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : null;
}

function classText(html, className) {
  const match = html.match(
    new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i")
  );
  return match ? compactText(match[1]) : "";
}

function oddsFromBlock(html) {
  const withoutIcons = html.replace(
    /<span\b[^>]*class=["'][^"']*\bts_change_odds_icon\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    ""
  );
  return Array.from(
    withoutIcons.matchAll(/<span\b[^>]*class=["'][^"']*\bodd\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)
  )
    .map((match) => parseOdd(compactText(match[1])))
    .filter(Number.isFinite)
    .slice(0, 3);
}

function parseAnchorFixtures(html, sourceUrl) {
  const fixtures = [];

  for (const match of String(html).matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const anchor = match[0];
    if (!/\bts_match_link\b/.test(anchor)) continue;

    const sourceHome = classText(anchor, "h_team");
    const sourceAway = classText(anchor, "a_team");
    const sourceKickoff = classText(anchor, "time");
    const odds = oddsFromBlock(anchor);
    if (!sourceHome || !sourceAway || odds.length !== 3) continue;

    fixtures.push({
      home: teamFor(sourceHome),
      away: teamFor(sourceAway),
      sourceHome,
      sourceAway,
      sourceKickoff,
      oneXTwo: {
        home: odds[0],
        draw: odds[1],
        away: odds[2]
      },
      sourceUrl
    });
  }

  return fixtures;
}

function htmlLines(html) {
  return decodeHtml(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|\/div|\/p|\/li|\/span|\/a)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseTextFixtures(html, sourceUrl) {
  const fixtures = [];
  const lines = htmlLines(html);

  for (let index = 0; index < lines.length; index += 1) {
    const teams = lines[index].match(/^(.+?)\s+vs\s+(.+)$/i);
    if (!teams) continue;

    const oddsLineIndex = lines.findIndex((line, offset) => {
      if (offset <= index) return false;
      return line.match(/\d+(?:\.\d+)?/g)?.length >= 3;
    });
    if (oddsLineIndex === -1) continue;

    const odds = lines[oddsLineIndex].match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
    const kickoffLines = lines.slice(index + 1, oddsLineIndex);
    fixtures.push({
      home: teamFor(teams[1]),
      away: teamFor(teams[2]),
      sourceHome: compactText(teams[1]),
      sourceAway: compactText(teams[2]),
      sourceKickoff: kickoffLines.join(" "),
      oneXTwo: {
        home: odds[0],
        draw: odds[1],
        away: odds[2]
      },
      sourceUrl
    });
  }

  return fixtures;
}

export function parseBettorsClubFixtures(html, options = {}) {
  const sourceUrl = options.sourceUrl || DEFAULT_SOURCE_URL;
  const anchorFixtures = parseAnchorFixtures(html, sourceUrl);
  return anchorFixtures.length ? anchorFixtures : parseTextFixtures(html, sourceUrl);
}

export function mergeBettorsClubOdds(inputPayload, fixtures, options = {}) {
  const collectedAt = options.collectedAt || new Date().toISOString();
  const payload = JSON.parse(JSON.stringify(inputPayload));
  const byTeams = new Map(payload.matches.map((match) => [matchKey(match.home, match.away), match]));
  const unmatchedFixtures = [];

  for (const fixture of fixtures) {
    let siteMatch = byTeams.get(matchKey(fixture.home, fixture.away));
    let oneXTwo = fixture.oneXTwo;

    if (!siteMatch) {
      siteMatch = byTeams.get(matchKey(fixture.away, fixture.home));
      oneXTwo = siteMatch
        ? {
            home: fixture.oneXTwo.away,
            draw: fixture.oneXTwo.draw,
            away: fixture.oneXTwo.home
          }
        : oneXTwo;
    }

    if (!siteMatch) {
      unmatchedFixtures.push(fixture);
      continue;
    }

    siteMatch.offshore = {
      source: "Bettors.Club",
      sourceUrl: fixture.sourceUrl,
      collectedAt,
      sourceKickoff: fixture.sourceKickoff,
      oneXTwo,
      asian: null,
      totals: null
    };

    siteMatch.model = siteMatch.model || {};
    siteMatch.model.notes = Array.isArray(siteMatch.model.notes) ? siteMatch.model.notes : [];
    if (!siteMatch.model.notes.includes(OFFSHORE_NOTE)) {
      siteMatch.model.notes.push(OFFSHORE_NOTE);
    }
  }

  payload.updatedAt = collectedAt;
  if (fixtures.length > unmatchedFixtures.length) {
    payload.notice = "真实赛程 + Bettors.Club 小组赛 1X2 赔率；竞彩固定奖金和模型概率仍待接入。";
    payload.oddsSource = {
      name: "Bettors.Club",
      url: DEFAULT_SOURCE_URL,
      collectedAt,
      matched: fixtures.length - unmatchedFixtures.length,
      unmatched: unmatchedFixtures.length
    };
  }

  return {
    payload,
    matched: fixtures.length - unmatchedFixtures.length,
    unmatched: unmatchedFixtures.length,
    unmatchedFixtures
  };
}

export async function collectBettorsClubOdds(options = {}) {
  const sourceUrl = options.sourceUrl || DEFAULT_SOURCE_URL;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(sourceUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 WorldCupIntelSite/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Unable to collect Bettors.Club odds: ${response.status}`);
  }
  return parseBettorsClubFixtures(await response.text(), { sourceUrl });
}

async function runCli() {
  const [, scriptPath, inputPath = "data/matches.json", outputPath = inputPath, sourceUrl = DEFAULT_SOURCE_URL] =
    process.argv;
  const currentPath = fileURLToPath(import.meta.url);

  if (path.resolve(scriptPath || "") !== currentPath) {
    return;
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const fixtures = await collectBettorsClubOdds({ sourceUrl });
  const result = mergeBettorsClubOdds(payload, fixtures);
  fs.writeFileSync(outputPath, `${JSON.stringify(result.payload, null, 2)}\n`);
  console.log(
    `Collected ${fixtures.length} Bettors.Club fixtures; matched ${result.matched}, unmatched ${result.unmatched}.`
  );
}

runCli().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
