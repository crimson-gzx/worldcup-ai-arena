import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("hit vote verdict renders the OpenDesign ticket shell", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const css = fs.readFileSync("styles.css", "utf8");
  const preview = fs.readFileSync("hit-animation-preview.html", "utf8");

  assert.match(app, /vote-feedback is-hit verdict-ticket/);
  assert.match(app, /ticketStatHtml\(t\("人类超越"\)/);
  assert.match(app, /ticketStatHtml\(t\("AI超越"\)/);
  assert.match(app, /data-vote-counter/);
  assert.match(css, /\.vote-feedback\.is-hit\.verdict-ticket/);
  assert.match(css, /\.seal-wrapper/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(preview, /vote-feedback is-hit verdict-ticket/);
  assert.match(preview, /20260621-verdict-ticket/);
});

test("hit vote verdict defaults to a compact report row", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const css = fs.readFileSync("styles.css", "utf8");
  const i18n = fs.readFileSync("i18n.js", "utf8");
  const html = fs.readFileSync("index.html", "utf8");

  assert.match(app, /openVerdicts: new Set/);
  assert.match(app, /verdict-summary/);
  assert.match(app, /data-verdict-match/);
  assert.match(css, /\.vote-feedback\.is-hit\.verdict-summary/);
  assert.match(css, /\.verdict-toggle/);
  assert.match(css, /max-height: min\(280px, 48vh\)/);
  assert.match(i18n, /"展开战报": "Open report"/);
  assert.match(html, /20260629-ko-lottery/);
});
