import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outDir = path.join(here, "export");
const cards = ["01-cover", "02-mechanics", "03-data-view", "04-open-source"];

await mkdir(outDir, { recursive: true });

for (const card of cards) {
  const url = `file://${path.join(here, "index.html")}?card=${encodeURIComponent(card)}`;
  const output = path.join(outDir, `${card}.png`);
  await execFileAsync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--window-size=1600,900",
    `--screenshot=${output}`,
    url
  ], { timeout: 20000 });
  console.log(`Generated ${output}`);
}

console.log(`Open preview: file://${path.join(here, "index.html")}`);
