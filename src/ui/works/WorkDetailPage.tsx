import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { getWork, getWorks } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { WorkCard } from "../common/WorkCard";
import { WorkCover, amazonSearchUrl, rakutenBooksUrl, webComicSearch } from "../common/WorkCover";
import { BASE_PATH, DEFAULT_OG_IMAGE, breadcrumbJsonLd, useSeo } from "../common/useSeo";
import type { WorkGenerated } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  completed: "完結",
  ongoing: "刊行中",
  unknown: "不明",
};

function workJsonLd(id: string, w: WorkGenerated) {
  const authorNames = w.originalAuthorNames.length > 0 ? w.originalAuthorNames : w.artistNames;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Book",
      name: w.title,
      inLanguage: "ja",
      author: authorNames.map((name) => ({ "@type": "Person", name })),
      illustrator: w.artistNames.map((name) => ({ "@type": "Person", name })),
      publisher: { "@type": "Organization", name: w.publisherName },
      isPartOf: { "@type": "Periodical", name: w.labelName },
      datePublished: String(w.firstPublishedYear),
      genre: w.themeNames,
      description: w.synopsis,
      ...(w.coverUrl && { image: w.coverUrl }),
      ...(w.awardSummaries.length > 0 && {
        award: w.awardSummaries.map((a) => `${a.awardName} ${a.result}(${a.year})`),
      }),
    },
    breadcrumbJsonLd([
      { name: "まんがDB", path: BASE_PATH },
      { name: "作品一覧", path: `${BASE_PATH}works` },
      { name: w.title, path: `${BASE_PATH}works/${id}` },
    ]),
  ];
}

/** relatedNovelUrl は姉妹サイト2つのどちらかを指す。サイト名は別フィールドに持たず URL から導く
 *  (二重管理を避けるため — link-sister-works.mjs が張る URL が唯一の真実)。 */
function sisterSiteLabel(url: string): string {
  return url.includes("/mystery-db/") ? "ミステリDB" : "らのべDB";
}

export function WorkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useAsyncData(() => getWork(id!), [id]);
  const work = state.status === "ready" ? state.data : undefined;

  // getWorks() resolves from the same cached works.json that getWork() above already pulled,
  // so this costs no extra request.
  const allWorksState = useAsyncData(getWorks, []);
  const relatedWorks = useMemo(() => {
    if (allWorksState.status !== "ready" || !work?.relatedWorkIds) return [];
    const byId = new Map(allWorksState.data.map((x) => [x.id, x]));
    return work.relatedWorkIds
      .map((relatedId) => byId.get(relatedId))
      .filter((x): x is WorkGenerated => Boolean(x));
  }, [allWorksState, work]);

  useSeo({
    title: work?.title,
    description: work
      ? `${work.title}(${work.artistNames.join("・")}/${work.labelName})のあらすじ・刊行年・受賞歴・テーマをまとめて紹介。${work.synopsis.slice(0, 60)}…`
      : undefined,
    image: work?.coverUrl ?? DEFAULT_OG_IMAGE,
    jsonLd: work ? workJsonLd(id!, work) : undefined,
  });

  return (
    <div className="page">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && !state.data && <EmptyState text="見つかりませんでした。" />}
      {state.status === "ready" && state.data && (
        <>
          <div className="work-detail__hero">
            <div className="work-detail__hero-cover">
              <WorkCover title={state.data.title} coverUrl={state.data.coverUrl} size="lg" />
              <a
                className="cover-link"
                href={amazonSearchUrl(state.data.title, state.data.artistNames[0], state.data.isbn)}
                target="_blank"
                rel="noreferrer"
              >
                Amazonで購入
              </a>
              <a
                className="cover-link"
                href={rakutenBooksUrl(state.data.title, state.data.artistNames[0], state.data.isbn)}
                target="_blank"
                rel="noreferrer"
              >
                楽天ブックスで購入
              </a>
            </div>
            <div className="work-card__body">
              <h1>{state.data.title}</h1>
              <p className="page-subtitle">
                {state.data.originalAuthorIds.length > 0 && (
                  <>
                    原作:{" "}
                    {state.data.originalAuthorIds.map((authorId, i) => (
                      <span key={authorId}>
                        {i > 0 && "・"}
                        <Link to={`/original-authors/${authorId}`}>{state.data!.originalAuthorNames[i]}</Link>
                      </span>
                    ))}
                    {" / "}
                  </>
                )}
                作画:{" "}
                {state.data.artistIds.map((artistId, i) => (
                  <span key={artistId}>
                    {i > 0 && "・"}
                    <Link to={`/artists/${artistId}`}>{state.data!.artistNames[i]}</Link>
                  </span>
                ))}
              </p>
              <p className="page-subtitle">
                <Link to={`/labels/${state.data.labelId}`}>{state.data.labelName}</Link>
                {" / "}
                刊行{state.data.firstPublishedYear}年〜{state.data.latestPublishedYear ?? ""}
                {" / "}
                {STATUS_LABEL[state.data.status]}
                {state.data.volumeCount != null && ` / 既刊${state.data.volumeCount}巻`}
                {state.data.mediaMix?.anime && " / アニメ化"}
                {state.data.mediaMix?.novelization && " / ノベライズ化"}
              </p>

              {state.data.themeNames.length > 0 && (
                <div className="chip-row">
                  {state.data.themeIds.map((themeId, i) => (
                    <Link className="chip" to={`/themes/${themeId}`} key={themeId}>
                      {state.data!.themeNames[i]}
                    </Link>
                  ))}
                </div>
              )}

              {state.data.awardSummaries.length > 0 && (
                <div className="chip-row">
                  {state.data.awardSummaries.map((a) => (
                    <Link className="chip award-chip" to={`/awards/${a.awardId}`} key={`${a.awardId}-${a.year}`}>
                      {a.awardName} {a.result}({a.year})
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p>{state.data.synopsis}</p>

          <p>
            {state.data.externalLinks.wikipediaUrl && (
              <a href={state.data.externalLinks.wikipediaUrl} target="_blank" rel="noreferrer">
                Wikipediaで見る
              </a>
            )}
            {state.data.webComicSource &&
              (() => {
                const web = webComicSearch(state.data!.webComicSource!.platform, state.data!.title);
                return (
                  <>
                    {state.data!.externalLinks.wikipediaUrl && " / "}
                    <a href={web.url} target="_blank" rel="noreferrer">
                      {web.label}でWeb版を探す
                    </a>
                  </>
                );
              })()}
          </p>

          {state.data.relatedNovelUrl && (
            <p>
              <a className="sister-link" href={state.data.relatedNovelUrl}>
                原作小説を{sisterSiteLabel(state.data.relatedNovelUrl)}で見る →
              </a>
            </p>
          )}

          {relatedWorks.length > 0 && (
            <div className="home-section">
              <h2 className="home-section__heading font-display">この作品が好きなら</h2>
              <div className="work-grid">
                {relatedWorks.map((related) => (
                  <WorkCard key={related.id} work={related} />
                ))}
              </div>
            </div>
          )}

          <p className="source-note">{state.data.sourceNote}</p>
        </>
      )}
    </div>
  );
}
