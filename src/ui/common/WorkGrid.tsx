import type { WorkGenerated } from "../../types";
import { WorkCard, WorkCoverCard } from "./WorkCard";
import { gridClassNameFor, type CoverViewMode } from "./useCoverView";

/** 一覧のグリッド。表示モード(useCoverView)に応じてカードと表紙だけのカードを出し分ける。
 *  `view` を渡せば3モード(ギャラリー含む)、従来どおり `coverView` だけなら2モードで動く。
 *  受賞結果のラベルを添えるアワード詳細ページだけは中身の構造が違うので、これを使わず
 *  `gridClassName` と WorkCoverCard を直接組み合わせている。 */
export function WorkGrid({
  works,
  coverView,
  view,
}: {
  works: WorkGenerated[];
  coverView?: boolean;
  view?: CoverViewMode;
}) {
  const mode: CoverViewMode = view ?? (coverView ? "covers" : "cards");
  return (
    <div className={gridClassNameFor(mode)}>
      {works.map((w) =>
        mode === "cards" ? (
          <WorkCard work={w} key={w.id} />
        ) : (
          <WorkCoverCard work={w} size={mode === "gallery" ? "gallery" : "xl"} key={w.id} />
        ),
      )}
    </div>
  );
}
