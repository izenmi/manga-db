import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getWorks } from "../../data/manifest";
import type { WorkGenerated } from "../../types";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { colorForYear } from "../common/yearColor";
import { useSeo } from "../common/useSeo";

interface YearGroup {
  year: number;
  works: WorkGenerated[];
}

interface DecadeGroup {
  decade: number;
  years: YearGroup[];
  count: number;
}

/** Groups every work by 刊行年 and then by decade. Works inside a year are sorted by title
 *  because there is no finer-grained date in works.json — only firstPublishedYear. */
function groupByDecade(works: WorkGenerated[]): DecadeGroup[] {
  const worksByYear = new Map<number, WorkGenerated[]>();
  for (const work of works) {
    const bucket = worksByYear.get(work.firstPublishedYear);
    if (bucket) bucket.push(work);
    else worksByYear.set(work.firstPublishedYear, [work]);
  }

  const yearsByDecade = new Map<number, YearGroup[]>();
  for (const [year, yearWorks] of worksByYear) {
    const decade = Math.floor(year / 10) * 10;
    const group = {
      year,
      works: [...yearWorks].sort((a, b) => a.title.localeCompare(b.title, "ja")),
    };
    const bucket = yearsByDecade.get(decade);
    if (bucket) bucket.push(group);
    else yearsByDecade.set(decade, [group]);
  }

  return [...yearsByDecade]
    .map(([decade, years]) => ({
      decade,
      years: years.sort((a, b) => a.year - b.year),
      count: years.reduce((total, y) => total + y.works.length, 0),
    }))
    .sort((a, b) => a.decade - b.decade);
}

export function TimelinePage() {
  const worksState = useAsyncData(getWorks, []);
  const [newestFirst, setNewestFirst] = useState(false);

  const decades = useMemo(
    () => (worksState.status === "ready" ? groupByDecade(worksState.data) : []),
    [worksState],
  );

  const ordered = useMemo(() => {
    if (!newestFirst) return decades;
    return [...decades].reverse().map((d) => ({ ...d, years: [...d.years].reverse() }));
  }, [decades, newestFirst]);

  const total = decades.reduce((sum, d) => sum + d.count, 0);
  const firstYear = decades[0]?.years[0]?.year;
  const lastDecade = decades[decades.length - 1];
  const lastYear = lastDecade?.years[lastDecade.years.length - 1]?.year;

  useSeo({
    title: "年表",
    description:
      total > 0
        ? `コミック${total}作品を刊行年順に並べた年表。${firstYear}年から${lastYear}年までの流れをまとめて見渡せます。`
        : undefined,
  });

  return (
    <div className="page">
      <h1>年表</h1>
      {worksState.status === "loading" && <Loading />}
      {worksState.status === "error" && <ErrorState error={worksState.error} />}
      {worksState.status === "ready" && total === 0 && <EmptyState text="作品がまだありません。" />}
      {worksState.status === "ready" && total > 0 && (
        <>
          <p className="page-subtitle">
            {firstYear}年〜{lastYear}年 / {total}作品
          </p>

          <div className="chip-row">
            {decades.map((d) => (
              <a className="chip" href={`#decade-${d.decade}`} key={d.decade}>
                {d.decade}年代
                <span className="entity-list__count"> {d.count}</span>
              </a>
            ))}
          </div>

          <p>
            <button type="button" className="timeline-order" onClick={() => setNewestFirst((v) => !v)}>
              {newestFirst ? "古い順に並べ替え" : "新しい順に並べ替え"}
            </button>
          </p>

          {ordered.map((d) => (
            <section className="timeline-decade" id={`decade-${d.decade}`} key={d.decade}>
              <h2 className="timeline-decade__heading font-display">
                {d.decade}年代
                <span className="entity-list__count"> {d.count}作品</span>
              </h2>
              {d.years.map((y) => (
                <div className="timeline-year" key={y.year}>
                  <div className="timeline-year__label">
                    <span className={`winner-year winner-year--${colorForYear(y.year)}`}>{y.year}</span>
                  </div>
                  <ul className="timeline-year__works">
                    {y.works.map((work) => (
                      <li key={work.id}>
                        <Link to={`/works/${work.id}`}>{work.title}</Link>
                        <span className="timeline-year__meta">{work.artistNames.join("・")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
