#!/usr/bin/env node
/**
 * covers-cache.json に入っている ISBN から、楽天ブックスの**商品ページURL**を引いて
 * `rakutenItemUrl` として同じキャッシュに書き戻す。購入リンクを検索ページではなく
 * 商品ページへ直リンクするために使う。
 *
 *   RAKUTEN_APP_ID=xxx RAKUTEN_ACCESS_KEY=yyy node scripts/fetch-rakuten-links.mjs [--force] [--only=id1,id2]
 *
 * **APIが返す `affiliateUrl` は使わない。** リクエストに `affiliateId` を付けても無視され、
 * アプリケーションに紐づく別のアフィリエイトID(g00q072n.…)で組み立てられたURLが返ってくることを
 * 実測で確認したため(2026-08-08)。**このIDはサイト運営者本人のものではない**ことを確認済みなので、
 * 使うとアフィリエイト収益がまるごと別アカウントに入ってしまう。
 * ここでは素の `itemUrl` だけを保存し、アフィリエイトIDでの包装はフロント側
 * (src/ui/common/WorkCover.tsx の rakutenBooksUrl)で行う。
 *
 * **ISBN検索のパラメータは `isbn`**。`isbnjan` は BooksBook/Search では無視され、
 * 全く関係ない新着商品が返る(これも実測で確認)。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_PATH = path.join(ROOT, "public/data/source/covers-cache.json");
const API = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404";
const REFERER_URL = "https://izenmi.github.io/manga-db/";
const ORIGIN_URL = "https://izenmi.github.io";
const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;

const force = process.argv.includes("--force");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : undefined;

if (!APP_ID || !ACCESS_KEY) {
  console.error("RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が必要です。");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRakuten(url) {
  for (let attempt = 0; ; attempt++) {
    // node の fetch は既定でタイムアウトしないため、接続がハングするとジョブごと止まる
    // (1000件超のバッチで実際に踏んだ)。必ず AbortSignal で打ち切ること。
    let res;
    try {
      res = await fetch(url, {
        headers: { Referer: REFERER_URL, Origin: ORIGIN_URL },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      if (attempt >= 2) return undefined;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status !== 429 || attempt >= 4) return res;
    await sleep(10000 * (attempt + 1));
  }
}

async function itemUrlForIsbn(isbn) {
  const params = new URLSearchParams({
    applicationId: APP_ID,
    accessKey: ACCESS_KEY,
    format: "json",
    isbn,
    hits: "1",
  });
  const res = await fetchRakuten(`${API}?${params.toString()}`);
  if (!res || !res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  const item = data?.Items?.[0]?.Item;
  return item?.itemUrl || undefined;
}

const cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
const targets = Object.entries(cache).filter(
  ([id, v]) => (!only || only.has(id)) && v?.isbn && (force || !v.rakutenItemUrl),
);
console.log(`対象 ${targets.length}件 (ISBN保持 ${Object.values(cache).filter((v) => v?.isbn).length}件)`);

let ok = 0;
let miss = 0;
for (const [id, v] of targets) {
  const url = await itemUrlForIsbn(String(v.isbn));
  if (url) {
    v.rakutenItemUrl = url;
    ok++;
  } else {
    miss++;
  }
  if ((ok + miss) % 50 === 0) {
    console.log(`  ${ok + miss}/${targets.length} (ok=${ok} miss=${miss})`);
    writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  }
  // 楽天APIは1日の呼び出しが嵩むと429を返し始める。RL_SLEEP で間隔を緩められるようにしてある
  // (既定400ms、429が出るようなら1500〜3000msにする)。
  await sleep(Number(process.env.RL_SLEEP ?? 400));
}
writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
console.log(`完了: ${ok}件に商品ページURLを保存、${miss}件は該当なし。`);
