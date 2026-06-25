import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const visibleCopyFiles = ["index.html", "predictions.html"];

function unpackVisibleHtml(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
  return match ? JSON.parse(match[1]) : raw;
}

test("keeps visible page copy in Chinese", () => {
  const combined = visibleCopyFiles
    .map((file) =>
      unpackVisibleHtml(file)
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    )
    .join("\n");
  const forbiddenVisibleSnippets = [
    "World Cup Market Lab",
    "Market Radar",
    "Match Breakdown",
    "Model Notes",
    "Edge Board",
    "Glossary",
    ">vs<",
    " vs ",
    "模型 xG",
    "API key",
    "API",
    "SEO",
    "pp</span>"
  ];

  for (const snippet of forbiddenVisibleSnippets) {
    assert.equal(combined.includes(snippet), false, `visible English copy remains: ${snippet}`);
  }
});
