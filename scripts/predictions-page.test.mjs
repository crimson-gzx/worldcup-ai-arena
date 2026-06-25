import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync("predictions.html", "utf8");
const sources = JSON.parse(fs.readFileSync("data/prediction-sources.json", "utf8"));

test("prediction page is a standalone Chinese information view", () => {
  assert.match(html, /<title>中文足球预测信息集合<\/title>/);
  assert.match(html, /比赛信号表/);
  assert.match(html, /今日先看/);
  assert.match(html, /预测者清单/);
  assert.match(html, /data\/matches\.json/);
  assert.match(html, /data\/squads\.json/);
  assert.match(html, /data\/prediction-sources\.json/);
});

test("prediction sources use real links and clear status", () => {
  assert.match(sources.note, /不生成假预测/);
  assert.ok(Array.isArray(sources.sources));
  assert.ok(sources.sources.length >= 8);

  const ids = new Set();
  for (const source of sources.sources) {
    assert.ok(source.id);
    assert.ok(!ids.has(source.id), `duplicate id: ${source.id}`);
    ids.add(source.id);
    assert.ok(source.name);
    assert.ok(source.summary);
    assert.ok(["已接入", "可打开", "可浏览", "需浏览器核对"].includes(source.status));

    if (source.kind === "free-site" || source.kind === "media" || source.kind === "market" || source.kind === "value") {
      assert.match(source.url, /^https:\/\//, `${source.name} should use a full public URL`);
    }
  }
});

test("prediction page keeps copy compact", () => {
  assert.doesNotMatch(html, /首先|其次|最后|总的来说|综上所述/);
  assert.doesNotMatch(html, /\s+vs\s+/i);
  assert.match(html, /单场结果需人工核对/);
});

test("main site exposes the prediction hub", () => {
  const index = fs.readFileSync("index.html", "utf8");
  assert.match(index, /href="\.\/predictions\.html"[^>]*>预测集合/);
  assert.match(index, /data-i18n="nav\.predictions"/);
  assert.match(index, /data-i18n="footer\.predictions"/);
});
