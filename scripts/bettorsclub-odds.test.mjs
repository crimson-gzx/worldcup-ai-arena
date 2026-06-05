import assert from "node:assert/strict";
import test from "node:test";

import { mergeBettorsClubOdds, parseBettorsClubFixtures } from "./bettorsclub-odds.mjs";

const sourceUrl = "https://www.bettors.club/live-soccer-scores-results/worldcup/world-cup/1056/";

test("parses Bettors Club fixture odds from page text", () => {
  const html = `
    <div>Mexico vs South Africa</div>
    <div>Thu 11 Jun 2026</div>
    <div>20:00 GMT</div>
    <div>1.48 4.0 6.5</div>
  `;

  const fixtures = parseBettorsClubFixtures(html, { sourceUrl });

  assert.deepEqual(fixtures, [
    {
      home: "墨西哥",
      away: "南非",
      sourceHome: "Mexico",
      sourceAway: "South Africa",
      sourceKickoff: "Thu 11 Jun 2026 20:00 GMT",
      oneXTwo: {
        home: 1.48,
        draw: 4,
        away: 6.5
      },
      sourceUrl
    }
  ]);
});

test("merges parsed offshore odds into matching site fixtures", () => {
  const payload = {
    updatedAt: "2026-06-01T08:13:05.744Z",
    notice: "2026 世界杯真实赛程快照。赔率、竞彩固定奖金和模型概率等待接入。",
    matches: [
      {
        id: "wc26-m001",
        round: "A组 - 第1比赛日",
        kickoff: "2026-06-12 03:00",
        home: "墨西哥",
        away: "南非",
        lottery: null,
        offshore: null,
        model: {
          home: null,
          draw: null,
          away: null,
          notes: ["真实赛程已导入。"]
        }
      },
      {
        id: "wc26-m002",
        round: "淘汰赛",
        kickoff: "2026-06-29 03:00",
        home: "A组第1名",
        away: "B组第2名",
        lottery: null,
        offshore: null,
        model: { notes: [] }
      }
    ]
  };
  const fixtures = [
    {
      home: "墨西哥",
      away: "南非",
      sourceHome: "Mexico",
      sourceAway: "South Africa",
      sourceKickoff: "Thu 11 Jun 2026 20:00 GMT",
      oneXTwo: { home: 1.48, draw: 4, away: 6.5 },
      sourceUrl
    }
  ];

  const result = mergeBettorsClubOdds(payload, fixtures, {
    collectedAt: "2026-06-03T00:00:00+08:00"
  });

  assert.equal(result.matched, 1);
  assert.equal(result.unmatched, 0);
  assert.equal(result.payload.notice, "真实赛程 + Bettors.Club 小组赛 1X2 赔率；竞彩固定奖金和模型概率仍待接入。");
  assert.deepEqual(result.payload.matches[0].offshore, {
    source: "Bettors.Club",
    sourceUrl,
    collectedAt: "2026-06-03T00:00:00+08:00",
    sourceKickoff: "Thu 11 Jun 2026 20:00 GMT",
    oneXTwo: { home: 1.48, draw: 4, away: 6.5 },
    asian: null,
    totals: null
  });
  assert.equal(result.payload.matches[0].model.notes.at(-1), "海外欧赔来自 Bettors.Club 公共页面；竞彩固定奖金、亚盘、大小球和模型概率仍待接入。");
  assert.equal(result.payload.matches[1].offshore, null);
});
