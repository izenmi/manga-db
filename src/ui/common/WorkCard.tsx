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
 *  column (title/author/label/awards + clickable theme tags) so the theme tags line up
 *  under the text instead of starting under the cover. Theme tags stay outside the title Link
 *  to avoid nesting <a>, but share its column via a wrapping flex column instead. */
export function WorkCard({ work }: { work: WorkGenerated }) {
  return (
    <div className="work-card">
      <Link className="work-card__cover-link" to={`/works/${work.id}`}>
        <WorkCover title={work.title} coverUrl={work.coverUrl} size="sm" />
      </Link>
      <div className="work-card__content">
        <Link className="work-card__link" to={`/works/${work.id}`}>
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
        </Link>
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
