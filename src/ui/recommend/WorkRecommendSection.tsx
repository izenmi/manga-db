import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getWorks } from "../../data/manifest";
import type { WorkGenerated } from "../../types";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState, EmptyState } from "../common/Status";
import { matchesKeyword } from "../common/useWorkFilter";
import { useCoverView } from "../common/useCoverView";
import { RECOMMEND_COUNT, RecommendGrid, tieBreakKey } from "./RecommendPage";

const MAX_SEEDS = 3;
const CANDIDATE_COUNT = 20;
// ビルド側 relatedIdsFor(scripts/generate-manifest.mjs)と同じ値。片方だけ変えないこと。
const SAME_ARTIST_BONUS = 0.15;
const SAME_ORIGINAL_AUTHOR_BONUS = 0.1;

/** 各シード作品との類似度を**個別に計算して算術平均**する。
 *
 *  1シードあたりの式はビルド側 relatedIdsFor と同じ: テーマIDFコサイン +
 *  同作画家+0.15 + 同原作者+0.1(別の式を新造しない — 同じサイトで「似ている」の
 *  定義が2つあると詳細ページの並びと食い違う)。シードが1件のとき、作品詳細の
 *  「この作品が好きなら」と同じ順位になるのはこのため。
 *
 *  テーマベクトルを合算してから1回でコサインを取る方式にしないのは、制作者ボーナスの意味が
 *  崩れる(どのシードと同作画家なのかが混ざる)のと、1件時にビルド側と食い違うため。
 *  N と df を works.json 全件から数えるとビルド側・テーマ起点と完全に同じIDFになる
 *  (recommend-index.json の items も全件入りで N が一致する)。 */
function scoreBySeeds(works: WorkGenerated[], seeds: WorkGenerated[]) {
  const n = works.length;
  const df = new Map<string, number>();
  for (const w of works) for (const t of w.themeIds) df.set(t, (df.get(t) ?? 0) + 1);
  const idf2 = new Map([...df].map(([t, d]) => [t, Math.log(n / d) ** 2]));
  const normOf = (w: WorkGenerated) =>
    Math.sqrt(w.themeIds.reduce((sum, t) => sum + (idf2.get(t) ?? 0), 0));

  const seedData = seeds.map((s) => ({
    themes: new Set(s.themeIds),
    norm: normOf(s),
    artists: new Set(s.artistIds),
    originalAuthors: new Set(s.originalAuthorIds),
  }));
  const seedIds = new Set(seeds.map((s) => s.id));

  const scored: { work: WorkGenerated; score: number }[] = [];
  for (const w of works) {
    // 除外はシード自身だけ。同作画家のスピンオフ等が上位に来るのは詳細ページと同じ望ましい挙動。
    if (seedIds.has(w.id)) continue;
    const workNorm = normOf(w);
    let total = 0;
    for (const sd of seedData) {
      let dot = 0;
      for (const t of w.themeIds) if (sd.themes.has(t)) dot += idf2.get(t) ?? 0;
      let score = sd.norm > 0 && workNorm > 0 ? dot / (sd.norm * workNorm) : 0;
      if (w.artistIds.some((id) => sd.artists.has(id))) score += SAME_ARTIST_BONUS;
      if (w.originalAuthorIds.some((id) => sd.originalAuthors.has(id)))
        score += SAME_ORIGINAL_AUTHOR_BONUS;
      total += score;
    }
    const score = total / seedData.length;
    if (score > 0) scored.push({ work: w, score });
  }
  return scored;
}

/** 作品起点のおすすめ(`?works=<id>,<id>,<id>`)。
 *
 *  データは works.json だけを使う。専用索引を作らないのは、recommend-index.json に
 *  タイトル・読み・制作者idまで足すと大きく膨れる一方、主要導線
 *  (作品詳細の「この作品が好きなら」からの遷移)では works.json が取得済みキャッシュから
 *  返り追加転送ゼロで済むため。このモードはタブ操作か共有URLでしか開かれないので、
 *  プリレンダーが見る素の /recommend(テーマ起点)には works.json のフェッチも
 *  「読み込み中」も発生しない。 */
