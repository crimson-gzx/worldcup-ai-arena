import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://github.com/openfootball/worldcup.json/blob/master/2026/worldcup.json";
const BEIJING_OFFSET_MINUTES = 8 * 60;

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
  "Curaçao": "库拉索",
  "Czech Republic": "捷克",
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

const VENUE_NAMES = {
  Atlanta: "亚特兰大",
  "Boston (Foxborough)": "波士顿（福克斯伯勒）",
  "Dallas (Arlington)": "达拉斯（阿灵顿）",
  "Estadio Azteca, Mexico City": "阿兹特克体育场，墨西哥城",
  "Guadalajara (Zapopan)": "瓜达拉哈拉（萨波潘）",
  Houston: "休斯敦",
  "Kansas City": "堪萨斯城",
  "Los Angeles (Inglewood)": "洛杉矶（英格尔伍德）",
  "Mexico City": "墨西哥城",
  "Miami (Miami Gardens)": "迈阿密（迈阿密花园）",
  "Monterrey (Guadalupe)": "蒙特雷（瓜达卢佩）",
  "New York/New Jersey (East Rutherford)": "纽约/新泽西（东拉瑟福德）",
  Philadelphia: "费城",
  "San Francisco Bay Area (Santa Clara)": "旧金山湾区（圣克拉拉）",
  Seattle: "西雅图",
  Toronto: "多伦多",
  Vancouver: "温哥华"
};

const ROUND_NAMES = {
  Final: "决赛",
  "Match for third place": "三四名决赛",
  "Quarter-final": "四分之一决赛",
  "Round of 16": "十六强赛",
  "Round of 32": "三十二强赛",
  "Semi-final": "半决赛"
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatBeijingKickoff(date, time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})(?:\s+UTC([+-]\d{1,2}))?$/);
  if (!match) {
    return `${date} ${time}`;
  }

  const [, hour, minute, offsetText = "+0"] = match;
  const sourceOffsetMinutes = Number(offsetText) * 60;
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(hour),
    Number(minute)
  );
  const beijing = new Date(utc + (BEIJING_OFFSET_MINUTES - sourceOffsetMinutes) * 60_000);

  return [
    `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())}`,
    `${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}`
  ].join(" ");
}

function venueFor(match) {
  let venue = "待定";
  if (typeof match.ground === "string" && match.ground.trim()) {
    venue = match.ground.trim();
  } else if (match.stadium?.name && match.stadium?.city) {
    venue = `${match.stadium.name}, ${match.stadium.city}`;
  } else if (match.stadium?.name) {
    venue = match.stadium.name;
  }
  return VENUE_NAMES[venue] || venue;
}

function groupFor(group) {
  const match = String(group).match(/^Group ([A-L])$/);
  return match ? `${match[1]}组` : group;
}

function roundName(round) {
  const matchday = String(round).match(/^Matchday (\d+)$/);
  if (matchday) return `第${matchday[1]}比赛日`;
  return ROUND_NAMES[round] || round;
}

function roundFor(match) {
  return match.group ? `${groupFor(match.group)} - ${roundName(match.round)}` : roundName(match.round);
}

function teamFor(name) {
  if (TEAM_NAMES[name]) return TEAM_NAMES[name];

  const groupRank = String(name).match(/^([123])([A-L](?:\/[A-L])*)$/);
  if (groupRank) {
    const [, rank, groups] = groupRank;
    return `${groups}组第${rank}名`;
  }

  const winner = String(name).match(/^W(\d+)$/);
  if (winner) return `第${winner[1]}场胜者`;

  const loser = String(name).match(/^L(\d+)$/);
  if (loser) return `第${loser[1]}场负者`;

  return name;
}

function tagsFor(match) {
  const tags = ["fixture"];
  if (match.group) {
    tags.push("group");
  } else {
    tags.push("knockout");
  }
  return tags;
}

function emptyModel() {
  return {
    home: null,
    draw: null,
    away: null,
    xgHome: null,
    xgAway: null,
    notes: [
      "真实赛程已导入；赔率、竞彩固定奖金和模型概率等待数据源接入。",
      "开球时间按北京时间展示，方便国内用户阅读。"
    ]
  };
}

export function normalizeOpenFootballWorldCup(source, options = {}) {
  if (!Array.isArray(source?.matches)) {
    throw new TypeError("openfootball source must include a matches array");
  }

  return {
    updatedAt: options.updatedAt || new Date().toISOString(),
    notice: "2026 世界杯真实赛程快照。赔率、竞彩固定奖金和模型概率等待接入。",
    source: {
      name: "openfootball/worldcup.json",
      url: SOURCE_URL,
      originalName: source.name === "World Cup 2026" ? "2026 世界杯" : source.name || "2026 世界杯"
    },
    matches: source.matches.map((match, index) => ({
      id: `wc26-m${String(index + 1).padStart(3, "0")}`,
      round: roundFor(match),
      kickoff: formatBeijingKickoff(match.date, match.time),
      venue: venueFor(match),
      home: teamFor(match.team1),
      away: teamFor(match.team2),
      tags: tagsFor(match),
      lottery: null,
      offshore: null,
      model: emptyModel()
    }))
  };
}

async function runCli() {
  const [, scriptPath, inputPath = "data/sources/openfootball-2026-worldcup.json", outputPath = "data/matches.json"] =
    process.argv;
  const currentPath = fileURLToPath(import.meta.url);

  if (path.resolve(scriptPath) !== currentPath) {
    return;
  }

  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const payload = normalizeOpenFootballWorldCup(source);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Imported ${payload.matches.length} matches into ${outputPath}`);
}

runCli();
