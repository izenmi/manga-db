import { useParams } from "react-router-dom";
import { getAward, getWorks } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { BASE_PATH, breadcrumbJsonLd, useSeo } from "../common/useSeo";
import { colorForYear } from "../common/yearColor";
import { WorkCard } from "../common/WorkCard";

export function AwardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useAsyncData(() => getAward(id!), [id]);
  const award = state.status === "ready" ? state.data : undefined;

  // 受賞作を作品カードで見せるために一覧を引く。すでに取得済みのキャッシュから返るので
  // 追加の通信は発生しない(詳細ページの関連作品と同じ方式)。
  const listState = useAsyncData(getWorks, []);
  const byId = new Map((listState.status === "ready" ? listState.data : []).map((x) => [x.id, x]));

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

  // winners は generate-manifest 側で「年の降順 → 部門 → 順位の昇順」に並べてあるので、
  // ここでは年ごとに切り出すだけでよい。
  const byYear = new Map<number, NonNullable<typeof award>["winners"]>();
  for (const w of award?.winners ?? []) {
    if (!byYear.has(w.year)) byYear.set(w.year, []);
    byYear.get(w.year)!.push(w);
  }

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
          <h2>受賞作 {state.data.workCount}件</h2>
          {state.data.winners.length === 0 && <EmptyState text="登録されている受賞作はまだありません。" />}
          {[...byYear.entries()].map(([year, winners]) => (
            <section key={year} className="award-year">
              <h3 className="award-year__heading">
                <span className={`award-year__year winner-year--${colorForYear(year)}`}>{year}</span>
                <span className="award-year__count">{winners.length}件</span>
                <span className="award-year__rule" aria-hidden="true" />
              </h3>
              <div className="work-grid">
                {winners.map((winner) => {
                  const item = byId.get(winner.workId);
                  return item ? (
                    <div key={`${winner.workId}-${winner.result}`} className="award-entry">
                      <p className="award-entry__result">{winner.result}</p>
                      <WorkCard work={item} />
                    </div>
                  ) : null;
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
