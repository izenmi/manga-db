import { useMemo } from "react";
import { Link } from "react-router-dom";
import { getCounts, getThemes, getWorks } from "../../data/manifest";
import type { WorkGenerated } from "../../types";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { WorkCard } from "../common/WorkCard";
import { colorForYear } from "../common/yearColor";
import { SITE_NAME, SITE_URL, useSeo } from "../common/useSeo";

const BADGES: { key: keyof Awaited<ReturnType<typeof getCounts>>; label: string; to: string; color: string }[] = [
  { key: "works", label: "作品", to: "/works", color: "blue" },
  { key: "originalAuthors", label: "原作者", to: "/original-authors", color: "pink" },
  { key: "artists", label: "作画家", to: "/artists", color: "mint" },
  { key: "labels", label: "レーベル", to: "/labels", color: "yellow" },
  { key: "themes", label: "テーマ", to: "/themes", color: "purple" },
  { key: "awards", label: "アワード", to: "/awards", color: "peach" },
];

const PICKUP_COUNT = 6;
const SPOTLIGHT_COUNT = 6;
const POPULAR_THEME_COUNT = 12;

const SISTER_SITES = [
  {
    key: "ranobe",
    name: "らのべDB",
    url: "https://izenmi.github.io/ranobe-db/",
    tagline: "ライトノベル作品を著者・イラストレーター・出版社・受賞歴・テーマから探せるデータベース",
  },
  {
    key: "game",
    name: "ゲームDB",
    url: "https://izenmi.github.io/game-db/",
    tagline: "PS5/Switch/Switch2ゲームを会社・ジャンル・受賞歴から探せるデータベース",
  },
  {
    key: "mystery",
    name: "ミステリDB",
    url: "https://izenmi.github.io/mystery-db/",
    tagline: "国内外の推理小説を著者・名探偵・翻訳者・受賞歴・テーマから探せるデータベース",
  },
  {
    key: "tech",
    name: "技術書DB",
    url: "https://izenmi.github.io/tech-db/",
    tagline: "ITエンジニア向けの技術書を技術スタック・対象レベル・著者・出版社から探せるデータベース",
  },
] as const;

/** Returns up to `count` elements from `works` in random order, without mutating the input. */
function pickRandomWorks(works: WorkGenerated[], count: number): WorkGenerated[] {
  const pool = [...works];
  const result: WorkGenerated[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool[idx]);
    pool[idx] = pool[pool.length - 1];
    pool.pop();
  }
  return result;
}

/** Cached for the lifetime of the SPA session so the row stays put when the reader navigates
 *  away and comes back (including via the browser's Back button) — re-rolling on every remount
 *  silently replaced the works they had just been looking at. A full page reload starts a new
 *  module instance and therefore reshuffles. */
let cachedPickup: WorkGenerated[] | null = null;

function getPickupWorks(works: WorkGenerated[]): WorkGenerated[] {
  if (!cachedPickup) cachedPickup = pickRandomWorks(works, PICKUP_COUNT);
  return cachedPickup;
}

interface RecentAward {
  workId: string;
  workTitle: string;
  awardId: string;
  awardName: string;
  year: number;
  result: string;
}

function flattenRecentAwards(works: WorkGenerated[], count: number): RecentAward[] {
  const flattened: RecentAward[] = works.flatMap((w) =>
    w.awardSummaries.map((a) => ({ ...a, workId: w.id, workTitle: w.title }))
  );
  flattened.sort((a, b) => b.year - a.year);
  return flattened.slice(0, count);
}

