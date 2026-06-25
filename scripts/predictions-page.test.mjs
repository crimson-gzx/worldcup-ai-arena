import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const html = fs.readFileSync("predictions.html", "utf8");
const sources = JSON.parse(fs.readFileSync("data/prediction-sources.json", "utf8"));
const externalPredictions = JSON.parse(fs.readFileSync("data/external-predictions.json", "utf8"));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unable to extract ${name}`);
}

test("prediction page is a standalone Chinese information view", () => {
  assert.match(html, /<title>中文足球预测信息集合<\/title>/);
  assert.match(html, /比赛信号表/);
  assert.match(html, /今日先看/);
  assert.match(html, /来源接入状态/);
  assert.match(html, /外部源：媒体观点 \/ 市场信号分开显示/);
  assert.match(html, /external-predictions\.json/);
  assert.match(html, /观点\/信号/);
  assert.match(html, /data\/matches\.json/);
  assert.match(html, /data\/squads\.json/);
  assert.match(html, /data\/prediction-sources\.json/);
});

test("prediction sources use real links and clear status", () => {
  assert.match(sources.note, /已接入源会进入比赛表/);
  assert.match(sources.note, /external-predictions\.json/);
  assert.ok(Array.isArray(sources.sources));
  assert.ok(sources.sources.length >= 8);
  assert.equal(sources.sources.filter((source) => source.integration === "已接入").length, 3);
  assert.ok(sources.sources.filter((source) => source.integration === "已抓取").length >= 3);
  assert.ok(sources.sources.filter((source) => source.integration === "暂无匹配").length >= 5);

  const ids = new Set();
  for (const source of sources.sources) {
    assert.ok(source.id);
    assert.ok(!ids.has(source.id), `duplicate id: ${source.id}`);
    ids.add(source.id);
    assert.ok(source.name);
    assert.ok(source.summary);
    assert.ok(["已接入", "已抓取", "可打开", "可浏览", "需浏览器核对", "暂无今日匹配", "访问受限"].includes(source.status));
    assert.ok(["已接入", "已抓取", "待抓取", "暂无匹配", "访问受限"].includes(source.integration));

    if (source.kind === "free-site" || source.kind === "media" || source.kind === "market" || source.kind === "value") {
      assert.match(source.url, /^https:\/\//, `${source.name} should use a full public URL`);
    }
  }
});

test("prediction page keeps copy compact", () => {
  assert.doesNotMatch(html, /首先|其次|最后|总的来说|综上所述/);
  assert.doesNotMatch(html, /\s+vs\s+/i);
  assert.match(html, /暂无抓取观点/);
  assert.match(html, /未开赛优先/);
});

test("prediction page sorts upcoming matches ahead of finished matches", () => {
  const source = [
    extractFunction(html, "matchPriorityBucket"),
    extractFunction(html, "compareMatchPriority"),
    "globalThis.compareMatchPriority = compareMatchPriority;"
  ].join("\n");
  const context = { Date };
  vm.runInNewContext(source, context);
  const now = new Date("2026-06-26T08:00:00+08:00").getTime();
  const rows = [
    { id: "finished-old", kickoffDate: new Date("2026-06-26T04:00:00+08:00") },
    { id: "upcoming-late", kickoffDate: new Date("2026-06-26T10:00:00+08:00") },
    { id: "live", kickoffDate: new Date("2026-06-26T07:00:00+08:00") },
    { id: "upcoming-soon", kickoffDate: new Date("2026-06-26T09:00:00+08:00") },
    { id: "completed", completed: true, score: "1-0", result: "home", kickoffDate: new Date("2026-06-26T07:30:00+08:00") }
  ];
  rows.sort((a, b) => context.compareMatchPriority(a, b, now));

  assert.deepEqual(rows.map((row) => row.id), [
    "upcoming-soon",
    "upcoming-late",
    "live",
    "completed",
    "finished-old"
  ]);
});

test("external predictions are optional at runtime", () => {
  assert.match(html, /fetchJsonRequired\("\.\/data\/matches\.json"\)/);
  assert.match(html, /fetchJsonRequired\("\.\/data\/squads\.json"\)/);
  assert.match(html, /fetchJsonRequired\("\.\/data\/prediction-sources\.json"\)/);
  assert.match(html, /fetchJsonOptional\("\.\/data\/external-predictions\.json", \{ predictions: \[\] \}\)/);
});

test("external predictions are structured and match site fixtures", () => {
  const matches = JSON.parse(fs.readFileSync("data/matches.json", "utf8")).matches || [];
  const matchIds = new Set(matches.map((match) => match.id));
  const sourceIds = new Set(sources.sources.map((source) => source.id));
  assert.match(externalPredictions.note, /结构化数据/);
  assert.match(externalPredictions.note, /市场信号/);
  assert.ok(externalPredictions.predictions.length >= 6);

  for (const prediction of externalPredictions.predictions) {
    assert.ok(matchIds.has(prediction.matchId), `unknown matchId: ${prediction.matchId}`);
    assert.ok(sourceIds.has(prediction.sourceId), `unknown sourceId: ${prediction.sourceId}`);
    assert.ok(prediction.sourceName);
    assert.ok(prediction.pick);
    assert.ok(prediction.summary);
    assert.match(prediction.url, /^https:\/\//);
  }
});

test("external predictions cover the next two match days", () => {
  const matches = JSON.parse(fs.readFileSync("data/matches.json", "utf8")).matches || [];
  const coveredDays = ["2026-06-27", "2026-06-28"];
  const covered = new Set(externalPredictions.predictions.map((prediction) => prediction.matchId));

  for (const day of coveredDays) {
    const dayMatches = matches.filter((match) => String(match.kickoff).startsWith(day));
    assert.equal(dayMatches.length, 6, `${day} 比赛数应为 6`);
    for (const match of dayMatches) {
      assert.ok(covered.has(match.id), `${day} ${match.home} 对 ${match.away} 缺少外部观点`);
    }
  }
});

test("main site exposes the prediction hub", () => {
  const index = fs.readFileSync("index.html", "utf8");
  assert.match(index, /href="\.\/predictions\.html"[^>]*>预测集合/);
  assert.match(index, /data-i18n="nav\.predictions"/);
  assert.match(index, /data-i18n="footer\.predictions"/);
});
