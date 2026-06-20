import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const squads = JSON.parse(fs.readFileSync("data/squads.json", "utf8"));
const teams = squads.teams || squads;
const LINEUP_SHAPES = [
  { label: "4-3-3", counts: { GK: 1, DF: 4, MF: 3, FW: 3 } },
  { label: "3-4-3", counts: { GK: 1, DF: 3, MF: 4, FW: 3 } },
  { label: "4-4-2", counts: { GK: 1, DF: 4, MF: 4, FW: 2 } },
  { label: "3-5-2", counts: { GK: 1, DF: 3, MF: 5, FW: 2 } },
  { label: "4-5-1", counts: { GK: 1, DF: 4, MF: 5, FW: 1 } },
  { label: "5-3-2", counts: { GK: 1, DF: 5, MF: 3, FW: 2 } }
];

function playerValue(player) {
  const value = Number(player?.market_value_eur);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function lineupSort(a, b) {
  return playerValue(b) - playerValue(a)
    || (Number(b.caps) || 0) - (Number(a.caps) || 0)
    || (Number(a.no) || 99) - (Number(b.no) || 99);
}

function lineupValue(players) {
  return players.reduce((sum, player) => sum + playerValue(player), 0);
}

function selectLineupForShape(players, counts) {
  const selected = [];
  const used = new Set();

  for (const [pos, count] of Object.entries(counts)) {
    players
      .filter((player) => player.pos === pos)
      .sort(lineupSort)
      .slice(0, count)
      .forEach((player) => {
        selected.push(player);
        used.add(player);
      });
  }

  if (selected.length < 11) {
    players
      .filter((player) => !used.has(player))
      .sort(lineupSort)
      .slice(0, 11 - selected.length)
      .forEach((player) => selected.push(player));
  }

  const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  return selected
    .slice(0, 11)
    .sort((a, b) => (order[a.pos] ?? 9) - (order[b.pos] ?? 9) || (Number(a.no) || 99) - (Number(b.no) || 99));
}

function projectedLineupInfo(team) {
  const players = Array.isArray(team?.players) ? team.players : [];
  if (!players.length) return { players: [], covered: 0, value: 0, shape: "-" };

  const candidates = LINEUP_SHAPES.map((shape, index) => {
    const lineup = selectLineupForShape(players, shape.counts);
    const covered = lineup.filter((player) => playerValue(player) > 0).length;
    return { index, lineup, covered, value: lineupValue(lineup), shape: shape.label };
  });

  candidates.sort((a, b) => b.covered - a.covered || b.value - a.value || a.index - b.index);
  const best = candidates[0];
  return { players: best.lineup, covered: best.covered, value: best.value, shape: best.shape };
}

test("squad value data covers every finalist", () => {
  assert.equal(Object.keys(teams).length, 48);
  for (const [name, team] of Object.entries(teams)) {
    assert.ok(Array.isArray(team.players), `${name} has no players array`);
    assert.ok(team.players.length >= 11, `${name} has fewer than 11 players`);
    assert.ok(Number(team.market_value_eur) > 0, `${name} has no squad market value`);
  }
});

test("projected lineups are complete and use the best valued common shape", () => {
  for (const [name, team] of Object.entries(teams)) {
    const lineup = projectedLineupInfo(team);
    const allPlayers = Array.isArray(team.players) ? team.players : [];
    const bestPossible = Math.max(...LINEUP_SHAPES.map((shape) => {
      const candidate = selectLineupForShape(allPlayers, shape.counts);
      return candidate.filter((player) => playerValue(player) > 0).length;
    }));

    assert.equal(lineup.players.length, 11, `${name} projected XI is incomplete`);
    assert.equal(lineup.covered, bestPossible, `${name} projected XI does not maximize valued players`);
    assert.ok(lineup.covered >= 10, `${name} projected XI only has ${lineup.covered}/11 market values`);
    assert.ok(lineup.value > 0, `${name} projected XI has no market value`);
  }
});
