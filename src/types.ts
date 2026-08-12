// ---- source data (public/data/source/*.json, hand-authored, committed) ----

export interface ExternalLinks {
  wikipediaUrl?: string;
  officialUrl?: string;
}

export interface AwardResult {
  awardId: string;
  year: number;
  result: string; // free text: "大賞" / "金賞" / "銀賞" / "ノミネート" など
}

export type WorkStatus = "completed" | "ongoing" | "unknown";

// Web漫画プラットフォーム。個別作品のパーマリンクは推測せず、実装時にブラウザで実際に検索して
// URLパターンを目視確認できたプラットフォームのみここに追加する(CLAUDE.md参照)。
export type WebComicPlatform = "shonenjump-plus" | "tonari-young-jump";

export interface WorkSource {
  id: string;
  title: string;
  titleKana: string;
  /** 原作者。オリジナル作品(作画家自身が原作も担当)の場合は空配列にする。 */
  originalAuthorIds: string[];
  /** 作画家。最低1名(generate-manifest.mjsが空配列をエラーにする)。 */
  artistIds: string[];
  publisherId: string;
  /** 連載媒体・レーベル(例: 週刊少年ジャンプ)。表示はこちらを主に使う(publisherIdは内部保持用)。 */
  labelId: string;
  themeIds: string[];
  firstPublishedYear: number;
  latestPublishedYear?: number;
  status: WorkStatus;
  volumeCount?: number;
  synopsis: string;
  awardResults?: AwardResult[];
  /** Web漫画プラットフォームでの連載が初出の場合のみ設定。個別作品のURLは持たず、
   *  プラットフォームの検索ページへのリンクを生成する。 */
  webComicSource?: { platform: WebComicPlatform };
  /** メディアミックス状況。Wikipedia記事等で確認できた場合のみ true/false を明記する。 */
  mediaMix?: { anime?: boolean; novelization?: boolean };
  /** 姉妹サイト らのべDB / ミステリDB の同一原作小説ページへの相互リンク。
   *  scripts/link-sister-works.mjs が3リポジトリ分まとめて書き込む(手動実行)。
   *  どちらの姉妹サイトを指すかは URL から判別する(サイト名は別フィールドに持たない)。 */
  relatedNovelUrl?: string;
  externalLinks: ExternalLinks;
  sourceNote: string;
  updatedAt: string;
}

export interface OriginalAuthorSource {
  id: string;
  name: string;
  nameKana: string;
  description: string;
  birthYear?: number;
  externalLinks: ExternalLinks;
  sourceNote: string;
  updatedAt: string;
}

/** 作画家は原作者と全く同じ形の人物プロフィールなので型エイリアスにする。 */
export type ArtistSource = OriginalAuthorSource;

export interface PublisherSource {
  id: string;
  name: string;
  nameKana: string;
  parentCompany?: string;
  description: string;
  foundedYear?: number;
  externalLinks: ExternalLinks;
  sourceNote: string;
  updatedAt: string;
}

/** 連載媒体(雑誌・Web媒体等)またはレーベル。表示上の主役はこちら(CLAUDE.md参照)。
 *  出版社(PublisherSource)とは別レコードで、複数の出版社にまたがることはない前提で
 *  `publisherId` は必須の1件のみ持つ。 */
export interface LabelSource {
  id: string;
  name: string;
  nameKana: string;
  publisherId: string;
  description: string;
  externalLinks: ExternalLinks;
  sourceNote: string;
  updatedAt: string;
}

export interface ThemeSource {
  id: string;
  name: string;
  description?: string;
}

export interface AwardSource {
  id: string;
  name: string;
  organizer: string;
  description: string;
  firstYear?: number;
  externalLinks: ExternalLinks;
  sourceNote: string;
  updatedAt: string;
}

// ---- generated data (public/data/generated/*.json, built by scripts/generate-manifest.mjs) ----

/** Denormalized work: source fields plus resolved names for direct rendering. */
/** あらすじ・出典メモ・updatedAt は含まない — 作品詳細ページでしか使わないのに works.json の
 *  3分の1を占めていたので work-texts.json に分けてある(WorkTexts / getWorkTexts)。 */
export interface WorkGenerated extends Omit<WorkSource, "synopsis" | "sourceNote" | "updatedAt"> {
  originalAuthorNames: string[];
  artistNames: string[];
  publisherName: string;
  labelName: string;
  themeNames: string[];
  awardSummaries: { awardId: string; awardName: string; year: number; result: string }[];
  /** Resolved at build time from public/data/source/covers-cache.json (see scripts/fetch-covers.mjs).
   *  Absent when no ISBN/cover could be matched — callers must fall back to the placeholder cover. */
  coverUrl?: string;
  /** covers-cache が解決したISBN。購入リンクの商品ページ直リンクに使う。 */
  isbn?: string;
  /** 楽天ブックスの商品ページURL。購入リンクをここへ直リンクする。 */
  rakutenItemUrl?: string;
  /** Ids of similar works, best first, computed at build time by generate-manifest.mjs.
   *  Only present in generated/works.json — the copies embedded in the cross-reference lists
   *  omit it to keep those files small. */
  relatedWorkIds?: string[];
}

/** Shared shape for original-author/artist/publisher list+detail pages. */
export interface PersonOrPublisherGenerated {
  id: string;
  name: string;
  nameKana: string;
  description: string;
  externalLinks: ExternalLinks;
  workCount: number;
  /** 実データは works.json 側。表示側で id から引き直す。 */
  workIds: string[];
}

export interface ThemeGenerated extends ThemeSource {
  workCount: number;
  /** 実データは works.json 側。表示側で id から引き直す。 */
  workIds: string[];
}

export interface AwardWinner {
  workId: string;
  workTitle: string;
  year: number;
  result: string;
  /** 並べ替え用に result から取り出した順位。順位表記がないものは大賞系=0 / その他=900。 */
  rank: number;
}

export interface AwardGenerated extends AwardSource {
  workCount: number;
  winners: AwardWinner[];
}

/** 作品詳細ページだけが読む長文(generated/work-texts.json)。キーは作品id。 */
export type WorkTexts = Record<string, { synopsis: string; sourceNote: string }>;

export interface Counts {
  works: number;
  originalAuthors: number;
  artists: number;
  publishers: number;
  labels: number;
  themes: number;
  awards: number;
}
