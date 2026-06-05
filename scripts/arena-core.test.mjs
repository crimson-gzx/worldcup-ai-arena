import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBetSlip,
  calculateSettlement,
  rankLeaderboard
} from "./arena-core.mjs";

const openMatch = {
  id: "wc26-m001",
  home: "墨西哥",
  away: "南非",
  state: "open",
  market: {
    type: "one_x_two",
    cutoffAt: "2026-06-12T02:45:00+08:00",
    odds: { home: 1.88, draw: 3.2, away: 4.6 }
  }
};

test("builds an accepted bet slip for an open single-match market", () => {
  const result = buildBetSlip({
    match: openMatch,
    agentId: "agent_001",
    selection: "home",
    stake: 100,
    now: "2026-06-12T02:00:00+08:00",
    currentMatchExposure: 0,
    availableBalance: 10000
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.bet.selection, "home");
  assert.equal(result.bet.potentialReturn, 188);
});

test("rejects bets on scheduled matches without official fixed bonus", () => {
  const result = buildBetSlip({
    match: { ...openMatch, state: "scheduled", market: null },
    agentId: "agent_001",
    selection: "home",
    stake: 100,
    now: "2026-06-12T02:00:00+08:00",
    currentMatchExposure: 0,
    availableBalance: 10000
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "MATCH_NOT_OPEN");
});

test("rejects stakes outside arena limits", () => {
  assert.equal(
    buildBetSlip({
      match: openMatch,
      agentId: "agent_001",
      selection: "draw",
      stake: 9,
      now: "2026-06-12T02:00:00+08:00",
      currentMatchExposure: 0,
      availableBalance: 10000
    }).code,
    "STAKE_OUT_OF_RANGE"
  );

  assert.equal(
    buildBetSlip({
      match: openMatch,
      agentId: "agent_001",
      selection: "draw",
      stake: 1001,
      now: "2026-06-12T02:00:00+08:00",
      currentMatchExposure: 0,
      availableBalance: 10000
    }).code,
    "STAKE_OUT_OF_RANGE"
  );
});

test("rejects bets after cutoff and over per-match exposure", () => {
  assert.equal(
    buildBetSlip({
      match: openMatch,
      agentId: "agent_001",
      selection: "away",
      stake: 100,
      now: "2026-06-12T02:45:00+08:00",
      currentMatchExposure: 0,
      availableBalance: 10000
    }).code,
    "MATCH_CLOSED"
  );

  assert.equal(
    buildBetSlip({
      match: openMatch,
      agentId: "agent_001",
      selection: "away",
      stake: 1000,
      now: "2026-06-12T02:00:00+08:00",
      currentMatchExposure: 1500,
      availableBalance: 10000
    }).code,
    "MATCH_EXPOSURE_LIMIT"
  );
});

test("settles winning and losing bets from official result", () => {
  const baseBet = {
    id: "bet_001",
    agentId: "agent_001",
    matchId: "wc26-m001",
    selection: "home",
    stake: 100,
    odds: 1.88,
    status: "accepted"
  };

  assert.deepEqual(calculateSettlement(baseBet, { winner: "home", settledAt: "2026-06-12T05:00:00+08:00" }), {
    ...baseBet,
    status: "settled",
    result: "won",
    payout: 188,
    profit: 88,
    settledAt: "2026-06-12T05:00:00+08:00"
  });

  assert.equal(
    calculateSettlement(
      { ...baseBet, selection: "away" },
      { winner: "home", settledAt: "2026-06-12T05:00:00+08:00" }
    ).profit,
    -100
  );
});

test("ranks agents by total virtual value", () => {
  const leaderboard = rankLeaderboard(
    [
      { id: "agent_a", name: "Agent A" },
      { id: "agent_b", name: "Agent B" }
    ],
    [
      { agentId: "agent_a", stake: 100, status: "settled", result: "won", profit: 88 },
      { agentId: "agent_b", stake: 100, status: "settled", result: "lost", profit: -100 }
    ]
  );

  assert.equal(leaderboard[0].agentId, "agent_a");
  assert.equal(leaderboard[0].profit, 88);
  assert.equal(leaderboard[1].profit, -100);
});
