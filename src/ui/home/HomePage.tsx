import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCounts } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState } from "../common/Status";
import { SITE_NAME, SITE_URL, useSeo } from "../common/useSeo";

const BADGES: { key: keyof Awaited<ReturnType<typeof getCounts>>; label: string; to: string; color: string }[] = [
  { key: "works", label: "作品", to: "/works", color: "blue" },
  { key: "originalAuthors", label: "原作者", to: "/original-authors", color: "pink" },
  { key: "artists", label: "作画家", to: "/artists", color: "mint" },
  { key: "labels", label: "レーベル", to: "/labels", color: "yellow" },
  { key: "themes", label: "テーマ", to: "/themes", color: "purple" },
  { key: "awards", label: "アワード", to: "/awards", color: "peach" },
];

export function HomePage() {
  const state = useAsyncData(getCounts, []);
  const [q, setQ] = useState("");
  const navigate = useNavigate();

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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/works?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="page">
      <div className="home-hero">
        <h1 className="font-display">まんがDB</h1>
        <p className="page-subtitle">日本語コミックを原作者・作画家・受賞歴・テーマから探せるデータベース</p>
        <p className="home-intro">
          このページは次に読む作品を選ぶために作成しました。次に読みたいテーマなどで検索してお使いください。
        </p>
      </div>

      <form onSubmit={handleSearch}>
        <input
          className="search-box"
          type="search"
          placeholder="作品名・原作者名・作画家名で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>

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

      <p className="source-note">
        本サイトの記述はWikipedia日本語版等の公開情報を参考に独自にまとめたものです。詳しくは
        <Link to="/about">このサイトについて</Link>
        をご覧ください。
      </p>
    </div>
  );
}
