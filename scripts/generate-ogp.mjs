// One-off asset generator: renders a branded 1200x630 OGP/Twitter-card banner (public/og-image.png)
// used as the default social-share image for pages without a specific work cover. Not part of
// the build pipeline — re-run manually (`node scripts/generate-ogp.mjs`) if the design or the
// headline counts should be refreshed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const counts = JSON.parse(readFileSync(path.join(rootDir, "public", "data", "generated", "counts.json"), "utf-8"));

const BADGES = [
  { label: "作品", value: counts.works, color: "#8bc4ea" },
  { label: "原作者", value: counts.originalAuthors, color: "#f68fbe" },
  { label: "作画家", value: counts.artists, color: "#8adcae" },
  { label: "テーマ", value: counts.themes, color: "#cba7f2" },
];

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700;800&family=M+PLUS+Rounded+1c:wght@800&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; background: #000; overflow: hidden; }
  body {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 88px;
    font-family: "Noto Sans JP", sans-serif;
  }
  .glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(90px);
    opacity: 0.55;
  }
  .glow--1 { width: 520px; height: 520px; top: -180px; right: -140px; background: #7cd0ff; }
  .glow--2 { width: 460px; height: 460px; bottom: -200px; left: -120px; background: #cba7f2; }
  .badge {
    position: relative;
    width: 108px;
    height: 108px;
    border-radius: 28px;
    background: #000;
    border: 3px solid #3a3742;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: "M PLUS Rounded 1c", sans-serif;
    font-weight: 800;
    font-size: 68px;
    color: #7cd0ff;
    margin-bottom: 28px;
  }
  h1 {
    position: relative;
    font-family: "M PLUS Rounded 1c", sans-serif;
    font-weight: 800;
    font-size: 96px;
    color: #f2f2f5;
    line-height: 1;
  }
  p.tagline {
    position: relative;
    margin-top: 20px;
    font-size: 34px;
    font-weight: 500;
    color: #a8a3b5;
  }
  .stats {
    position: relative;
    display: flex;
    gap: 20px;
    margin-top: 44px;
  }
  .stat {
    display: flex;
    align-items: baseline;
    gap: 10px;
    background: #141416;
    border: 2px solid #3a3742;
    border-radius: 999px;
    padding: 14px 28px;
    font-weight: 700;
  }
  .stat .num { font-size: 34px; }
  .stat .label { font-size: 22px; color: #a8a3b5; font-weight: 500; }
</style>
</head>
<body>
  <div class="glow glow--1"></div>
  <div class="glow glow--2"></div>
  <div class="badge">ま</div>
  <h1>まんがDB</h1>
  <p class="tagline">日本語コミックを原作者・作画家・受賞歴・テーマから探せるデータベース</p>
  <div class="stats">
    ${BADGES.map(
      (b) => `<div class="stat"><span class="num" style="color:${b.color}">${b.value}</span><span class="label">${b.label}</span></div>`
    ).join("\n    ")}
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(rootDir, "public", "og-image.png") });
await browser.close();

console.log("generate-ogp: wrote public/og-image.png");
