import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("settle script writes completed scores using site home/away order", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wc-settle-results-"));
  try {
    const matchesFile = path.join(dir, "matches.json");
    const marketsFile = path.join(dir, "markets.json");
    const scoresFile = path.join(dir, "scores.json");

    fs.writeFileSync(matchesFile, JSON.stringify({
      updatedAt: "2026-06-12T00:00:00.000Z",
      matches: [{
        id: "wc26-m001",
        round: "A组 - 第1比赛日",
        kickoff: "2026-06-12 03:00",
        venue: "墨西哥城",
        home: "墨西哥",
        away: "南非",
        tags: ["fixture", "group"]
      }]
    }, null, 2));
    fs.writeFileSync(marketsFile, JSON.stringify({
      updatedAt: "2026-06-12T00:00:00.000Z",
      markets: [{
        matchId: "wc26-m001",
        home: "墨西哥",
        away: "南非",
        state: "open",
        oneXTwo: { home: 1.42, draw: 4.42, away: 8.51 }
      }]
    }, null, 2));
    fs.writeFileSync(scoresFile, JSON.stringify([{
      completed: true,
      home_team: "South Africa",
      away_team: "Mexico",
      scores: [
        { name: "South Africa", score: "1" },
        { name: "Mexico", score: "2" }
      ]
    }], null, 2));

    const run = spawnSync(process.execPath, ["scripts/settle.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SCORES_TEST_FILE: scoresFile,
        MATCHES_FILE: matchesFile,
        MARKETS_OUT: marketsFile,
        ARENA_ADMIN_TOKEN: "test-admin",
        ARENA_BASE: "http://127.0.0.1:1"
      },
      encoding: "utf8"
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const match = JSON.parse(fs.readFileSync(matchesFile, "utf8")).matches[0];
    assert.equal(match.result, "home");
    assert.equal(match.homeScore, 2);
    assert.equal(match.awayScore, 1);
    assert.equal(match.score, "2-1");
    assert.equal(match.completed, true);
    assert.equal(match.scoreSource, "the-odds-api");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
