import { useState } from "react";

const COVER_COLORS = ["blue", "pink", "mint", "yellow", "peach", "purple"] as const;

function colorFor(title: string): (typeof COVER_COLORS)[number] {
  let sum = 0;
  for (let i = 0; i < title.length; i++) sum += title.charCodeAt(i);
  return COVER_COLORS[sum % COVER_COLORS.length];
}

/** Real cover image when one was resolved (public/data/source/covers-cache.json, built by
 *  `npm run fetch-covers` — see scripts/fetch-covers.mjs), falling back to a generated
 *  placeholder (title on a pastel card) when absent or the image fails to load. We don't host
 *  cover art ourselves; that's copyrighted illustration work, not a fact. */
export function WorkCover({ title, coverUrl, size = "sm" }: { title: string; coverUrl?: string; size?: "sm" | "lg" }) {
  const [broken, setBroken] = useState(false);
  if (coverUrl && !broken) {
    return (
      <img
        className={`work-cover work-cover--${size} work-cover--image`}
        src={coverUrl}
        alt={title}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div className={`work-cover work-cover--${size} work-cover--${colorFor(title)}`}>
      <span className="work-cover__title">{title}</span>
    </div>
  );
}

const AMAZON_AFFILIATE_TAG = "izenmi-22";

/** Amazon search-results link — never a direct product page. works.json only tracks
 *  series-level data (no per-volume ISBN/ASIN), so we can't link a specific product reliably;
 *  see CLAUDE.md "購入リンクは検索URL形式のみ". Pass `volumeLabel` (e.g. "1巻") to narrow the
 *  query to one volume, or omit it to search the whole series. */
export function amazonSearchUrl(title: string, volumeLabel?: string): string {
  const query = volumeLabel ? `${title} ${volumeLabel}` : title;
  const params = new URLSearchParams({ k: query, tag: AMAZON_AFFILIATE_TAG });
  return `https://www.amazon.co.jp/s?${params.toString()}`;
}

// URLパターンはブラウザで実際に検索して目視確認したもののみ登録する(CLAUDE.md参照)。未確認の
// プラットフォームを type WebComicPlatform に追加する場合は先にここで検証すること。
const WEB_COMIC_SITE: Record<"shonenjump-plus" | "tonari-young-jump", { label: string; searchUrl: (title: string) => string }> = {
  "shonenjump-plus": {
    label: "少年ジャンプ+",
    searchUrl: (title) => `https://shonenjumpplus.com/search?q=${encodeURIComponent(title)}`,
  },
  "tonari-young-jump": {
    label: "となりのヤングジャンプ",
    searchUrl: (title) => `https://tonarinoyj.jp/search?q=${encodeURIComponent(title)}`,
  },
};

export function webComicSearch(platform: "shonenjump-plus" | "tonari-young-jump", title: string) {
  const site = WEB_COMIC_SITE[platform];
  return { label: site.label, url: site.searchUrl(title) };
}
