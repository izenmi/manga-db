import type { WorkGenerated } from "../../types";
import { WorkCard, WorkCoverCard } from "./WorkCard";
import { gridClassNameFor } from "./useCoverView";

/** 一覧のグリッド。表示モード(useCoverView)に応じてカードと表紙だけのカードを出し分ける。
 *  受賞結果のラベルを添えるアワード詳細ページだけは中身の構造が違うので、これを使わず
 *  `gridClassName` と WorkCoverCard を直接組み合わせている。 */
export function WorkGrid({ works, coverView }: { works: WorkGenerated[]; coverView: boolean }) {
  return (
    <div className={gridClassNameFor(coverView)}>
      {works.map((w) =>
        coverView ? <WorkCoverCard work={w} key={w.id} /> : <WorkCard work={w} key={w.id} />,
      )}
    </div>
  );
}
