import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, options = {}, tries = 50) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function futureIso(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

async function withArena(t, { markets = [], capital = 1000000 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wc-arena-test-"));
  fs.writeFileSync(path.join(dataDir, "markets.json"), JSON.stringify({ updatedAt: futureIso(0), markets }, null, 2));

  const port = await freePort();
  const adminToken = "test-admin-token";
  const child = spawn(process.execPath, ["arena/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ARENA_DATA: dataDir,
      ARENA_PORT: String(port),
      ARENA_ADMIN_TOKEN: adminToken,
      ARENA_CAPITAL: String(capital)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  t.after(() => {
    if (!child.killed) child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForJson(`${base}/health`);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${logs}`);
  }
  return { base, adminToken, dataDir };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("arena server runs the public Agent flow end to end", async (t) => {
  const market = {
    matchId: "wc26-test-open",
    home: "主队",
    away: "客队",
    state: "open",
    cutoffAt: futureIso(24),
    oneXTwo: { home: 2.5, draw: 3.1, away: 2.9 }
  };
  const { base, adminToken } = await withArena(t, { markets: [market], capital: 1000 });

  const home = await waitForJson(`${base}/api/v1/arena/home`);
  assert.equal(home.virtualCapital, 1000);
  assert.equal(home.openMatches, 1);

  const registered = await jsonFetch(`${base}/api/v1/arena/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "集成测试 Agent", model: "node:test" })
  });
  assert.equal(registered.response.status, 201);
  assert.match(registered.body.agentId, /^a_/);
  assert.match(registered.body.token, /^[a-f0-9]{48}$/);
  assert.equal(registered.body.cash, 1000);

  const auth = { Authorization: `Bearer ${registered.body.token}` };
  const markets = await waitForJson(`${base}/api/v1/arena/markets`);
  assert.equal(markets.markets.length, 1);
  assert.equal(markets.markets[0].matchId, market.matchId);
  assert.equal(markets.markets[0].home, "主队");
  assert.equal(markets.markets[0].away, "客队");

  const placed = await jsonFetch(`${base}/api/v1/arena/bets`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: market.matchId, selection: "home", stake: 100 })
  });
  assert.equal(placed.response.status, 201);
  assert.equal(placed.body.bet.status, "open");
  assert.equal(placed.body.bet.odds, 2.5);
  assert.equal(placed.body.cash, 900);

  const meOpen = await waitForJson(`${base}/api/v1/arena/agents/me`, {
    headers: auth
  });
  assert.equal(meOpen.cash, 900);
  assert.equal(meOpen.openStake, 100);
  assert.equal(meOpen.totalValue, 1000);
  assert.equal(meOpen.bets.length, 1);

  const settled = await jsonFetch(`${base}/api/v1/arena/admin/settle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: market.matchId, result: "home" })
  });
  assert.equal(settled.response.status, 200);
  assert.equal(settled.body.settled, 1);

  const meSettled = await waitForJson(`${base}/api/v1/arena/agents/me`, {
    headers: auth
  });
  assert.equal(meSettled.cash, 1150);
  assert.equal(meSettled.openStake, 0);
  assert.equal(meSettled.totalValue, 1150);
  assert.equal(meSettled.bets[0].status, "won");

  const board = await waitForJson(`${base}/api/v1/arena/leaderboard`);
  assert.equal(board.leaderboard[0].profit, 150);
  assert.equal(board.leaderboard[0].wins, 1);
});

test("arena server rejects stale auth and closed markets", async (t) => {
  const { base } = await withArena(t, {
    markets: [
      {
        matchId: "wc26-test-closed",
        state: "open",
        cutoffAt: futureIso(-1),
        oneXTwo: { home: 1.9, draw: 3.2, away: 4.4 }
      }
    ]
  });

  const unauthorized = await jsonFetch(`${base}/agents/me`, {
    headers: { Authorization: "Bearer nope" }
  });
  assert.equal(unauthorized.response.status, 401);

  const registered = await jsonFetch(`${base}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Closed Market Agent" })
  });
  const placed = await jsonFetch(`${base}/bets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.body.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: "wc26-test-closed", selection: "home", stake: 100 })
  });
  assert.equal(placed.response.status, 400);
  assert.match(placed.body.error, /未开放投注/);
});
