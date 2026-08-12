import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getRecommendIndex, getWorks } from "../../data/manifest";
import type { RecommendIndex, WorkGenerated } from "../../types";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { BASE_PATH, breadcrumbJsonLd, useSeo } from "../common/useSeo";
import { WorkCard, WorkCoverCard } from "../common/WorkCard";
import { gridClassNameFor, useCoverView } from "../common/useCoverView";

const MAX_TAGS = 3;
const RECOMMEND_COUNT = 20;

/** 選んだテーマとの一致度。
 *
 *  式は `scripts/generate-manifest.mjs` の関連作品(この作品が好きなら)と**同じもの**を使う。
 *  同じサイトの中で「似ている」の定義が2つあると、詳細ページの並びとここの並びが食い違うため。
 *
 *    idf(t) = log(N / df(t))            N = 全作品数、df = そのテーマを持つ作品数
 *    ‖X‖    = sqrt(Σ_{t∈X} idf(t)²)     ← 作品側は「その作品が持つ全テーマ」で取る
 *    一致度  = Σ_{t∈選択∩作品} idf(t)² / (‖選択‖ · ‖作品‖)
 *
 *  ビルド側にある制作者の共通ボーナスはここでは足さない(種になる作品がないため)。
 *  そのぶん上限がちょうど 1.0 になり、そのまま「一致度◯%」として出せる。 */
function scoreItems(index: RecommendIndex, selected: string[]) {
  const n = index.items.length;
  const df = new Map(index.tags.map((t) => [t.id, t.count]));
  const idf = (t: string) => {
    const d = df.get(t);
    return d ? Math.log(n / d) : 0;
  };

  const queryNorm = Math.sqrt(selected.reduce((sum, t) => sum + idf(t) ** 2, 0));
  if (queryNorm === 0) return [];

  const chosen = new Set(selected);
  const scored: { id: string; score: number; matched: string[] }[] = [];
  for (const item of index.items) {
    let dot = 0;
    let sumSquares = 0;
    const matched: string[] = [];
    for (const t of item.tagIds) {
      const weight = idf(t) ** 2;
      sumSquares += weight;
      if (chosen.has(t)) {
        dot += weight;
        matched.push(t);
      }
    }
    const norm = Math.sqrt(sumSquares);
    // テーマが1つも付いていない作品(‖作品‖ = 0)はここで落ちる。ビルド側と同じガード。
    if (dot === 0 || norm === 0) continue;
    scored.push({ id: item.id, score: dot / (queryNorm * norm), matched });
  }
  return scored;
}

/** 同点をどう並べるか。
 *
 *  一致度は同点が出やすい(選んだテーマだけを持つ作品はすべて100%になる)。
 *  id昇順だけに落とすとスラッグのアルファベット順という無意味な並びで20枠が決まってしまうので、
 *  テーマが情報を持たなくなった時点で既存データにある知名度の代理指標に判断を移す。
 *  最後は必ずid昇順で締めて、同じURLが常に同じ並びになるようにする。 */
function tieBreakKey(item: WorkGenerated): number {
  return (item.mediaMix?.anime ? 2 : 0) + (item.mediaMix?.novelization ? 1 : 0);
}

