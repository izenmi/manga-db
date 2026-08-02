import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { getLabels, getThemes, getWorks } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { WorkCard } from "../common/WorkCard";
import { useSeo } from "../common/useSeo";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "completed", label: "完結" },
  { value: "ongoing", label: "刊行中" },
  { value: "unknown", label: "不明" },
];

const MEDIA_MIX_OPTIONS: { value: string; label: string }[] = [
  { value: "anime", label: "アニメ化" },
  { value: "novelization", label: "ノベライズ化" },
  { value: "none", label: "メディアミックスなし" },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "year-desc", label: "刊行年が新しい順" },
  { value: "year-asc", label: "刊行年が古い順" },
  { value: "kana", label: "五十音順" },
];

const PAGE_SIZE = 50;

/** Numbered page list with "…" collapsing for large totals, e.g. [1,2,3,"…",710].
 *  Always keeps a 3-page window around the current page plus the first/last page pinned;
 *  collapses to a plain 1..totalPages list when everything already fits without gaps. */
function getPageNumbers(page: number, totalPages: number): (number | "ellipsis")[] {
  const windowSize = 3;
  if (totalPages <= windowSize + 2) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  let start: number;
  if (page <= windowSize) {
    start = 1;
  } else if (page > totalPages - windowSize) {
    start = totalPages - windowSize + 1;
  } else {
    start = page - 1;
  }
  const end = start + windowSize - 1;

  const items: (number | "ellipsis")[] = [];
  if (start > 1) {
    items.push(1);
    if (start > 2) items.push("ellipsis");
  }
  for (let n = start; n <= end; n++) items.push(n);
  if (end < totalPages) {
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);
  }
  return items;
}

function Pager({ page, totalPages, onGoToPage }: { page: number; totalPages: number; onGoToPage: (page: number) => void }) {
  return (
    <div className="pager">
      <button type="button" className="pager__prev" disabled={page <= 1} onClick={() => onGoToPage(page - 1)}>
        ← 前へ
      </button>
      <ol className="pager__pages">
        {getPageNumbers(page, totalPages).map((item, i) =>
          item === "ellipsis" ? (
            <li className="pager__ellipsis" key={`ellipsis-${i}`} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={item === page ? "pager__page pager__page--active" : "pager__page"}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onGoToPage(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ol>
      <button type="button" className="pager__next" disabled={page >= totalPages} onClick={() => onGoToPage(page + 1)}>
        次へ →
      </button>
    </div>
  );
}

export function WorkListPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const themeId = params.get("theme") ?? "";
  const labelId = params.get("label") ?? "";
  const status = params.get("status") ?? "";
  const mediaMix = params.get("mediaMix") ?? "";
  const sort = params.get("sort") ?? "year-desc";
  const pageParam = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const worksState = useAsyncData(getWorks, []);
  const themesState = useAsyncData(getThemes, []);
  const labelsState = useAsyncData(getLabels, []);

  useSeo({
    title: "作品一覧",
    description:
      worksState.status === "ready"
        ? `コミック${worksState.data.length}作品を刊行年・五十音・テーマ・レーベルなどから検索・絞り込みできます。`
        : undefined,
  });

  const filtered = useMemo(() => {
    if (worksState.status !== "ready") return [];
    const keyword = q.trim().toLowerCase();
    return worksState.data.filter((w) => {
      if (keyword) {
        const haystack = `${w.title}${w.titleKana}${w.originalAuthorNames.join("")}${w.artistNames.join("")}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      if (themeId && !w.themeIds.includes(themeId)) return false;
      if (labelId && w.labelId !== labelId) return false;
      if (status && w.status !== status) return false;
      if (mediaMix === "anime" && !w.mediaMix?.anime) return false;
      if (mediaMix === "novelization" && !w.mediaMix?.novelization) return false;
      if (mediaMix === "none" && (w.mediaMix?.anime || w.mediaMix?.novelization)) return false;
      return true;
    });
  }, [worksState, q, themeId, labelId, status, mediaMix]);

  const sorted = useMemo(() => {
    if (sort === "year-asc") return [...filtered].sort((a, b) => a.firstPublishedYear - b.firstPublishedYear);
    if (sort === "year-desc") return [...filtered].sort((a, b) => b.firstPublishedYear - a.firstPublishedYear);
    if (sort === "kana") return [...filtered].sort((a, b) => a.titleKana.localeCompare(b.titleKana, "ja"));
    return filtered;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(params);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    setParams(next, { replace: true });
    window.scrollTo(0, 0);
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of ["q", "theme", "label", "status", "mediaMix", "page"]) {
      next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const hasActiveFilters = Boolean(q || themeId || labelId || status || mediaMix);

  return (
    <div className="page">
      <h1>作品一覧</h1>
      <input
        className="search-box"
        type="search"
        placeholder="作品名・原作者名・作画家名で検索"
        value={q}
        onChange={(e) => updateParam("q", e.target.value)}
      />
      <div className="filter-row">
        {themesState.status === "ready" && (
          <select value={themeId} onChange={(e) => updateParam("theme", e.target.value)}>
            <option value="">テーマで絞り込み</option>
            {themesState.data.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {labelsState.status === "ready" && (
          <select value={labelId} onChange={(e) => updateParam("label", e.target.value)}>
            <option value="">レーベルで絞り込み</option>
            {labelsState.data.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select value={status} onChange={(e) => updateParam("status", e.target.value)}>
          <option value="">完結状況で絞り込み</option>
          {STATUS_OPTIONS.map((s) => (
            <option value={s.value} key={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={mediaMix} onChange={(e) => updateParam("mediaMix", e.target.value)}>
          <option value="">メディアミックスで絞り込み</option>
          {MEDIA_MIX_OPTIONS.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => updateParam("sort", e.target.value === "year-desc" ? "" : e.target.value)}
        >
          {SORT_OPTIONS.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <button type="button" className="filter-clear-btn" onClick={clearFilters}>
            フィルターをクリア
          </button>
        )}
      </div>

      {worksState.status === "loading" && <Loading />}
      {worksState.status === "error" && <ErrorState error={worksState.error} />}
      {worksState.status === "ready" && (
        <>
          <p className="page-subtitle">
            {filtered.length}件{totalPages > 1 && `(${page} / ${totalPages}ページ)`}
          </p>
          {filtered.length === 0 && <EmptyState />}
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onGoToPage={goToPage} />}
          <div className="work-grid">
            {pageItems.map((w) => (
              <WorkCard work={w} key={w.id} />
            ))}
          </div>
          {totalPages > 1 && <Pager page={page} totalPages={totalPages} onGoToPage={goToPage} />}
        </>
      )}
    </div>
  );
}
