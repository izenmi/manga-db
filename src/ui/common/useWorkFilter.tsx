import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { WorkGenerated } from "../../types";

/**
 * 作品リストを持つページ(テーマ詳細・原作者/作画家/出版社/レーベル詳細・アワード詳細)で
 * 共通に使う絞り込み。作品一覧ページ(WorkListPage)と同じ操作感を、詳細ページにも出すためのもの。
 *
 * 絞り込み条件はURLのクエリパラメータに持つので、絞った状態のまま共有・ブックマークできるし、
 * ブラウザの戻るでひとつ前の条件に戻れる。詳細ページごとに useState を置くとこれが崩れる。
 *
 * WorkListPage 側は「テーマ」「レーベル」など、そのページでしか意味のない条件も持つため
 * 統合していない。ここに置くのは**どの詳細ページでも意味がある条件だけ**にしている。
 */

const STATUS_OPTIONS = [
  { value: "completed", label: "完結" },
  { value: "ongoing", label: "刊行中" },
  { value: "unknown", label: "不明" },
];

const MEDIA_MIX_OPTIONS = [
  { value: "anime", label: "アニメ化" },
  { value: "novelization", label: "ノベライズ化" },
  { value: "none", label: "メディアミックスなし" },
];

const SORT_OPTIONS = [
  { value: "year-desc", label: "刊行年が新しい順" },
  { value: "year-asc", label: "刊行年が古い順" },
  { value: "kana", label: "五十音順" },
];

export function useWorkFilter(works: WorkGenerated[] | undefined, defaultSort = "year-desc") {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const mediaMix = params.get("mediaMix") ?? "";
  const sort = params.get("sort") ?? defaultSort;

  const filtered = useMemo(() => {
    if (!works) return [];
    const keyword = q.trim().toLowerCase();
    return works.filter((w) => {
      if (keyword) {
        // 制作者名のフィールド名はサイトごとに違う(原作者/作画家、著者/イラストレーター等)ので
        // 存在するものだけを拾う。姉妹サイトへ同じフックを移植できるようにするため。
        const w2 = w as unknown as Record<string, unknown>;
        const names = ["originalAuthorNames", "artistNames", "authorNames", "illustratorNames"]
          .flatMap((k) => (Array.isArray(w2[k]) ? (w2[k] as string[]) : []));
        if (!`${w.title}${w.titleKana}${names.join("")}`.toLowerCase().includes(keyword)) return false;
      }
      if (status && w.status !== status) return false;
      if (mediaMix === "anime" && !w.mediaMix?.anime) return false;
      if (mediaMix === "novelization" && !w.mediaMix?.novelization) return false;
      if (mediaMix === "none" && (w.mediaMix?.anime || w.mediaMix?.novelization)) return false;
      return true;
    });
  }, [works, q, status, mediaMix]);

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
    next.delete("page");
    setParams(next, { replace: true });
  }

  const hasActiveFilters = Boolean(q || status || mediaMix);

  const controls = (
    <div className="filter-row">
      <input
        type="search"
        value={q}
        placeholder="タイトル・作者で絞り込み"
        aria-label="タイトル・作者で絞り込み"
        onChange={(e) => updateParam("q", e.target.value)}
      />
      <select value={status} onChange={(e) => updateParam("status", e.target.value)}>
        <option value="">完結状況で絞り込み</option>
        {STATUS_OPTIONS.map((o) => (
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
        onChange={(e) => updateParam("sort", e.target.value === defaultSort ? "" : e.target.value)}
      >
        {SORT_OPTIONS.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hasActiveFilters && (
        <button
          type="button"
          className="filter-clear-btn"
          onClick={() => {
            const next = new URLSearchParams(params);
            ["q", "status", "mediaMix"].forEach((k) => next.delete(k));
            setParams(next, { replace: true });
          }}
        >
          フィルターをクリア
        </button>
      )}
    </div>
  );

  return { filtered, sorted, controls, hasActiveFilters };
}
