import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function loadInitialOpenDays({ filter = "recent", selectedId = null, now = 0 } = {}) {
  const app = fs.readFileSync("app.js", "utf8");
  const source = extractFunction(app, "initialOpenDaysForMatchList");
  const context = {
    state: { filter, selectedId },
    Date: { now: () => now },
    Set,
    matchDate: (match) => match.date,
    matchScore: (match) => match.score || null,
    kickoffStamp: (match) => match.stamp
  };
  vm.runInNewContext(`${source}\nglobalThis.fn = initialOpenDaysForMatchList;`, context);
  return context.fn;
}

function byDateFor(matches) {
  const map = new Map();
  for (const match of matches) {
    if (!map.has(match.date)) map.set(match.date, []);
    map.get(match.date).push(match);
  }
  return map;
}

test("recent match list opens completed, live, selected and next days by default", () => {
  const now = 100_000;
  const matches = [
    { id: "done-yesterday", date: "2026-06-20", stamp: now - 20_000, score: { completed: true } },
    { id: "live-today", date: "2026-06-21", stamp: now - 1_000, score: { live: true } },
    { id: "next-today", date: "2026-06-21", stamp: now + 1_000, score: null },
    { id: "selected-tomorrow", date: "2026-06-22", stamp: now + 80_000, score: null }
  ];
  const order = ["2026-06-20", "2026-06-21", "2026-06-22"];
  const initialOpenDays = loadInitialOpenDays({ filter: "recent", selectedId: "selected-tomorrow", now });

  assert.deepEqual([...initialOpenDays(matches, order, byDateFor(matches))], order);
});

test("non-recent match list still opens only the selected day first", () => {
  const matches = [
    { id: "done", date: "2026-06-20", stamp: 1, score: { completed: true } },
    { id: "selected", date: "2026-06-21", stamp: 2, score: null }
  ];
  const initialOpenDays = loadInitialOpenDays({ filter: "group-A", selectedId: "selected", now: 0 });

  assert.deepEqual([...initialOpenDays(matches, ["2026-06-20", "2026-06-21"], byDateFor(matches))], ["2026-06-21"]);
});

test("match day headers expose aria-expanded state", () => {
  const app = fs.readFileSync("app.js", "utf8");
  assert.match(app, /aria-expanded="\$\{open\}"/);
});
