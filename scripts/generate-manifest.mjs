// Reads public/data/source/*.json (hand-authored) and writes public/data/generated/*.json:
// denormalized, name-resolved data ready for direct rendering, plus reference-integrity
// checks so a typo'd id fails the build instead of silently rendering blank names.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(rootDir, "public", "data", "source");
const outDir = path.join(rootDir, "public", "data", "generated");

function readSource(name) {
  return JSON.parse(readFileSync(path.join(sourceDir, `${name}.json`), "utf-8"));
}

const works = readSource("works");
const originalAuthors = readSource("original-authors");
const artists = readSource("artists");
const publishers = readSource("publishers");
const labels = readSource("labels");
const themes = readSource("themes");
const awards = readSource("awards");

// Optional: built by `npm run fetch-covers` (scripts/fetch-covers.mjs), which resolves an ISBN
// per work via Rakuten Books (or Kobo as a fallback) and commits the result here so builds stay
// offline/deterministic. Absent entries just mean "no cover resolved yet".
const coversCachePath = path.join(sourceDir, "covers-cache.json");
const coversCache = existsSync(coversCachePath) ? JSON.parse(readFileSync(coversCachePath, "utf-8")) : {};

const originalAuthorsById = new Map(originalAuthors.map((a) => [a.id, a]));
const artistsById = new Map(artists.map((a) => [a.id, a]));
const publishersById = new Map(publishers.map((p) => [p.id, p]));
const labelsById = new Map(labels.map((l) => [l.id, l]));
const themesById = new Map(themes.map((t) => [t.id, t]));
const awardsById = new Map(awards.map((a) => [a.id, a]));

const errors = [];

function checkRef(map, id, kind, workId) {
  if (!map.has(id)) errors.push(`work "${workId}": unknown ${kind} id "${id}"`);
}

for (const w of works) {
  if (w.artistIds.length === 0) errors.push(`work "${w.id}": artistIds must have at least one entry`);
  w.originalAuthorIds.forEach((id) => checkRef(originalAuthorsById, id, "originalAuthor", w.id));
  w.artistIds.forEach((id) => checkRef(artistsById, id, "artist", w.id));
  checkRef(publishersById, w.publisherId, "publisher", w.id);
  checkRef(labelsById, w.labelId, "label", w.id);
  w.themeIds.forEach((id) => checkRef(themesById, id, "theme", w.id));
  (w.awardResults ?? []).forEach((r) => checkRef(awardsById, r.awardId, "award", w.id));
}

const workIds = new Set();
for (const w of works) {
  if (workIds.has(w.id)) errors.push(`duplicate work id "${w.id}"`);
  workIds.add(w.id);
}
for (const l of labels) {
  checkRef(publishersById, l.publisherId, "publisher", `label:${l.id}`);
}

for (const [label, list] of [
  ["originalAuthor", originalAuthors],
  ["artist", artists],
  ["publisher", publishers],
  ["label", labels],
  ["theme", themes],
  ["award", awards],
]) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) errors.push(`duplicate ${label} id "${item.id}"`);
    seen.add(item.id);
  }
}

