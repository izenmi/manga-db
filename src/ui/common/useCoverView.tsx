import { useSearchParams } from "react-router-dom";

/**
 * 一覧の表示モード(カード表示 / 表紙だけを大きく並べる表紙表示 / さらに大判のギャラリー表示)。
 *
 * 絞り込みと同じくURLのクエリ(`?view=covers` / `?view=gallery`)に持つ。表紙表示のまま共有・
 * ブックマークでき、ブラウザの戻るで前のモードに戻る。既定値(カード表示)はURLに書かない。
 *
 * ギャラリー表示は作画家詳細だけが `{ gallery: true }` でオプトインする鑑賞向けモード。
 * 無効なページで `?view=gallery` を開かれたら covers 扱いに落とす(未知テーマidを黙って捨てるのと
 * 同じ方針で、エラーにしない)。
 *
 * ルートは増やさない。別ルートにすると App.tsx / TopNav.tsx / prerender.mjs /
 * generate-manifest.mjs の4箇所に追記が要るうえ、プリレンダーの件数も倍になる。
 */

export type CoverViewMode = "cards" | "covers" | "gallery";

/** 一覧グリッドのクラス名。フックを使わない側とも共有して、
 *  クラス名の組み立てが2箇所に散らばらないようにしている。 */
export function gridClassNameFor(view: CoverViewMode | boolean): string {
  const mode = typeof view === "boolean" ? (view ? "covers" : "cards") : view;
  if (mode === "gallery") return "work-grid work-grid--gallery";
  if (mode === "covers") return "work-grid work-grid--covers";
  return "work-grid";
}

export function useCoverView(options?: { gallery?: boolean }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: CoverViewMode =
    raw === "gallery" ? (options?.gallery ? "gallery" : "covers") : raw === "covers" ? "covers" : "cards";
  const coverView = view !== "cards";

  function setView(next: CoverViewMode) {
    const p = new URLSearchParams(params);
    if (next === "cards") p.delete("view");
    else p.set("view", next);
    // 絞り込みの updateParam と違って page は消さない。1ページの件数はモードによらず同じなので、
    // 同じ ?page= が同じ範囲を指し続ける(見ていたページのまま表示だけが切り替わる)。
    setParams(p, { replace: true });
  }

  const modes: { value: CoverViewMode; label: string }[] = [
    { value: "cards", label: "カード" },
    { value: "covers", label: "表紙" },
    ...(options?.gallery ? [{ value: "gallery" as const, label: "ギャラリー" }] : []),
  ];

  const toggle = (
    <div className="view-toggle" role="group" aria-label="表示モード">
      {modes.map((m) => (
        <button
          type="button"
          key={m.value}
          className={view === m.value ? "view-toggle__btn view-toggle__btn--active" : "view-toggle__btn"}
          aria-pressed={view === m.value}
          onClick={() => setView(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  return { view, coverView, gridClassName: gridClassNameFor(view), toggle };
}
