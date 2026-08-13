import { Link } from "react-router-dom";
import type { WorkGenerated } from "../../types";
import { WorkCover } from "./WorkCover";

const STATUS_LABEL: Record<string, string> = {
  completed: "完結",
  ongoing: "刊行中",
  unknown: "不明",
};

function authorLine(work: WorkGenerated): string {
  const artists = work.artistNames.join("・");
  if (work.originalAuthorNames.length === 0) return `作画: ${artists}`;
  return `原作: ${work.originalAuthorNames.join("・")} / 作画: ${artists}`;
}

function mediaMixLabel(work: WorkGenerated): string | null {
  const parts = [];
  if (work.mediaMix?.anime) parts.push("アニメ化");
  if (work.mediaMix?.novelization) parts.push("ノベライズ化");
  return parts.length > 0 ? parts.join("・") : null;
}

/** Fuller card for the main work list page: cover thumbnail on the left, and a right-hand
 *  column (title/author/label/awards + clickable theme tags). The whole card navigates to
 *  the work page via a "stretched link" (`work-card__cover-link`, an absolutely-positioned
 *  <Link> covering the entire card) rather than a `<div onClick>` — that keeps the click target
 *  a real `<a>` so middle-click/ctrl-click "open in new tab" and keyboard nav work natively. The
 *  theme tags' own `<Link>`s are layered above it (`position: relative` in CSS) so they still
 *  navigate to their own theme page instead of the work page. */
export function WorkCard({ work }: { work: WorkGenerated }) {
  return (
    <div className="work-card">
      <Link to={`/works/${work.id}`} className="work-card__cover-link" aria-label={work.title} />
      <WorkCover title={work.title} coverUrl={work.coverUrl} size="sm" />
      <div className="work-card__content">
        <div className="work-card__title">{work.title}</div>
        <div className="work-card__meta">
          {authorLine(work)} / {work.labelName} / {work.firstPublishedYear}年〜 / {STATUS_LABEL[work.status]}
          {mediaMixLabel(work) && ` / ${mediaMixLabel(work)}`}
        </div>
        {work.awardSummaries.length > 0 && (
          <div className="work-card__awards">
            {work.awardSummaries.slice(0, 2).map((a) => (
              <span className="chip award-chip" key={`${a.awardId}-${a.year}`}>
                {a.awardName} {a.result}
              </span>
            ))}
          </div>
        )}
        {work.themeIds.length > 0 && (
          <div className="chip-row">
            {work.themeIds.map((themeId, i) => (
              <Link className="chip" to={`/themes/${themeId}`} key={themeId}>
                {work.themeNames[i]}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 表紙表示モード(`?view=covers`)のカード。書影だけを大きく並べる。カード全体がそのまま
 *  <Link> なので WorkCard のような stretched link は要らない。文字が一切出ないぶん、タイトルは
 *  `title`(ホバーで出るツールチップ)と `aria-label`(読み上げ・キーボード操作)の両方で補う。 */
export function WorkCoverCard({
  work: item,
  size = "xl",
}: {
  work: WorkGenerated;
  size?: "xl" | "gallery";
}) {
  return (
    <Link
      to={`/works/${item.id}`}
      className={size === "gallery" ? "work-cover-card work-cover-card--gallery" : "work-cover-card"}
      title={item.title}
      aria-label={item.title}
    >
      <WorkCover title={item.title} coverUrl={item.coverUrl} size={size} />
    </Link>
  );
}
