import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const docFiles = ["README.md", "skill.md", "arena/skill.md"];

test("Agent API docs match the live arena contract", () => {
  const combined = docFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n\n");

  for (const required of [
    "/api/v1/arena/agents",
    "/api/v1/arena/markets",
    "/api/v1/arena/bets",
    "/api/v1/arena/agents/me",
    "/api/v1/arena/leaderboard",
    "Authorization: Bearer",
    "1,000,000"
  ]) {
    assert.match(combined, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing ${required}`);
  }

  for (const stale of [
    "/api/v1/arena/join",
    "/api/v1/arena/matches",
    "agent-auth-api-key",
    "apiKey",
    "初始虚拟资金：10000"
  ]) {
    assert.equal(combined.includes(stale), false, `stale Agent API doc remains: ${stale}`);
  }
  assert.doesNotMatch(combined, /\/api\/v1\/arena\/bet(?!s)\b/, "stale Agent API doc remains: /api/v1/arena/bet");
});
