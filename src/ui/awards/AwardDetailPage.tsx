import { Link, useParams } from "react-router-dom";
import { getAward } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { BASE_PATH, breadcrumbJsonLd, useSeo } from "../common/useSeo";
import { colorForYear } from "../common/yearColor";

export function AwardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useAsyncData(() => getAward(id!), [id]);
  const award = state.status === "ready" ? state.data : undefined;

  useSeo({
    title: award?.name,
    description: award
      ? `「${award.name}」(主催: ${award.organizer})の受賞作${award.workCount}件一覧。${award.description}`.slice(0, 160)
      : undefined,
    jsonLd: award
      ? breadcrumbJsonLd([
          { name: "まんがDB", path: BASE_PATH },
          { name: "アワード一覧", path: `${BASE_PATH}awards` },
          { name: award.name, path: `${BASE_PATH}awards/${id}` },
        ])
      : undefined,
  });

  return (
    <div className="page">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && !state.data && <EmptyState text="見つかりませんでした。" />}
      {state.status === "ready" && state.data && (
        <>
          <h1>{state.data.name}</h1>
          <p className="page-subtitle">
            主催: {state.data.organizer}
            {state.data.firstYear && ` / ${state.data.firstYear}年〜`}
          </p>
          <p>{state.data.description}</p>
          {state.data.externalLinks.wikipediaUrl && (
            <p>
              <a href={state.data.externalLinks.wikipediaUrl} target="_blank" rel="noreferrer">
                Wikipediaで見る
              </a>
            </p>
          )}
          <h2>受賞作</h2>
          {state.data.winners.length === 0 && <EmptyState text="登録されている受賞作はまだありません。" />}
          <ul className="winner-list">
            {state.data.winners.map((winner) => (
              <li key={`${winner.workId}-${winner.year}`}>
                <span className={`winner-year winner-year--${colorForYear(winner.year)}`}>{winner.year}</span>
                <Link to={`/works/${winner.workId}`}>{winner.workTitle}</Link>
                <span className="entity-list__count"> — {winner.result}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
