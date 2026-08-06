import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loading } from "../common/Status";
import { useSeo } from "../common/useSeo";

/** One entry of a site's generated/search-index.json. Keys are one letter because the whole
 *  index is downloaded at once — see the emit block in scripts/generate-manifest.mjs. */
interface IndexItem {
  i: string;
  t: string;
  c: string;
  y: number;
}

interface SearchIndex {
  site: string;
  siteName: string;
  baseUrl: string;
  itemPath: string;
  items: IndexItem[];
}

/** Which of the four sites this build is. Self results are listed first and link through React
 *  Router; the sister sites are plain full-page links. */
const SELF_SITE = "manga";

/** All four sites live under izenmi.github.io, so in production these are same-origin requests —
 *  no CORS config and no backend. The self index is loaded from BASE_URL instead so that `npm run
 *  dev` and the prerender pass (which run on localhost) still find it. */
const SISTER_INDEX_URLS: Record<string, string> = {
  ranobe: "https://izenmi.github.io/ranobe-db/data/generated/search-index.json",
  manga: "https://izenmi.github.io/manga-db/data/generated/search-index.json",
  mystery: "https://izenmi.github.io/mystery-db/data/generated/search-index.json",
  game: "https://izenmi.github.io/game-db/data/generated/search-index.json",
};

const SITE_ORDER = ["ranobe", "manga", "mystery", "game"];

/** Results shown per site before truncating. A one-character query matches most of the catalogue,
 *  and rendering a few thousand rows makes the page unusable. */
const MAX_PER_SITE = 40;

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function indexUrlFor(site: string): string {
  if (site === SELF_SITE) return `${import.meta.env.BASE_URL}data/generated/search-index.json`;
  return SISTER_INDEX_URLS[site];
}

async function loadIndexes(): Promise<SearchIndex[]> {
  const settled = await Promise.allSettled(
    SITE_ORDER.map(async (site) => {
      const res = await fetch(indexUrlFor(site));
      if (!res.ok) throw new Error(`${site}: ${res.status}`);
      return (await res.json()) as SearchIndex;
    }),
  );
  // A sister site being unreachable (offline, local dev, a failed deploy) must not break search —
  // we just search whatever did load.
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export function CrossSearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const [indexes, setIndexes] = useState<SearchIndex[] | undefined>();

  useEffect(() => {
    let cancelled = false;
    loadIndexes().then((loaded) => {
      if (!cancelled) setIndexes(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setDraft(query), [query]);

  useSeo({
    title: "横断検索",
    description: "らのべDB・まんがDB・ミステリDB・ゲームDBの4サイトをまとめて検索できます。",
  });

  const results = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle || !indexes) return [];
    return indexes
      .map((index) => {
        const hits = index.items.filter(
          (item) => normalize(item.t).includes(needle) || normalize(item.c).includes(needle),
        );
        return { index, hits };
      })
      .filter((group) => group.hits.length > 0)
      .sort((a, b) => {
        // Own site first, then the fixed sister order, so the page doesn't reshuffle per query.
        if (a.index.site === SELF_SITE) return -1;
        if (b.index.site === SELF_SITE) return 1;
        return SITE_ORDER.indexOf(a.index.site) - SITE_ORDER.indexOf(b.index.site);
      });
  }, [indexes, query]);

  const totalHits = results.reduce((sum, group) => sum + group.hits.length, 0);
  const missingSites = indexes ? SITE_ORDER.length - indexes.length : 0;

  return (
    <div className="page">
      <h1>横断検索</h1>
      <p className="page-subtitle">らのべDB・まんがDB・ミステリDB・ゲームDBをまとめて検索します。</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParams(draft.trim() ? { q: draft.trim() } : {});
        }}
      >
        <input
          className="search-box"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="作品名・著者名・会社名で検索"
          aria-label="4サイト横断検索"
        />
      </form>

      {!indexes && <Loading />}
      {indexes && missingSites > 0 && (
        <p className="source-note">
          姉妹サイト{missingSites}件の索引を読み込めませんでした。読み込めたサイトのみ検索しています。
        </p>
      )}

      {indexes && query.trim() && (
        <p className="page-subtitle">
          「{query.trim()}」の検索結果: {totalHits}件
        </p>
      )}

      {indexes && query.trim() && totalHits === 0 && (
        <p className="source-note">一致する作品が見つかりませんでした。</p>
      )}

      {results.map(({ index, hits }) => (
        <div className="home-section" key={index.site}>
          <h2 className="home-section__heading font-display">
            {index.siteName}
            <span className="entity-list__count"> {hits.length}件</span>
          </h2>
          <ul className="winner-list">
            {hits.slice(0, MAX_PER_SITE).map((item) => (
              <li key={item.i}>
                {index.site === SELF_SITE ? (
                  <Link to={`/${index.itemPath}/${item.i}`}>{item.t}</Link>
                ) : (
                  <a href={`${index.baseUrl}/${index.itemPath}/${item.i}`}>{item.t}</a>
                )}
                <span className="entity-list__count">
                  {" "}
                  — {item.c} / {item.y}年
                </span>
              </li>
            ))}
          </ul>
          {hits.length > MAX_PER_SITE && (
            <p className="source-note">
              {hits.length}件中{MAX_PER_SITE}件を表示しています。キーワードを絞り込んでください。
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
