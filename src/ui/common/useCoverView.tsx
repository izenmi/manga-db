import { useSearchParams } from "react-router-dom";

/**
 * 一覧の表示モード(カード表示 / 表紙だけを大きく並べる表紙表示)。
 *
 * 絞り込みと同じくURLのクエリ(`?view=covers`)に持つ。表紙表示のまま共有・ブックマークでき、
 * ブラウザの戻るで前のモードに戻る。既定値(カード表示)はURLに書かない。
 *
 * ルートは増やさない。別ルートにすると App.tsx / TopNav.tsx / prerender.mjs /
 * generate-manifest.mjs の4箇所に追記が要るうえ、プリレンダーの件数も倍になる。
 */

/** 一覧グリッドのクラス名。フックを使わない側とも共有して、
 *  クラス名の組み立てが2箇所に散らばらないようにしている。 */
export function gridClassNameFor(coverView: boolean): string {
  return coverView ? "work-grid work-grid--covers" : "work-grid";
}

export function useCoverView() {
  const [params, setParams] = useSearchParams();
  const coverView = params.get("view") === "covers";

  function setCoverView(next: boolean) {
    const p = new URLSearchParams(params);
    if (next) p.set("view", "covers");
    else p.delete("view");
    // 絞り込みの updateParam と違って page は消さない。1ページの件数はモードによらず同じなので、
    // 同じ ?page= が同じ範囲を指し続ける(見ていたページのまま表示だけが切り替わる)。
    setParams(p, { replace: true });
  }

  const toggle = (
    <div className="view-toggle" role="group" aria-label="表示モード">
      <button
        type="button"
        className={coverView ? "view-toggle__btn" : "view-toggle__btn view-toggle__btn--active"}
        aria-pressed={!coverView}
        onClick={() => setCoverView(false)}
      >
        カード
      </button>
      <button
        type="button"
        className={coverView ? "view-toggle__btn view-toggle__btn--active" : "view-toggle__btn"}
        aria-pressed={coverView}
        onClick={() => setCoverView(true)}
      >
        表紙
      </button>
    </div>
  );

  return { coverView, gridClassName: gridClassNameFor(coverView), toggle };
}
