import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOpenFootballWorldCup } from "./worldcup-data.mjs";

test("normalizes openfootball 2026 fixtures into site match data", () => {
  const source = {
    name: "World Cup 2026",
    matches: [
      {
        num: 1,
        round: "Matchday 1",
        date: "2026-06-11",
        time: "13:00 UTC-6",
        team1: "Mexico",
        team2: "South Africa",
        stadium: {
          name: "Estadio Azteca",
          city: "Mexico City"
        },
        group: "Group A"
      }
    ]
  };

  const payload = normalizeOpenFootballWorldCup(source, {
    updatedAt: "2026-06-01T12:00:00+08:00"
  });

  assert.equal(payload.updatedAt, "2026-06-01T12:00:00+08:00");
  assert.equal(payload.source.name, "openfootball/worldcup.json");
  assert.equal(payload.matches.length, 1);
  assert.deepEqual(payload.matches[0], {
    id: "wc26-m001",
    round: "A组 - 第1比赛日",
    kickoff: "2026-06-12 03:00",
    venue: "阿兹特克体育场，墨西哥城",
    home: "墨西哥",
    away: "南非",
    tags: ["fixture", "group"],
    lottery: null,
    offshore: null,
    model: {
      home: null,
      draw: null,
      away: null,
      xgHome: null,
      xgAway: null,
      notes: [
        "真实赛程已导入；赔率、竞彩固定奖金和模型概率等待数据源接入。",
        "开球时间按北京时间展示，方便国内用户阅读。"
      ]
    }
  });
});

test("translates knockout placeholders into Chinese labels", () => {
  const source = {
    matches: [
      {
        round: "Round of 32",
        date: "2026-06-28",
        time: "12:00 UTC-7",
        team1: "1A",
        team2: "3C/E/F/H/I",
        ground: "Los Angeles (Inglewood)"
      },
      {
        round: "Final",
        date: "2026-07-19",
        time: "15:00 UTC-4",
        team1: "W101",
        team2: "W102",
        ground: "New York/New Jersey (East Rutherford)"
      }
    ]
  };

  const payload = normalizeOpenFootballWorldCup(source, {
    updatedAt: "2026-06-01T12:00:00+08:00"
  });

  assert.equal(payload.matches[0].round, "三十二强赛");
  assert.equal(payload.matches[0].home, "A组第1名");
  assert.equal(payload.matches[0].away, "C/E/F/H/I组第3名");
  assert.equal(payload.matches[0].venue, "洛杉矶（英格尔伍德）");
  assert.equal(payload.matches[1].round, "决赛");
  assert.equal(payload.matches[1].home, "第101场胜者");
  assert.equal(payload.matches[1].away, "第102场胜者");
  assert.equal(payload.matches[1].venue, "纽约/新泽西（东拉瑟福德）");
});
