import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getTheme } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { matchesKeyword, themeOptionsOf } from "../common/useWorkFilter";
import { BASE_PATH, breadcrumbJsonLd, useSeo } from "../common/useSeo";
import { WorkGrid } from "../common/WorkGrid";
import { useCoverView } from "../common/useCoverView";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "completed", label: "完結" },
  { value: "ongoing", label: "刊行中" },
  { value: "unknown", label: "不明" },
];

const WEB_COMIC_OPTIONS: { value: string; label: string }[] = [
  { value: "shonenjump-plus", label: "少年ジャンプ+発" },
  { value: "tonari-young-jump", label: "となりのヤングジャンプ発" },
  { value: "none", label: "Web漫画以外(雑誌連載等)" },
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

export function ThemeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useAsyncData(() => getTheme(id!), [id]);
  const { coverView, toggle } = useCoverView();
  const theme = state.status === "ready" ? state.data : undefined;

  useSeo({
    title: theme?.name,
    description: theme
      ? `「${theme.name}」テーマのコミック${theme.workCount}作品一覧。${theme.description ?? ""}`.trim()
      : undefined,
    jsonLd: theme
      ? breadcrumbJsonLd([
          { name: "まんがDB", path: BASE_PATH },
          { name: "テーマ一覧", path: `${BASE_PATH}themes` },
          { name: theme.name, path: `${BASE_PATH}themes/${id}` },
        ])
      : undefined,
  });

  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  // このページ自身のテーマは全作品が持っていて絞り込みにならないので選択肢から外す
  const other = params.get("theme") ?? "";
  const status = params.get("status") ?? "";
  const webComic = params.get("webComic") ?? "";
  const mediaMix = params.get("mediaMix") ?? "";
  const sort = params.get("sort") ?? "year-desc";

  const options = useMemo(
    () => themeOptionsOf(state.status === "ready" ? state.data?.works : undefined, id),
    [state, id],
  );

  const filtered = useMemo(() => {
    if (state.status !== "ready" || !state.data) return [];
    const keyword = q.trim().toLowerCase();
    return state.data.works.filter((w) => {
      if (!matchesKeyword(w, keyword)) return false;
      if (other && !w.themeIds.includes(other)) return false;
      if (status && w.status !== status) return false;
      if (webComic === "none" && w.webComicSource) return false;
      if (
        (webComic === "shonenjump-plus" || webComic === "tonari-young-jump") &&
        w.webComicSource?.platform !== webComic
      )
        return false;
      if (mediaMix === "anime" && !w.mediaMix?.anime) return false;
      if (mediaMix === "novelization" && !w.mediaMix?.novelization) return false;
      if (mediaMix === "none" && (w.mediaMix?.anime || w.mediaMix?.novelization)) return false;
      return true;
    });
  }, [state, status, webComic, mediaMix, q, other]);

  const sorted = useMemo(() => {
    if (sort === "year-asc") return [...filtered].sort((a, b) => a.firstPublishedYear - b.firstPublishedYear);
    if (sort === "year-desc") return [...filtered].sort((a, b) => b.firstPublishedYear - a.firstPublishedYear);
    if (sort === "kana") return [...filtered].sort((a, b) => a.titleKana.localeCompare(b.titleKana, "ja"));
    return filtered;
  }, [filtered, sort]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of ["q", "theme", "status", "webComic", "mediaMix"]) {
      next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const hasActiveFilters = Boolean(q || other || status || webComic || mediaMix);

  return (
    <div className="page">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && !state.data && <EmptyState text="見つかりませんでした。" />}
      {state.status === "ready" && state.data && (
        <>
          <h1>{state.data.name}</h1>
          <p className="page-subtitle">{state.data.workCount}作品</p>
          {state.data.description && <p>{state.data.description}</p>}
          <div className="filter-row">
            <input
              type="search"
              value={q}
              placeholder="タイトル・作者で絞り込み"
              aria-label="タイトル・作者で絞り込み"
              onChange={(e) => updateParam("q", e.target.value)}
            />
            {options.length > 0 && (
              <select value={other} onChange={(e) => updateParam("theme", e.target.value)}>
                <option value="">他のテーマで絞り込み</option>
                {options.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
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
            <select value={webComic} onChange={(e) => updateParam("webComic", e.target.value)}>
              <option value="">Web漫画原作で絞り込み</option>
              {WEB_COMIC_OPTIONS.map((o) => (
                <option value={o.value} key={o.value}>
                  {o.label}
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
            {toggle}
          </div>
          {sorted.length === 0 && <EmptyState />}
          <WorkGrid works={sorted} coverView={coverView} />
        </>
      )}
    </div>
  );
}
