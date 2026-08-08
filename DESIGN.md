# まんがDB 設計書

日本語コミック(漫画)作品を原作者・作画家・レーベル(連載媒体)・受賞歴・テーマから検索できるファンデータベース。姉妹サイト[らのべDB](https://izenmi.github.io/ranobe-db/)(`izenmi/ranobe-db`)のコミック版として作成し、アーキテクチャ・デザインシステム・運用ノウハウの多くをそこから移植している。

運用ルール(データ入力ルール・執筆ポリシー・作業フロー等)は本書ではなく `CLAUDE.md` を正とする。本書はプログラムとしての構造・データフロー・技術的な設計判断を対象とする。

- 公開URL: https://izenmi.github.io/manga-db/
- リポジトリ: `izenmi/manga-db`(public。GitHub Pagesは無料枠だとpublicでないと使えない)

## 1. 全体アーキテクチャ

ビルド時に静的JSONを生成し、クライアントサイドでReactアプリがそれをfetchして描画する「静的サイト+クライアントレンダリング」構成。サーバーもDBも持たない。

```
public/data/source/*.json (手作業・コミット対象)
        │  scripts/generate-manifest.mjs (predev/prebuild)
        │   ├─ 参照整合性チェック(不正id・重複idはビルド失敗)
        │   └─ 非正規化(id→名前解決、entityごとに関連Workを埋め込み)
        ▼
public/data/generated/*.json (.gitignore対象、ビルドのたびに再生成)
        │  fetch (src/data/manifest.ts)
        ▼
React SPA (Vite + react-router-dom BrowserRouter)
        │  vite build → postbuild: scripts/prerender.mjs
        ▼
dist/<route>/index.html (Playwrightでクロールして書き出した静的HTML)
        │  GitHub Actions (.github/workflows/deploy.yml)
        ▼
GitHub Pages (https://izenmi.github.io/manga-db/)
```

技術スタック: React 18 + TypeScript + Vite 5 + `react-router-dom`(`BrowserRouter`。ranobe-dbと異なり最初からBrowserRouterで作っているため旧HashRouter互換のリダイレクト処理は存在しない)。

## 2. データモデル(`src/types.ts`)

### 2.1 ソース型(`public/data/source/*.json`、手作業で作成・コミット)

| 型 | 主なフィールド | 備考 |
|---|---|---|
| `WorkSource` | `originalAuthorIds[]` / `artistIds[]` / `publisherId` / `labelId` / `themeIds[]` / `firstPublishedYear` / `status` / `synopsis` / `awardResults[]` / `webComicSource` / `mediaMix` / `relatedNovelUrl`(未実装の予約フィールド) | `artistIds`は必須最低1名。`originalAuthorIds`はコミカライズ作品のみ入力(オリジナル作品は空配列) |
| `OriginalAuthorSource` | name / nameKana / description / birthYear / externalLinks | |
| `ArtistSource` | (`OriginalAuthorSource`の型エイリアス) | 原作者と全く同じ人物プロフィール形状のため |
| `PublisherSource` | name / parentCompany / foundedYear | 発行企業。UIには表示しない内部データ |
| `LabelSource` | name / `publisherId` | 連載媒体・レーベル。表示上の主役 |
| `ThemeSource` | name / description | |
| `AwardSource` | name / organizer / firstYear | |

`WorkStatus = "completed" | "ongoing" | "unknown"`、`WebComicPlatform = "shonenjump-plus" | "tonari-young-jump"`(検証済みのもののみ追加、詳細はCLAUDE.md)。

### 2.2 生成型(`public/data/generated/*.json`、ビルド時生成)

- `WorkGenerated extends WorkSource` — 各idを名前解決した`originalAuthorNames`/`artistNames`/`publisherName`/`labelName`/`themeNames`/`awardSummaries`、および`covers-cache.json`から解決した任意の`coverUrl`を追加。
- `PersonOrPublisherGenerated` — 原作者・作画家・レーベル一覧/詳細ページ共通の型。`workCount`と、`WorkCard`をそのまま再利用できるようフル展開した`works: WorkGenerated[]`を持つ。
- `ThemeGenerated` / `AwardGenerated`(`AwardWinner`含む) — 同様にworks/winnersを埋め込む。
- `Counts` — 7エンティティそれぞれの件数。

**出版社(`publisherId`)とレーベル(`labelId`)は別概念**。`publisherId`は内部保持のみでUI(ナビ・フィルタ・カード・詳細)には出さず、ユーザーに見えるのは常に`labelId`(2026-08-02に出版社表示からレーベル表示へ全面移行、詳細な移行経緯はCLAUDE.md参照)。

## 3. データ生成パイプライン(`scripts/generate-manifest.mjs`)

`npm run dev`/`npm run build`前の`predev`/`prebuild`フックとして必ず実行される。

1. **参照整合性チェック** — 全Workの`originalAuthorIds`/`artistIds`/`publisherId`/`labelId`/`themeIds`/`awardResults[].awardId`、および`label.publisherId`が対応するsourceに存在するかを検証。`artistIds`が空配列の場合もエラー。各entityのid重複もチェック。1件でも違反があればビルドを失敗させ、idの誤字を機械的に防ぐ。
2. **非正規化** — `works.json`に名前解決済みフィールドを付与。原作者・作画家・レーベル・テーマの一覧/詳細ページ用に、それぞれの関連Workをフル展開(`WorkGenerated`と同一形状)して埋め込む。
3. **sitemap.xml生成** — 静的ルート+全entityの詳細ページURLを列挙し、`updatedAt`から`lastmod`を設定してサイトルートに書き出す。

## 4. 表紙画像解決(`scripts/fetch-covers.mjs`)

ビルド時には叩かない手動スクリプト(`npm run fetch-covers`、要`RAKUTEN_APP_ID`/`RAKUTEN_ACCESS_KEY`)。works.jsonはシリーズ単位のデータのみ持つため、シリーズタイトルで検索して代表ISBN・カバー画像を解決する。

- 楽天ブックス書籍検索APIで検索し、ISBNが`9784`始まり(日本国内発行)かつ`booksGenreId`がコミックジャンル(`001001`)始まりのものを採用(**ranobe-dbとは逆の絞り込み**: ranobe-dbはこのジャンルを除外するが、manga-dbはコミックが本体のため要求する)。
- ヒットしない場合は楽天Koboの電子書籍検索APIにフォールバック(ジャンル絞り込みなし・前方一致のみのため誤マッチのリスクが高く、要目視確認)。
- 結果は`public/data/source/covers-cache.json`に**コミット**し、ビルドを完全オフライン・決定的に保つ。`matchedTitle`を後から目視確認できるよう保存する。

`WorkCover.tsx`はこのキャッシュ由来の`coverUrl`があれば実画像を表示し、なければタイトル文字列のハッシュ値から6色ローテーションで決定するパステルカラーのプレースホルダーを表示する(表紙イラスト自体はホストしない)。

## 5. フロントエンド構成

### 5.1 ルーティング(`src/App.tsx`)

```
/                                    HomePage
/works, /works/:id                   WorkListPage, WorkDetailPage
/themes, /themes/:id                 ThemeListPage, ThemeDetailPage
/original-authors[/:id]              PersonListPage/PersonDetailPage (kind="originalAuthor")
/artists[/:id]                       PersonListPage/PersonDetailPage (kind="artist")
/labels[/:id]                        PersonListPage/PersonDetailPage (kind="label")
/awards, /awards/:id                 AwardListPage, AwardDetailPage
/about                               AboutPage
*                                    NotFoundPage
```

原作者・作画家・レーベルは同一のUI構造(一覧+詳細)を持つため、`PersonListPage`/`PersonDetailPage`を`kind`パラメータで汎用化して共用している(出版社専用のUIルートは存在しない)。

### 5.2 ディレクトリ構成(`src/ui/`)

- `home/` — `HomePage.tsx`
- `works/` — `WorkListPage.tsx`(検索・テーマ/レーベル/完結状況/メディアミックスによる絞り込み、五十音/刊行年ソート、50件ページング)、`WorkDetailPage.tsx`
- `themes/`, `awards/` — 各一覧・詳細ページ
- `common/` — `TopNav.tsx`、汎用`PersonListPage`/`PersonDetailPage`、`WorkCard.tsx`(一覧用カード)、`WorkCover.tsx`(表紙表示+Amazon検索URL+Web漫画検索URL生成)、`EntityList.tsx`、`Status.tsx`(Loading/Error/Empty)、`useAsyncData.ts`、`useSeo.ts`、`common.css`
- `about/` — `AboutPage.tsx`

### 5.3 データ取得層(`src/data/manifest.ts`)

`public/data/generated/*.json`をfetchする薄いラッパー。entityごとの`getX()`(一覧、モジュールレベルの`Map`でPromiseをメモ化)と`getX(id)`(一覧を取得して`.find()`する単体取得)のみで構成され、状態管理ライブラリは使わない。各ページは`useAsyncData`フックでこれらを呼び出し、loading/error/ready状態を扱う。

## 6. SEO / SSG

- **`useSeo.ts`** — `document.title`・meta description・canonical・OGP/Twitterカード・JSON-LD構造化データ(`Book`スキーマ+`BreadcrumbList`)をページ遷移ごとに設定するフック。canonical/`og:url`は`window.location.origin`ではなく固定の`SITE_ORIGIN`定数から組み立てる(prerenderがローカルの`vite preview`から叩くための対策)。
- **`scripts/prerender.mjs`**(`postbuild`) — 生成データから全ルート(全Work/原作者/作画家/レーベル/テーマ/アワード詳細ページ含む)を列挙し、`vite preview`を起動してPlaywright(Chromium)のワーカープールでクロール、`dist/<route>/index.html`として書き出す。クローラーやcurlにも正しい`<title>`/meta/OGP/JSON-LDが返るようにするため。最後に`dist/index.html`を`dist/404.html`にコピーし、GitHub Pages上でのSPAフォールバックとする。
- **`scripts/generate-ogp.mjs`** — Playwrightで1200×630のOGP画像を1枚生成する一回限りのスクリプト(ビルドパイプラインには含まれない、手動再実行)。

## 7. デザインシステム(`src/theme/theme.css`)

ranobe-dbから完全流用し、アクセントカラーのみパステルオレンジ(`--color-orange`系)に変更(姉妹サイトの水色と区別するため)。CSS変数でダーク/ライト両方のトークンを定義しているが、現状は`color-scheme: dark`固定でライトモード切り替えは未実装(将来のトグル用に温存)。

- ページ背景は黒一色固定、影・グラデーション・点線ボーダー等の装飾は基本つけない
- 見出しフォントは`M PLUS Rounded 1c`
- カバー画像・カウントバッジ・受賞年ピルは装飾用の6色ローテーション(紫/ピンク/水色/ミント/黄/ピーチ)を別途使用
- `WorkCard`はカード全体(下部余白含む)がクリック領域(`<a>`ネスト防止のため`role="link"`付き`div`)。内部のテーマチップのみ`stopPropagation`で独立したリンク先を持つ

## 8. ビルド・デプロイ

```sh
npm install
npm run dev       # predevでgenerate-manifest実行 → http://localhost:5173/manga-db/
npm run build     # 型チェック(tsc -b) → vite build → postbuildでprerender
npm run preview
```

`main`ブランチへのpushで`.github/workflows/deploy.yml`が起動し、`npm ci` → Playwright Chromiumインストール → `npm run build` → GitHub Pagesへデプロイを自動実行する。`vite.config.ts`の`base: "/manga-db/"`はリポジトリ名に依存するため、リポジトリ名変更時は要修正。

## 9. らのべDBとの主な相違点

| 項目 | らのべDB | まんがDB |
|---|---|---|
| ルーター | HashRouter互換リダイレクトあり | BrowserRouterのみ |
| 原作/作画 | `authorIds`のみ | `originalAuthorIds`(任意)+`artistIds`(必須) |
| 表示の主役 | 出版社 | レーベル(連載媒体)、出版社は内部データ化 |
| 表紙APIのジャンル絞り込み | コミックジャンルを除外 | コミックジャンルを要求 |
| アクセントカラー | 水色 | パステルオレンジ |
| Web版連携フィールド | — | `relatedNovelUrl`(型のみ、未実装) |

## 10. 未解決事項

現在の未着手事項(表紙画像の解決率、Web漫画プラットフォーム対応状況、`og-image.png`の再生成、`relatedNovelUrl`の実装、未使用レーベルの扱い等)は運用状況に応じて頻繁に変わるため、本書ではなく`CLAUDE.md`の「既知の未着手事項」節を正とする。