if (errors.length > 0) {
  console.error("generate-manifest: reference integrity errors:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ---- related works ("この作品が好きなら") ----
// Cosine similarity over IDF-weighted theme tags, plus a bonus for sharing an artist or original author.
// IDF matters because the tag vocabulary is deliberately small and reused (see CLAUDE.md
// 「テーマタグの方針」): a tag carried by hundreds of works says almost nothing about similarity,
// while a rare one is highly informative. Weighting every shared tag equally would just
// surface the most generic works on every page.
const RELATED_COUNT = 6;
const SAME_ARTIST_BONUS = 0.15;
const SAME_ORIGINAL_AUTHOR_BONUS = 0.1;

const worksById = new Map(works.map((x) => [x.id, x]));

const tagsOf = (x) => x.themeIds;

const tagDocFreq = new Map();
for (const x of works) {
  for (const t of tagsOf(x)) tagDocFreq.set(t, (tagDocFreq.get(t) ?? 0) + 1);
}
// A tag carried by every work gets idf 0 and drops out of the scoring entirely.
const tagIdf = new Map([...tagDocFreq].map(([t, df]) => [t, Math.log(works.length / df)]));

const tagNorm = new Map(
  works.map((x) => {
    let sumSquares = 0;
    for (const t of tagsOf(x)) sumSquares += tagIdf.get(t) ** 2;
    return [x.id, Math.sqrt(sumSquares)];
  }),
);

const tagToItems = new Map();
for (const x of works) {
  for (const t of tagsOf(x)) {
    if (!tagToItems.has(t)) tagToItems.set(t, []);
    tagToItems.get(t).push(x);
  }
}

function relatedIdsFor(item) {
  // Accumulate the dot product only over works that share at least one tag, rather than
  // scanning all N works for each of N works.
  const dotProducts = new Map();
  for (const t of tagsOf(item)) {
    const weight = tagIdf.get(t) ** 2;
    if (weight === 0) continue;
    for (const other of tagToItems.get(t)) {
      if (other.id === item.id) continue;
      dotProducts.set(other.id, (dotProducts.get(other.id) ?? 0) + weight);
    }
  }

  const ownArtists = new Set(item.artistIds);
  const ownOriginalAuthors = new Set(item.originalAuthorIds);

  // Same-artist works are a strong recommendation even with no tag overlap, so seed them in.
  for (const other of works) {
    if (other.id === item.id || dotProducts.has(other.id)) continue;
    if (other.artistIds.some((id) => ownArtists.has(id))) dotProducts.set(other.id, 0);
  }

  const ownNorm = tagNorm.get(item.id);
  const scored = [];
  for (const [otherId, dot] of dotProducts) {
    const other = worksById.get(otherId);
    const otherNorm = tagNorm.get(otherId);
    let score = ownNorm > 0 && otherNorm > 0 ? dot / (ownNorm * otherNorm) : 0;
    if (other.artistIds.some((id) => ownArtists.has(id))) score += SAME_ARTIST_BONUS;
    if (other.originalAuthorIds.some((id) => ownOriginalAuthors.has(id)))
      score += SAME_ORIGINAL_AUTHOR_BONUS;
    if (score > 0) scored.push({ id: otherId, score });
  }

  // Tie-break by id so the output (and therefore the prerendered HTML) is stable across builds.
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, RELATED_COUNT).map((s) => s.id);
}

const relatedById = new Map(works.map((x) => [x.id, relatedIdsFor(x)]));

// ---- generated/works.json ----
// あらすじ・出典メモ・updatedAt はここに入れない(作品詳細ページでしか使わないのに
// works.json の3分の1を占める)。詳細ページ用は work-texts.json に分ける。
const worksGenerated = works.map(({ synopsis, sourceNote, updatedAt, ...w }) => ({
  relatedWorkIds: relatedById.get(w.id),
  ...w,
  originalAuthorNames: w.originalAuthorIds.map((id) => originalAuthorsById.get(id).name),
  artistNames: w.artistIds.map((id) => artistsById.get(id).name),
  publisherName: publishersById.get(w.publisherId).name,
  labelName: labelsById.get(w.labelId).name,
  themeNames: w.themeIds.map((id) => themesById.get(id).name),
  awardSummaries: (w.awardResults ?? []).map((r) => ({
    awardId: r.awardId,
    awardName: awardsById.get(r.awardId).name,
    year: r.year,
    result: r.result,
  })),
  coverUrl: coversCache[w.id]?.coverUrl ?? undefined,
  // 購入リンクを商品ページへ直リンクするために使う(covers-cache が解決したISBN)
  isbn: coversCache[w.id]?.isbn ?? undefined,
  // 楽天ブックスの商品ページURL(購入リンクの直リンク用)
  rakutenItemUrl: coversCache[w.id]?.rakutenItemUrl ?? undefined,
}));

// 相互参照リスト(原作者・作画家・レーベル・出版社・テーマの各詳細ページ)は作品を**idの配列**で
// 持ち、表示側は works.json(取得済みキャッシュ)から引き直して WorkCard を描く。
// 作品をフル展開して埋め込むと1作品が平均8つのリストに重複して入り、themes.json だけで
// gzip 5.2MB あった(2026-08-12に是正)。
const idsByPublicationYear = (list) =>
  [...list].sort((a, b) => a.firstPublishedYear - b.firstPublishedYear).map((w) => w.id);

// ---- generated/{original-authors,artists,publishers}.json ----
function buildPersonList(people, worksByPersonId) {
  return people
    .map((p) => {
      const theirWorks = worksByPersonId.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.name,
        nameKana: p.nameKana,
        description: p.description,
        externalLinks: p.externalLinks,
        workCount: theirWorks.length,
        workIds: idsByPublicationYear(theirWorks),
      };
    })
    .sort((a, b) => a.nameKana.localeCompare(b.nameKana, "ja"));
}

function groupWorksBy(idsOf) {
  const map = new Map();
  for (const w of works) {
    for (const id of idsOf(w)) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(w);
    }
  }
  return map;
}

const originalAuthorsGenerated = buildPersonList(originalAuthors, groupWorksBy((w) => w.originalAuthorIds));
const artistsGenerated = buildPersonList(artists, groupWorksBy((w) => w.artistIds));
const publishersGenerated = buildPersonList(
  publishers,
  groupWorksBy((w) => [w.publisherId])
);
const labelsGenerated = buildPersonList(labels, groupWorksBy((w) => [w.labelId]));

// ---- generated/themes.json ----
const worksByTheme = groupWorksBy((w) => w.themeIds);
const themesGenerated = themes
  .map((t) => {
    const theirWorks = worksByTheme.get(t.id) ?? [];
    return {
      ...t,
      workCount: theirWorks.length,
      workIds: idsByPublicationYear(theirWorks),
    };
  })
  .sort((a, b) => b.workCount - a.workCount || a.name.localeCompare(b.name, "ja"));

// ---- generated/work-texts.json ----
// 作品詳細ページだけが読む長文(あらすじ・出典メモ)。キーは作品id。
const workTexts = Object.fromEntries(
  works.map((w) => [w.id, { synopsis: w.synopsis, sourceNote: w.sourceNote }]),
);

