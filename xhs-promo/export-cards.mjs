import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const inputUrl = `file://${path.join(here, "index.html")}`;
const outDir = path.join(here, "export");

await mkdir(outDir, { recursive: true });

const js = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(800);
    const cards = Array.from(document.querySelectorAll('.xhs-card'));
    for (let i = 0; i < cards.length; i += 1) {
      cards[i].scrollIntoView();
      await sleep(250);
    }
  })();
`;

console.log(`Open manually if needed: ${inputUrl}`);
console.log(`Export directory: ${outDir}`);
console.log("Tip: the in-page button exports card PNGs through your browser downloads.");

try {
  await execFileAsync(chrome, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1180,1600",
    `--screenshot=${path.join(outDir, "preview-page.png")}`,
    inputUrl
  ], { timeout: 20000 });
  console.log("Generated preview-page.png");
} catch (error) {
  console.error("Chrome preview export failed:", error.message);
  process.exitCode = 1;
}
