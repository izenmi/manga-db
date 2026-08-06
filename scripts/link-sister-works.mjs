// Links comicalizations in this repo to the original novels in the sister sites (ranobe-db /
// mystery-db) and writes the cross-links into all three repos' public/data/source/works.json:
//
//   manga-db     works[].relatedNovelUrl  -> https://izenmi.github.io/{ranobe,mystery}-db/works/<id>
//   ranobe-db    works[].relatedComicUrl  -> https://izenmi.github.io/manga-db/works/<id>
//   mystery-db   works[].relatedComicUrl  -> https://izenmi.github.io/manga-db/works/<id>
//
// This lives in manga-db because manga-db is the hub: it is the only repo that links to both
// novel sites. It is a MANUAL maintenance script (like fetch-covers.mjs) — the sister repos are
// separate git repositories, so CI can't see them. Run it locally after adding works to any of
// the three sites, then commit the touched works.json in each repo.
//
// Matching rule — deliberately strict, because a wrong cross-link sends readers to a different
// story on another site:
//
//   1. Normalized "core title" must be equal on both sides. The core title drops any subtitle
//      after 〜 or （, then strips punctuation/brackets and NFKC-normalizes (same idea as
//      fetch-covers.mjs's normalize()/coreTitle()).
//   2. At least one 原作者 of the comic must equal an author of the novel.
//
// Rule 2 is what makes this safe: 『殺戮の天使』 exists on both sites with the same title but a
// different original author (the novel is a game novelization by 木爾チレン, the comic's original
// is 真田まこと), i.e. they are genuinely unrelated works. Title-only matching would link them.
//
// Usage:
//   node scripts/link-sister-works.mjs            # writes the three works.json files
//   node scripts/link-sister-works.mjs --dry-run  # report only, touch nothing
//
// Sibling repo locations default to ../ranobe-db and ../mystery-db and can be overridden with
// RANOBE_DB_PATH / MYSTERY_DB_PATH.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRY_RUN = process.argv.includes("--dry-run");

const SITES = {
  manga: { dir: rootDir, base: "https://izenmi.github.io/manga-db" },
  ranobe: {
    dir: process.env.RANOBE_DB_PATH ?? path.join(path.dirname(rootDir), "ranobe-db"),
    base: "https://izenmi.github.io/ranobe-db",
    label: "らのべDB",
  },
  mystery: {
    dir: process.env.MYSTERY_DB_PATH ?? path.join(path.dirname(rootDir), "mystery-db"),
    base: "https://izenmi.github.io/mystery-db",
    label: "ミステリDB",
  },
};