export function RecommendPage() {
  const [params, setParams] = useSearchParams();
  const { coverView, toggle } = useCoverView();
  const [q, setQ] = useState("");

  // テーマ選択に必要なのは軽量索引だけ。カード描画に要るworks.jsonは
  // テーマを1つ選ぶまで取りに行かない — 何も選ばずに離脱する人に大きなJSONを払わせないため。
  const indexState = useAsyncData(getRecommendIndex, []);
  const index = indexState.status === "ready" ? indexState.data : undefined;

  const selected = useMemo(() => {
    const known = new Set((index?.tags ?? []).map((t) => t.id));
    const raw = (params.get("tags") ?? "").split(",").filter(Boolean);
    // 知らないidは黙って捨てる(idを改名した後の古い共有URLでもエラーにしない)。
    return [...new Set(raw.filter((t) => known.has(t)))].slice(0, MAX_TAGS);
  }, [params, index]);

  const hasSelection = selected.length > 0;
  const itemsState = useAsyncData(
    () => (hasSelection ? getWorks() : Promise.resolve([] as WorkGenerated[])),
    [hasSelection],
  );

  useSeo({
    title: "好みからおすすめ",
    description:
      "好きなテーマを3つまで選ぶと、テーマの重なりが近いコミックを一致度つきで20作品おすすめします。",
    jsonLd: breadcrumbJsonLd([
      { name: "まんがDB", path: BASE_PATH },
      { name: "好みからおすすめ", path: `${BASE_PATH}recommend` },
    ]),
  });

  function setSelected(next: string[]) {
    const p = new URLSearchParams(params);
    if (next.length > 0) p.set("tags", next.join(","));
    else p.delete("tags");
    setParams(p, { replace: true });
  }

  function toggleTag(id: string) {
    if (selected.includes(id)) setSelected(selected.filter((t) => t !== id));
    // 上限に達したチップは disabled にしてあるのでここには来ないが、URL直打ちに備えて弾く。
    else if (selected.length < MAX_TAGS) setSelected([...selected, id]);
  }

  const nameById = useMemo(() => new Map((index?.tags ?? []).map((t) => [t.id, t.name])), [index]);

  const results = useMemo(() => {
    if (!index || !hasSelection || itemsState.status !== "ready") return [];
    const byId = new Map(itemsState.data.map((x) => [x.id, x]));
    return scoreItems(index, selected)
      .map((s) => ({ ...s, item: byId.get(s.id) }))
      .filter((s): s is typeof s & { item: WorkGenerated } => s.item !== undefined)
      .sort(
        (a, b) =>
          b.score - a.score ||
          tieBreakKey(b.item) - tieBreakKey(a.item) ||
          b.item.awardSummaries.length - a.item.awardSummaries.length ||
          a.id.localeCompare(b.id),
      );
  }, [index, selected, hasSelection, itemsState]);

  const keyword = q.trim().toLowerCase();
  const visibleTags = (index?.tags ?? []).filter(
    (t) => !keyword || t.name.toLowerCase().includes(keyword) || t.id.includes(keyword),
  );
  const atLimit = selected.length >= MAX_TAGS;

  return (
    <div className="page">
      <h1>好みからおすすめ</h1>
      <p className="page-subtitle">
        好きなテーマを{MAX_TAGS}つまで選ぶと、傾向の近い作品を一致度つきで{RECOMMEND_COUNT}作品おすすめします。
      </p>

      {indexState.status === "loading" && <Loading />}
      {indexState.status === "error" && <ErrorState error={indexState.error} />}
      {index && (
        <>
          {hasSelection && (
            <div className="chip-row chip-row--lg theme-picker__selected">
              {selected.map((id) => (
                <button
                  type="button"
                  className="chip chip--lg chip--on"
                  key={id}
                  aria-pressed
                  onClick={() => toggleTag(id)}
                >
                  {nameById.get(id)} ×
                </button>
              ))}
            </div>
          )}

          <div className="filter-row">
            <input
              type="search"
              value={q}
              placeholder="テーマ名で絞り込み"
              aria-label="テーマ名で絞り込み"
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="page-subtitle">
              {atLimit
                ? `上限の${MAX_TAGS}つを選択中 — 外すと他を選べます`
                : `選択中 ${selected.length} / ${MAX_TAGS}`}
            </span>
            {hasSelection && (
              <button type="button" className="filter-clear-btn" onClick={() => setSelected([])}>
                選択をクリア
              </button>
            )}
          </div>

          {/* 結果のカードも .chip-row を持つので、テーマ選択行だけを指せるクラスを足しておく。 */}
          <div className="chip-row theme-picker">
            {visibleTags.map((t) => {
              const on = selected.includes(t.id);
              return (
                <button
                  type="button"
                  className={on ? "chip chip--on" : "chip"}
                  key={t.id}
                  aria-pressed={on}
                  disabled={!on && atLimit}
                  onClick={() => toggleTag(t.id)}
                >
                  {t.name}
                  <span className="entity-list__count">{t.count}</span>
                </button>
              );
            })}
          </div>
          {visibleTags.length === 0 && <EmptyState text="該当するテーマがありません。" />}

          {/* 未選択のときは Loading を出さないこと。prerender.mjs は「読み込み中」が消えるまで待って
              諦めるので、静的HTMLに「読み込み中…」が焼き付いてクローラーがそれを見ることになる。 */}
          {!hasSelection && <EmptyState text="テーマを選ぶとおすすめが表示されます。" />}

          {hasSelection && (
            <>
              <h2 className="home-section__heading font-display">おすすめ</h2>
              {itemsState.status === "loading" && <Loading />}
              {itemsState.status === "error" && <ErrorState error={itemsState.error} />}
              {itemsState.status === "ready" && (
                <>
                  <div className="filter-row">
                    <p className="page-subtitle">
                      {Math.min(results.length, RECOMMEND_COUNT)}作品
                      {results.length > RECOMMEND_COUNT && ` / 候補${results.length}作品`}
                    </p>
                    {toggle}
                  </div>
                  {results.length === 0 && <EmptyState />}
                  <div className={gridClassNameFor(coverView)}>
                    {results.slice(0, RECOMMEND_COUNT).map((r) => (
                      // アワード詳細と同じ「カードには手を入れず、上にラベルを添える」形
                      <div className="award-entry" key={r.id}>
                        <p className="award-entry__result">
                          <span className="match-score">{Math.round(r.score * 100)}%</span>
                          {r.matched.map((t) => nameById.get(t)).join("・")}
                        </p>
                        {coverView ? <WorkCoverCard work={r.item} /> : <WorkCard work={r.item} />}
                      </div>
                    ))}
                  </div>
                  {results.length > 0 && (
                    <p className="page-subtitle">
                      一致度は、選んだテーマと作品のテーマの重なり具合(珍しいテーマほど重く数えます)です。
                      選んだテーマだけが付いている作品が100%になります。
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