// ---- generated/awards.json ----
// 受賞歴の result は「2013年版 国内編 第1位」「大賞」「第5位」のような自由文なので、
// 並べ替え用の順位をここで一度だけ取り出す。順位を持たない賞(大賞・特別賞など)は
// 大賞系を先頭、それ以外を末尾に置く。
function rankOf(result) {
  const m = /第\s*(\d+)\s*位/.exec(result ?? "");
  if (m) return Number(m[1]);
  if (/大賞|1位|第一位/.test(result ?? "")) return 0;
  return 900;
}

const winnersByAward = new Map();
for (const w of works) {
  for (const r of w.awardResults ?? []) {
    if (!winnersByAward.has(r.awardId)) winnersByAward.set(r.awardId, []);
    winnersByAward.get(r.awardId).push({ workId: w.id, workTitle: w.title, year: r.year, result: r.result, rank: rankOf(r.result) });
  }
}
const awardsGenerated = awards
  .map((a) => {
    // 年の降順 → 部門(result から順位表記を除いた部分)→ 順位の昇順。
    const section = (r) => (r.result ?? "").replace(/第\s*\d+\s*位.*$/, "").trim();
    const winners = (winnersByAward.get(a.id) ?? []).sort(
      (x, y) =>
        y.year - x.year ||
        section(x).localeCompare(section(y), "ja") ||
        x.rank - y.rank ||
        (x.workTitle ?? x.gameTitle ?? "").localeCompare(y.workTitle ?? y.gameTitle ?? "", "ja"),
    );
    return { ...a, workCount: winners.length, winners };
  })
  // 受賞作の多い賞ほど見たい情報なので件数の降順。同数は名前順で並びを安定させる。
  .sort((a, b) => b.workCount - a.workCount || a.name.localeCompare(b.name, "ja"));

// ---- generated/counts.json ----
const counts = {
  works: works.length,
  originalAuthors: originalAuthors.length,
  artists: artists.length,
  publishers: publishers.length,
  labels: labels.length,
  themes: themes.length,
  awards: awards.length,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "works.json"), JSON.stringify(worksGenerated), "utf-8");
writeFileSync(path.join(outDir, "original-authors.json"), JSON.stringify(originalAuthorsGenerated), "utf-8");
writeFileSync(path.join(outDir, "artists.json"), JSON.stringify(artistsGenerated), "utf-8");
writeFileSync(path.join(outDir, "publishers.json"), JSON.stringify(publishersGenerated), "utf-8");
writeFileSync(path.join(outDir, "labels.json"), JSON.stringify(labelsGenerated), "utf-8");
writeFileSync(path.join(outDir, "themes.json"), JSON.stringify(themesGenerated), "utf-8");
writeFileSync(path.join(outDir, "awards.json"), JSON.stringify(awardsGenerated), "utf-8");
writeFileSync(path.join(outDir, "work-texts.json"), JSON.stringify(workTexts), "utf-8");
writeFileSync(path.join(outDir, "counts.json"), JSON.stringify(counts), "utf-8");

console.log(
  `generate-manifest: wrote ${works.length} works, ${originalAuthors.length} original authors, ${artists.length} artists, ${publishers.length} publishers, ${labels.length} labels, ${themes.length} themes, ${awards.length} awards`
);


// ---- sitemap.xml ----
// Lives at the site root (not data/generated/) so it's served at /manga-db/sitemap.xml, but is
// just as deterministically derived from public/data/source/*.json — see the .gitignore note.
const SITE_URL = "https://izenmi.github.io/manga-db";
const today = new Date().toISOString().slice(0, 10);

function urlEntry(loc, lastmod) {
  return `  <url>\n    <loc>${SITE_URL}${loc}</loc>\n    <lastmod>${lastmod ?? today}</lastmod>\n  </url>`;
}

const sitemapEntries = [
  urlEntry("/"),
  urlEntry("/works"),
  ...works.map((w) => urlEntry(`/works/${w.id}`, w.updatedAt?.slice(0, 10))),
  urlEntry("/themes"),
  ...themes.map((t) => urlEntry(`/themes/${t.id}`)),
  urlEntry("/original-authors"),
  ...originalAuthors.map((a) => urlEntry(`/original-authors/${a.id}`, a.updatedAt?.slice(0, 10))),
  urlEntry("/artists"),
  ...artists.map((a) => urlEntry(`/artists/${a.id}`, a.updatedAt?.slice(0, 10))),
  urlEntry("/labels"),
  ...labels.map((l) => urlEntry(`/labels/${l.id}`, l.updatedAt?.slice(0, 10))),
  urlEntry("/awards"),
  ...awards.map((a) => urlEntry(`/awards/${a.id}`, a.updatedAt?.slice(0, 10))),
  urlEntry("/about"),
];

const sitemapXml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.join("\n")}\n</urlset>\n`;

writeFileSync(path.join(rootDir, "public", "sitemap.xml"), sitemapXml, "utf-8");
console.log(`generate-manifest: wrote sitemap.xml with ${sitemapEntries.length} URLs`);