function sourcePath(dir, name) {
  return path.join(dir, "public", "data", "source", `${name}.json`);
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

function writeJson(p, value) {
  writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function normalize(title) {
  return title
    .normalize("NFKC")
    .replace(/[「」『』【】〈〉（）()[\]]/g, "")
    .replace(/[〜~～\-–—・:：!！?？。、,，.\s]/g, "")
    .toLowerCase();
}

/** Drops a trailing subtitle before normalizing, so 「本好きの下剋上〜司書になるためには〜」 and
 *  「本好きの下剋上」 collapse to the same key. */
function coreTitle(title) {
  return normalize(title.split(/[〜~～（(]/)[0]);
}

const comics = readJson(sourcePath(SITES.manga.dir, "works"));
const originalAuthorsById = new Map(
  readJson(sourcePath(SITES.manga.dir, "original-authors")).map((a) => [a.id, a.name]),
);

const comicsByCoreTitle = new Map();
for (const comic of comics) {
  const key = coreTitle(comic.title);
  const bucket = comicsByCoreTitle.get(key);
  if (bucket) bucket.push(comic);
  else comicsByCoreTitle.set(key, [comic]);
}

let matches = [];
const rejected = [];

for (const siteKey of ["ranobe", "mystery"]) {
  const site = SITES[siteKey];
  if (!existsSync(sourcePath(site.dir, "works"))) {
    console.warn(`link-sister-works: ${siteKey} repo not found at ${site.dir} — skipped`);
    continue;
  }
  const novels = readJson(sourcePath(site.dir, "works"));
  const authorsById = new Map(readJson(sourcePath(site.dir, "authors")).map((a) => [a.id, a.name]));

  for (const novel of novels) {
    for (const comic of comicsByCoreTitle.get(coreTitle(novel.title)) ?? []) {
      const novelAuthors = new Set(novel.authorIds.map((id) => authorsById.get(id)));
      const comicOriginals = (comic.originalAuthorIds ?? []).map((id) => originalAuthorsById.get(id));
      if (comicOriginals.some((name) => novelAuthors.has(name))) {
        matches.push({ siteKey, novelId: novel.id, comicId: comic.id, title: novel.title });
      } else {
        rejected.push({
          siteKey,
          title: novel.title,
          novelAuthors: [...novelAuthors],
          comicOriginals,
        });
      }
    }
  }
}

// Some novels are legitimately registered on BOTH sister sites — 虚構推理 (城平京, 講談社タイガ) is
// both a light novel and a 本格ミステリ. relatedNovelUrl is singular, so those need a human call on
// which site is the better home for the original. Anything not listed here fails the run.
const PREFERRED_SITE_BY_COMIC_ID = {
  // 講談社タイガのミステリ作品で、シリーズは本格ミステリ寄り。ミステリDB側を原作の置き場所とする。
  "kyokou-suiri": "mystery",
};

const bySameKey = (key) => {
  const groups = new Map();
  for (const m of matches) {
    const bucket = groups.get(m[key]);
    if (bucket) bucket.push(m);
    else groups.set(m[key], [m]);
  }
  return groups;
};

const conflictErrors = [];
const dropped = new Set();

for (const [comicId, group] of bySameKey("comicId")) {
  if (group.length === 1) continue;
  const preferred = PREFERRED_SITE_BY_COMIC_ID[comicId];
  const winner = group.find((m) => m.siteKey === preferred);
  if (!winner) {
    conflictErrors.push(
      `comic "${comicId}" (${group[0].title}) matches novels on ${group.map((m) => m.siteKey).join(" and ")} — ` +
        `add it to PREFERRED_SITE_BY_COMIC_ID`,
    );
    continue;
  }
  for (const m of group) if (m !== winner) dropped.add(m);
}

// Two different novels matching one comic on the SAME site means the title+author rule is genuinely
// ambiguous — there is no sensible way to choose, so fail instead of guessing.
for (const [novelId, group] of bySameKey("novelId")) {
  if (group.length > 1) {
    conflictErrors.push(`novel "${novelId}" matches ${group.length} comics: ${group.map((m) => m.comicId).join(", ")}`);
  }
}

if (conflictErrors.length > 0) {
  console.error("link-sister-works: ambiguous matches, refusing to write:");
  for (const e of conflictErrors) console.error(`  - ${e}`);
  process.exit(1);
}

for (const m of dropped) {
  console.log(`link-sister-works: ${m.title} — ${m.siteKey} 側は優先指定により不採用`);
}
matches = matches.filter((m) => !dropped.has(m));

console.log(`link-sister-works: ${matches.length} matches`);
for (const m of matches) console.log(`  ${m.siteKey.padEnd(7)} ${m.title}`);
if (rejected.length > 0) {
  console.log(`link-sister-works: ${rejected.length} same-title pairs rejected (原作者が一致しない):`);
  for (const r of rejected) {
    console.log(`  ${r.title} — novel: ${r.novelAuthors.join("・")} / comic原作: ${r.comicOriginals.join("・")}`);
  }
}

if (DRY_RUN) {
  console.log("link-sister-works: --dry-run, nothing written");
  process.exit(0);
}

// Rewrite all three works.json files. Links are recomputed from scratch every run, so a work that
// stops matching (renamed title, corrected author) correctly loses its stale cross-link.
const novelUrlByComicId = new Map(
  matches.map((m) => [m.comicId, `${SITES[m.siteKey].base}/works/${m.novelId}`]),
);
const comicUrlByNovelId = new Map(
  matches.map((m) => [`${m.siteKey}:${m.novelId}`, `${SITES.manga.base}/works/${m.comicId}`]),
);

let changed = 0;
for (const comic of comics) {
  const url = novelUrlByComicId.get(comic.id);
  if (comic.relatedNovelUrl !== url) changed++;
  if (url) comic.relatedNovelUrl = url;
  else delete comic.relatedNovelUrl;
}
writeJson(sourcePath(SITES.manga.dir, "works"), comics);

for (const siteKey of ["ranobe", "mystery"]) {
  const site = SITES[siteKey];
  const worksFile = sourcePath(site.dir, "works");
  if (!existsSync(worksFile)) continue;
  const novels = readJson(worksFile);
  for (const novel of novels) {
    const url = comicUrlByNovelId.get(`${siteKey}:${novel.id}`);
    if (novel.relatedComicUrl !== url) changed++;
    if (url) novel.relatedComicUrl = url;
    else delete novel.relatedComicUrl;
  }
  writeJson(worksFile, novels);
}

console.log(`link-sister-works: wrote 3 works.json (${changed} fields changed)`);