export function WorkRecommendSection() {
  const [params, setParams] = useSearchParams();
  const { coverView, toggle } = useCoverView();
  const [q, setQ] = useState("");

  const worksState = useAsyncData(getWorks, []);
  const works = worksState.status === "ready" ? worksState.data : undefined;
  const byId = useMemo(() => new Map((works ?? []).map((w) => [w.id, w])), [works]);

  // 知らないidは黙って捨て、4つ目以降は切り捨てる(テーマ起点と同じ方針)。
  // URLへの正規化書き戻しはしない — works.json ロード前に「全部未知」と誤判定して
  // 共有URLを壊さないため。
  const seeds = useMemo(() => {
    const raw = (params.get("works") ?? "").split(",").filter(Boolean);
    return [...new Set(raw)]
      .map((id) => byId.get(id))
      .filter((w): w is WorkGenerated => w !== undefined)
      .slice(0, MAX_SEEDS);
  }, [params, byId]);

  function setSeedIds(next: string[]) {
    const p = new URLSearchParams(params);
    if (next.length > 0) {
      p.set("works", next.join(","));
      p.delete("mode");
    } else {
      // 最後のシードを外しても作品起点タブに留まる(mode= が無いとテーマ起点に戻ってしまう)。
      p.delete("works");
      p.set("mode", "works");
    }
    setParams(p, { replace: true });
  }

  const keyword = q.trim().toLowerCase();
  const candidates = useMemo(() => {
    if (!works || !keyword) return [];
    const seedIds = new Set(seeds.map((s) => s.id));
    const prefix = (w: WorkGenerated) =>
      w.title.toLowerCase().startsWith(keyword) || w.titleKana.startsWith(keyword) ? 0 : 1;
    return works
      .filter((w) => !seedIds.has(w.id) && matchesKeyword(w, keyword))
      .sort(
        (a, b) =>
          prefix(a) - prefix(b) ||
          tieBreakKey(b) - tieBreakKey(a) ||
          b.firstPublishedYear - a.firstPublishedYear ||
          a.id.localeCompare(b.id),
      )
      .slice(0, CANDIDATE_COUNT);
  }, [works, keyword, seeds]);

  const results = useMemo(() => {
    if (!works || seeds.length === 0) return [];
    return scoreBySeeds(works, seeds).sort(
      (a, b) =>
        b.score - a.score ||
        tieBreakKey(b.work) - tieBreakKey(a.work) ||
        b.work.awardSummaries.length - a.work.awardSummaries.length ||
        a.work.id.localeCompare(b.work.id),
    );
  }, [works, seeds]);

  const seedThemes = useMemo(() => new Set(seeds.flatMap((s) => s.themeIds)), [seeds]);
  const atLimit = seeds.length >= MAX_SEEDS;

  if (worksState.status === "loading") return <Loading />;
  if (worksState.status === "error") return <ErrorState error={worksState.error} />;

  return (
    <>
      {seeds.length > 0 && (
        <div className="chip-row chip-row--lg theme-picker__selected">
          {seeds.map((s) => (
            <button
              type="button"
              className="chip chip--lg chip--on"
              key={s.id}
              aria-pressed
              onClick={() => setSeedIds(seeds.filter((x) => x.id !== s.id).map((x) => x.id))}
            >
              {s.title} ×
            </button>
          ))}
        </div>
      )}

      <div className="filter-row">
        <input
          type="search"
          value={q}
          placeholder="タイトル・作者で作品を検索"
          aria-label="タイトル・作者で作品を検索"
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="page-subtitle">
          {atLimit ? `上限の${MAX_SEEDS}作品を選択中 — 外すと他を選べます` : `選択中 ${seeds.length} / ${MAX_SEEDS}`}
        </span>
        {seeds.length > 0 && (
          <button type="button" className="filter-clear-btn" onClick={() => setSeedIds([])}>
            選択をクリア
          </button>
        )}
      </div>

      {keyword && (
        <div className="work-picker">
          {candidates.map((w) => (
            <button
              type="button"
              className="work-picker__item"
              key={w.id}
              disabled={atLimit}
              onClick={() => {
                setSeedIds([...seeds.map((s) => s.id), w.id]);
                setQ("");
              }}
            >
              <span className="work-picker__title">{w.title}</span>
              <span className="work-picker__meta">
                {w.artistNames.join("・")} / {w.labelName} / {w.firstPublishedYear}年〜
              </span>
            </button>
          ))}
          {candidates.length === 0 && <EmptyState text="該当する作品がありません。" />}
        </div>
      )}

      {seeds.length === 0 && !keyword && <EmptyState text="作品を検索して選ぶとおすすめが表示されます。" />}

      {seeds.length > 0 && (
        <>
          <h2 className="home-section__heading font-display">おすすめ</h2>
          <div className="filter-row">
            <p className="page-subtitle">
              {Math.min(results.length, RECOMMEND_COUNT)}作品
              {results.length > RECOMMEND_COUNT && ` / 候補${results.length}作品`}
            </p>
            {toggle}
          </div>
          {results.length === 0 && <EmptyState />}
          <RecommendGrid
            entries={results.slice(0, RECOMMEND_COUNT).map((r) => ({
              work: r.work,
              score: r.score,
              matchedNames: r.work.themeIds
                .map((t, i) => (seedThemes.has(t) ? r.work.themeNames[i] : null))
                .filter((name): name is string => name !== null),
            }))}
            coverView={coverView}
          />
          {results.length > 0 && (
            <p className="page-subtitle">
              一致度は、選んだ作品と作品のテーマの重なり具合(珍しいテーマほど重く数えます)です。
              同じ作画家・原作者の作品には加点しているため、100%を上限に丸めています。
            </p>
          )}
        </>
      )}
    </>
  );
}
