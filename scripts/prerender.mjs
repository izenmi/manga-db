// Post-build step (npm "postbuild", runs after `vite build`): crawls every route of the built
// SPA with headless Chromium and writes what it rendered as a static dist/<route>/index.html,
// so GitHub Pages serves real crawlable HTML (correct <title>/meta/OGP/JSON-LD baked in) for
// every work/original-author/artist/publisher/theme/award page instead of one empty shell for
// the whole site. The captured HTML still contains the original <script type="module"> tag, so a
// real visitor's browser re-renders via React exactly as before — this only changes what a
// crawler (or a raw `curl`) sees on first response, not the live app's behavior.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, "dist");
const dataDir = path.join(rootDir, "public", "data", "generated");

// Must match vite.config.ts `base`.
const BASE = "/manga-db";
// --strictPort means a leftover preview server from another project squatting on this port makes
// the build fail outright, so allow overriding it (PRERENDER_PORT=4322 npm run build).
const PORT = Number(process.env.PRERENDER_PORT) || 4319;
const CONCURRENCY = Number(process.env.PRERENDER_CONCURRENCY) || 6;

function readData(name) {
  return JSON.parse(readFileSync(path.join(dataDir, `${name}.json`), "utf-8"));
}

const works = readData("works");
const originalAuthors = readData("original-authors");
const artists = readData("artists");
const labels = readData("labels");
const themes = readData("themes");
const awards = readData("awards");

const routes = [
  "/",
  "/works",
  ...works.map((w) => `/works/${w.id}`),
  "/recommend",
  "/themes",
  ...themes.map((t) => `/themes/${t.id}`),
  "/original-authors",
  ...originalAuthors.map((a) => `/original-authors/${a.id}`),
  "/artists",
  ...artists.map((a) => `/artists/${a.id}`),
  "/labels",
  ...labels.map((l) => `/labels/${l.id}`),
  "/awards",
  ...awards.map((a) => `/awards/${a.id}`),
  "/about",
];

function outPathFor(route) {
  if (route === "/") return path.join(distDir, "index.html");
  return path.join(distDir, route.replace(/^\//, ""), "index.html");
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite preview didn't come up within ${timeoutMs}ms`);
}

async function renderRoute(page, route) {
  const url = `http://localhost:${PORT}${BASE}${route === "/" ? "/" : route}`;
  await page.goto(url, { waitUntil: "load", timeout: 20000 });
  await page
    .waitForFunction(() => !document.body.innerText.includes("読み込み中"), { timeout: 15000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const html = await page.content();
  const outPath = outPathFor(route);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf-8");
}

async function main() {
  if (!existsSync(distDir)) {
    console.error("prerender: dist/ not found — run `vite build` first");
    process.exit(1);
  }

  console.log(`prerender: starting vite preview on port ${PORT}`);
  const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  preview.on("error", (err) => {
    console.error("prerender: failed to start vite preview:", err);
    process.exit(1);
  });

  try {
    await waitForServer(`http://localhost:${PORT}${BASE}/`);

    console.log(`prerender: crawling ${routes.length} routes with concurrency ${CONCURRENCY}`);
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const pages = await Promise.all(Array.from({ length: CONCURRENCY }, () => context.newPage()));

    const failed = [];
    let done = 0;
    const startedAt = Date.now();
    let cursor = 0;

    async function worker(page) {
      while (cursor < routes.length) {
        const route = routes[cursor++];
        try {
          await renderRoute(page, route);
        } catch (err) {
          failed.push({ route, error: String(err?.message ?? err) });
        }
        done++;
        if (done % 100 === 0 || done === routes.length) {
          const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(0);
          console.log(`prerender: ${done}/${routes.length} done (${elapsedS}s elapsed)`);
        }
      }
    }

    await Promise.all(pages.map(worker));
    await browser.close();

    // GitHub Pages custom 404: served (with a real HTTP 404 status) for any path with no
    // matching static file. Using the prerendered home shell means a route we somehow failed to
    // prerender still renders correctly once client JS takes over and React Router reads the
    // real (still-correct) URL — see the failed-routes warning below for what to go re-run.
    copyFileSync(path.join(distDir, "index.html"), path.join(distDir, "404.html"));

    const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(0);
    if (failed.length > 0) {
      console.warn(`prerender: ${failed.length}/${routes.length} routes FAILED (${elapsedS}s total):`);
      for (const f of failed.slice(0, 20)) console.warn(`  - ${f.route}: ${f.error}`);
      if (failed.length > 20) console.warn(`  ... and ${failed.length - 20} more`);
    } else {
      console.log(`prerender: all ${routes.length} routes rendered successfully (${elapsedS}s total)`);
    }
  } finally {
    preview.kill();
  }
}

main();