export function HomePage() {
  const state = useAsyncData(getCounts, []);
  const worksState = useAsyncData(getWorks, []);
  const themesState = useAsyncData(getThemes, []);
  const pickupWorks = useMemo(
    () => (worksState.status === "ready" ? getPickupWorks(worksState.data) : []),
    [worksState]
  );
  const recentAwards = useMemo(
    () => (worksState.status === "ready" ? flattenRecentAwards(worksState.data, SPOTLIGHT_COUNT) : []),
    [worksState]
  );
  const popularThemes = useMemo(
    () =>
      themesState.status === "ready"
        ? [...themesState.data].sort((a, b) => b.workCount - a.workCount).slice(0, POPULAR_THEME_COUNT)
        : [],
    [themesState]
  );

  useSeo({
    description:
      state.status === "ready"
        ? `日本語コミック${state.data.works}作品を原作者・作画家・レーベル・受賞歴・テーマから検索できるファンデータベース。`
        : undefined,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE_URL}works?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  });

  return (
    <div className="page">
      <div className="home-hero">
        <h1 className="font-display">まんがDB</h1>
        <p className="page-subtitle">日本語コミックを原作者・作画家・受賞歴・テーマから探せるデータベース</p>
        <p className="home-intro">
          読みたい作品探しに使えるデータベースです。テーマ・作画家・レーベルなどで絞り込めます。
        </p>
      </div>

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && (
        <div className="count-badges">
          {BADGES.map((badge) => (
            <Link className={`count-badge count-badge--${badge.color}`} to={badge.to} key={badge.key}>
              <span className="count-badge__number">{state.data[badge.key]}</span>
              <span className="count-badge__label">{badge.label}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="home-section">
        <h2 className="home-section__heading font-display">ピックアップ作品</h2>
        {worksState.status === "loading" && <Loading />}
        {worksState.status === "error" && <ErrorState error={worksState.error} />}
        {worksState.status === "ready" && (
          <>
            <div className="work-grid">
              {pickupWorks.map((w) => (
                <WorkCard work={w} key={w.id} />
              ))}
            </div>
            <Link className="home-section__more" to="/works">
              作品一覧を見る →
            </Link>
          </>
        )}
      </div>

      <div className="home-section">
        <h2 className="home-section__heading font-display">受賞作スポットライト</h2>
        {worksState.status === "loading" && <Loading />}
        {worksState.status === "error" && <ErrorState error={worksState.error} />}
        {worksState.status === "ready" && recentAwards.length === 0 && (
          <EmptyState text="登録されている受賞歴はまだありません。" />
        )}
        {worksState.status === "ready" && recentAwards.length > 0 && (
          <>
            <ul className="winner-list">
              {recentAwards.map((a) => (
                <li key={`${a.workId}-${a.awardId}-${a.year}`}>
                  <span className={`winner-year winner-year--${colorForYear(a.year)}`}>{a.year}</span>
                  <Link className="home-award-name" to={`/awards/${a.awardId}`}>
                    {a.awardName}
                  </Link>
                  <span className="entity-list__count"> ― </span>
                  <Link to={`/works/${a.workId}`}>{a.workTitle}</Link>
                  <span className="entity-list__count"> ({a.result})</span>
                </li>
              ))}
            </ul>
            <Link className="home-section__more" to="/awards">
              受賞歴一覧を見る →
            </Link>
          </>
        )}
      </div>

      <div className="home-section">
        <h2 className="home-section__heading font-display">人気テーマ</h2>
        {themesState.status === "loading" && <Loading />}
        {themesState.status === "error" && <ErrorState error={themesState.error} />}
        {themesState.status === "ready" && (
          <>
            <div className="chip-row chip-row--lg">
              {popularThemes.map((t) => (
                <Link className="chip chip--lg" to={`/works?theme=${t.id}`} key={t.id}>
                  {t.name} <span className="entity-list__count">{t.workCount}</span>
                </Link>
              ))}
            </div>
            <Link className="home-section__more" to="/themes">
              テーマ一覧を見る →
            </Link>
          </>
        )}
      </div>

      <div className="home-section">
        <h2 className="home-section__heading font-display">姉妹サイト</h2>
        <div className="sister-site-cards">
          {SISTER_SITES.map((site) => (
            <a className={`sister-site-card sister-site-card--${site.key}`} href={site.url} key={site.key}>
              <span className="sister-site-card__name font-display">{site.name}</span>
              <span className="sister-site-card__desc">{site.tagline}</span>
            </a>
          ))}
        </div>
      </div>

      <p className="source-note">
        本サイトの記述はWikipedia日本語版等の公開情報を参考に独自にまとめたものです。詳しくは
        <Link to="/about">このサイトについて</Link>
        をご覧ください。
      </p>
    </div>
  );
}
