import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 主页是手写的 index.html（早期 __bundler/template 打包结构已移除），
// 这里直接对页面文本断言：核心外壳 + 轻量 Agent 竞赛模块仍在。

test("front-end base page carries the core shell", () => {
  const index = fs.readFileSync("index.html", "utf8");
  assert.match(index, /世界杯盘口研究所/);
  assert.match(index, /theme-toggle/);
  assert.match(index, /pixel-stage/);
});

test("page includes the lightweight Agent competition module", () => {
  const index = fs.readFileSync("index.html", "utf8");
  assert.match(index, /id="agent-arena"/);
  assert.match(index, /Agent 竞赛/);
  assert.match(index, /id="agent-skill-url"/);
});
