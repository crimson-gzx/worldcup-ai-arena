import fs from "node:fs";

const squads = JSON.parse(fs.readFileSync("data/squads.json", "utf8"));
const teams = squads.teams || squads;

let totalPlayers = 0;
let valuedPlayers = 0;
const missing = [];
const mismatchedTotals = [];

for (const [teamName, team] of Object.entries(teams)) {
  const players = Array.isArray(team.players) ? team.players : [];
  const teamValue = players.reduce((sum, player) => {
    const value = Number(player.market_value_eur);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const covered = players.filter((player) => Number(player.market_value_eur) > 0).length;

  totalPlayers += players.length;
  valuedPlayers += covered;

  for (const player of players) {
    if (!(Number(player.market_value_eur) > 0)) {
      missing.push(`${teamName}\t${player.no || ""}\t${player.pos || ""}\t${player.en || player.zh || ""}`);
    }
  }

  if (Number(team.market_value_eur) !== teamValue || Number(team.market_value_covered) !== covered || Number(team.market_value_players) !== players.length) {
    mismatchedTotals.push(`${teamName}\tstored=${team.market_value_eur}/${team.market_value_covered}/${team.market_value_players}\tactual=${teamValue}/${covered}/${players.length}`);
  }
}

console.log(JSON.stringify({
  teams: Object.keys(teams).length,
  totalPlayers,
  valuedPlayers,
  missingPlayers: totalPlayers - valuedPlayers,
  mismatchedTeams: mismatchedTotals.length
}, null, 2));

if (missing.length) {
  console.error("\nMissing market values:\n" + missing.join("\n"));
}

if (mismatchedTotals.length) {
  console.error("\nMismatched team totals:\n" + mismatchedTotals.join("\n"));
}

if (missing.length || mismatchedTotals.length) {
  process.exit(1);
}
