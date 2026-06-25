import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync("predictions.html", "utf8");
const sources = JSON.parse(fs.readFileSync("data/prediction-sources.json", "utf8"));
const externalPredictions = JSON.parse(fs.readFileSync("data/external-predictions.json", "utf8"));

test("prediction page is a standalone Chinese information view", () => {
  assert.match(html, /<title>中文足球预测信息集合<\/title>/);
  assert.match(html, /比赛信号表/);
  assert.match(html, /今日先看/);
  assert.match(html, /来源接入状态/);
  assert.match(html, /外部源：已抓入单场观点/);
  assert.match(html, /external-predictions\.json/);
  assert.match(html, /外部观点/);
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
  assert.ok(sources.sources.filter((source) => source.integration === "待抓取").length >= 5);

  const ids = new Set();
  for (const source of sources.sources) {
    assert.ok(source.id);
    assert.ok(!ids.has(source.id), `duplicate id: ${source.id}`);
    ids.add(source.id);
    assert.ok(source.name);
    assert.ok(source.summary);
    assert.ok(["已接入", "已抓取", "可打开", "可浏览", "需浏览器核对"].includes(source.status));
    assert.ok(["已接入", "已抓取", "待抓取"].includes(source.integration));

    if (source.kind === "free-site" || source.kind === "media" || source.kind === "market" || source.kind === "value") {
      assert.match(source.url, /^https:\/\//, `${source.name} should use a full public URL`);
    }
  }
});

test("prediction page keeps copy compact", () => {
  assert.doesNotMatch(html, /首先|其次|最后|总的来说|综上所述/);
  assert.doesNotMatch(html, /\s+vs\s+/i);
  assert.match(html, /暂无抓取观点/);
});

test("external predictions are structured and match site fixtures", () => {
  const matches = JSON.parse(fs.readFileSync("data/matches.json", "utf8")).matches || [];
  const matchIds = new Set(matches.map((match) => match.id));
  const sourceIds = new Set(sources.sources.map((source) => source.id));
  assert.match(externalPredictions.note, /结构化数据/);
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

test("external predictions cover the current default day", () => {
  const matches = JSON.parse(fs.readFileSync("data/matches.json", "utf8")).matches || [];
  const currentDay = matches.filter((match) => String(match.kickoff).startsWith("2026-06-25"));
  const covered = new Set(externalPredictions.predictions.map((prediction) => prediction.matchId));

  assert.equal(currentDay.length, 6);
  for (const match of currentDay) {
    assert.ok(covered.has(match.id), `${match.home} 对 ${match.away} 缺少外部观点`);
  }
});

test("main site exposes the prediction hub", () => {
  const index = fs.readFileSync("index.html", "utf8");
  assert.match(index, /href="\.\/predictions\.html"[^>]*>预测集合/);
  assert.match(index, /data-i18n="nav\.predictions"/);
  assert.match(index, /data-i18n="footer\.predictions"/);
});
