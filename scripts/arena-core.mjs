export const ARENA_LIMITS = {
  initialBalance: 1000000,
  minStake: 10,
  maxStake: 1000,
  maxExposurePerMatch: 2000
};

const VALID_SELECTIONS = new Set(["home", "draw", "away"]);

function toMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function timestamp(value) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : Number.NaN;
}

export function buildBetSlip(input) {
  const stake = Number(input.stake);
  const odds = input.match?.market?.odds?.[input.selection];

  if (input.match?.state !== "open" || !input.match?.market) {
    return {
      status: "rejected",
      code: "MATCH_NOT_OPEN",
      message: "This match is not open for simulated betting."
    };
  }

  if (timestamp(input.now) >= timestamp(input.match.market.cutoffAt)) {
    return {
      status: "rejected",
      code: "MATCH_CLOSED",
      message: "The betting cutoff has passed."
    };
  }

  if (!VALID_SELECTIONS.has(input.selection) || !Number.isFinite(odds)) {
    return {
      status: "rejected",
      code: "INVALID_SELECTION",
      message: "Selection must be home, draw, or away."
    };
  }

  if (!Number.isFinite(stake) || stake < ARENA_LIMITS.minStake || stake > ARENA_LIMITS.maxStake) {
    return {
      status: "rejected",
      code: "STAKE_OUT_OF_RANGE",
      message: "Stake must be between 10 and 1000 virtual credits."
    };
  }

  if (Number(input.currentMatchExposure || 0) + stake > ARENA_LIMITS.maxExposurePerMatch) {
    return {
      status: "rejected",
      code: "MATCH_EXPOSURE_LIMIT",
      message: "Per-match exposure limit exceeded."
    };
  }

  if (stake > Number(input.availableBalance || 0)) {
    return {
      status: "rejected",
      code: "INSUFFICIENT_BALANCE",
      message: "Available virtual balance is too low."
    };
  }

  return {
    status: "accepted",
    bet: {
      id: input.id || `bet_${Date.now()}`,
      agentId: input.agentId,
      matchId: input.match.id,
      marketType: input.match.market.type,
      selection: input.selection,
      stake: toMoney(stake),
      odds: toMoney(odds),
      potentialReturn: toMoney(stake * odds),
      status: "accepted",
      reasoning: input.reasoning || "",
      placedAt: input.now
    }
  };
}

export function calculateSettlement(bet, result) {
  const won = bet.selection === result.winner;
  const payout = won ? toMoney(bet.stake * bet.odds) : 0;
  return {
    ...bet,
    status: "settled",
    result: won ? "won" : "lost",
    payout,
    profit: toMoney(payout - bet.stake),
    settledAt: result.settledAt
  };
}

export function rankLeaderboard(agents, bets) {
  return agents
    .map((agent) => {
      const agentBets = bets.filter((bet) => bet.agentId === agent.id);
      const settled = agentBets.filter((bet) => bet.status === "settled");
      const accepted = agentBets.filter((bet) => bet.status === "accepted");
      const profit = settled.reduce((sum, bet) => sum + Number(bet.profit || 0), 0);
      const reserved = accepted.reduce((sum, bet) => sum + Number(bet.stake || 0), 0);
      const totalValue = toMoney(ARENA_LIMITS.initialBalance + profit - reserved);
      const stakeTotal = settled.reduce((sum, bet) => sum + Number(bet.stake || 0), 0);
      const wins = settled.filter((bet) => bet.result === "won").length;

      return {
        agentId: agent.id,
        name: agent.name,
        model: agent.model || "",
        totalValue,
        profit: toMoney(profit),
        roi: stakeTotal ? toMoney(profit / stakeTotal) : 0,
        hitRate: settled.length ? toMoney(wins / settled.length) : 0,
        betCount: agentBets.length,
        activeExposure: toMoney(reserved)
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue || b.roi - a.roi || b.betCount - a.betCount);
}
