# manga-db

日本語コミック(漫画)作品を原作者・作画家・出版社(レーベル)・受賞歴・テーマから検索できるファンデータベース。姉妹サイト[らのべDB](https://izenmi.github.io/ranobe-db/)(`izenmi/ranobe-db`)のコミック版として作成した。アーキテクチャ・デザインシステム・運用ノウハウの多くをranobe-dbから移植している。

- 公開URL: https://izenmi.github.io/manga-db/
- リポジトリ: `izenmi/manga-db`(public。GitHub Pagesは無料枠だとpublicでないと使えない)
- スタック: React 18 + TypeScript + Vite 5 + `react-router-dom`(`BrowserRouter`)。ranobe-dbと異なり最初からBrowserRouterで作っているため、旧HashRouter互換のリダイレクト処理は存在しない

## データフロー(source → generated)

- `public/data/source/*.json` … 手作業で作成・**コミットする**一次データ(works/original-authors/artists/publishers/themes/awards)
- `public/data/generated/*.json` … `scripts/generate-manifest.mjs` がビルド時に生成する非正規化データ。**`.gitignore`対象**、`predev`/`prebuild`npmスクリプトで毎回再生成するので手で編集しない
- 生成スクリプトは全Workの`originalAuthorIds`/`artistIds`/`publisherId`/`themeIds`/`awardResults[].awardId`が対応するsourceに存在するかを検証し、存在しなければビルドを失敗させる(id誤字をCIで機械的に防ぐ)。**`artistIds`が空配列の場合もエラーになる**(作画家は必須、ranobe-dbのauthorIdsとの主な違い)
- 原作者・作画家・出版社・テーマの詳細ページは、それぞれの作品一覧を`WorkGenerated`型でフル展開して埋め込む(`WorkCard`をそのまま再利用できるようにするため)

## 原作/作画の入力ルール(ranobe-dbとの最大の違い)

- **`artistIds`は必須・最低1名**。**`originalAuthorIds`は原作つき作品(小説・ゲーム・Web漫画等が原作でコミカライズされた作品)のみ入力し、オリジナル作品(作画家自身が原作も兼ねる)は空配列のままにする**
- 原作者と作画家が同一人物であっても、オリジナル作品であれば`originalAuthorIds`には入れない(同一人物を`originalAuthorIds`と`artistIds`の両方に重複登録しない)
- 新規idを追加する前に既存の`original-authors.json`/`artists.json`/`publishers.json`を確認し、同一人物・レーベルの重複登録を避ける

## データ入力ルール(ranobe-dbから踏襲)

- **出典は日本語版Wikipediaを基本とするが必須ではない**。Wikipediaに記事がない作品も登録してよく、その場合は出版社公式サイト・電子書店等の書誌情報・信頼できる他の情報源を使ってよい。書き込む前に必ず何らかの情報源で裏取りし、`sourceNote`に何を確認したか・どの情報源を使ったか・何が未確認かを明記する
- **あらすじはコピペ禁止**。Wikipediaの文章表現をそのまま転記せず、150〜250字程度で必ず自分の言葉で要約する(事実自体は著作権保護対象外だが、文章表現はCC BY-SA 4.0の対象になりうるため)
- **表紙画像は`covers-cache.json`にあれば実画像、なければプレースホルダー**。`scripts/fetch-covers.mjs`(`npm run fetch-covers`、要`RAKUTEN_APP_ID`/`RAKUTEN_ACCESS_KEY`)が楽天ブックス書籍検索APIでシリーズごとのISBN・表紙URLを解決し`public/data/source/covers-cache.json`に**コミットする**(ビルド時には叩かない)。**ranobe-dbとはジャンル絞り込みが逆**: ranobe-dbはコミックジャンル(`001001`)を除外するが、manga-dbはコミックがこのサイトの本体なので同ジャンルを**要求**する(同名タイトルのノベライズ版が誤って上位マッチしないようにするため)
  - **未実行(2026-08-02時点)**: 楽天ウェブサービスのアプリ登録はサイトのURL(アプリケーションURL)に紐づくため、ranobe-dbの`RAKUTEN_APP_ID`/`RAKUTEN_ACCESS_KEY`は使い回せない。[webservice.rakuten.co.jp](https://webservice.rakuten.co.jp/)でmanga-db用に新規登録(アプリケーションURL: `https://izenmi.github.io/manga-db/`)してから`npm run fetch-covers`を実行すること
- **購入リンクは検索URL形式のみ**。個別商品ページへの直リンクは使わない(理由はranobe-dbと同じ: works.jsonがシリーズ単位のデータしか持たないため)。`amazonSearchUrl(title, volumeLabel?)`(`src/ui/common/WorkCover.tsx`)がアフィリエイトタグ`izenmi-22`(ranobe-dbと共通)付きの検索URLを生成する
- **Web漫画プラットフォームへのリンクは検索URLパターンのみ**使う。**新しいプラットフォームを`WebComicPlatform`型に追加する場合は、必ず実装前にブラウザで実際にそのサイトの検索機能を使い、結果のURL(クエリパラメータ名・パス構造)を目視確認してから追加すること。憶測でURLパターンを書かない**(ranobe-dbの「個別作品のパーマリンクを推測しない」方針を検索URL自体にも適用したもの)。現在確認済みで実装しているのは以下の2つのみ:
  - 少年ジャンプ+: `https://shonenjumpplus.com/search?q=<encoded>`(2026-08-02にブラウザで実検索して確認)
  - となりのヤングジャンプ: `https://tonarinoyj.jp/search?q=<encoded>`(2026-08-02にブラウザで実検索して確認、ドメインは`tonarinoyj.jp`)
  - comico(`https://www.comico.jp/search/<keyword>`)も断片的に確認できたが未実装。他のプラットフォーム(ガンガンONLINE・pixivコミック・LINEマンガ・コミックDAYS・マガジンポケット等)は未検証・未実装
- `relatedNovelUrl`(`src/types.ts`の`WorkSource`): **将来、姉妹サイトranobe-dbの同一原作ラノベ作品ページへ相互リンクするための予約フィールド。現時点では実装・入力しない(常にundefined)**。値を入れる運用を始める場合はこの節を更新すること

## データ拡充時の作業フロー(ranobe-dbと同じ)

シードデータの拡充は必ず小バッチ(10〜15作品程度)で作業し、バッチごとに即コミット・push。詳細な手順(サブエージェントへのWikipedia調査依頼、`apply_batch.py`での反映、大量追加時の並行調査フロー)はranobe-dbのCLAUDE.mdを参照して同じパターンで進める。`apply_batch.py`のbatch.jsonフォーマットは`newOriginalAuthors`/`newArtists`/`newPublishers`/`newThemes`/`newAwards`/`works`キーを使う(ranobe-dbの`newAuthors`/`newIllustrators`とはキー名が異なる)。

## 受賞歴(awards)の方針

漫画賞(講談社漫画賞・小学館漫画賞・手塚治虫文化賞・日本漫画家協会賞等)に加え、ranobe-dbと同様に人気投票・ランキング系のアワード(このマンガがすごい!・SUGOI JAPAN Award等)も`awardResults`に含める。

- 作品(シリーズ)自体の順位・受賞が明記されているものだけを採用する
- **キャラクター人気投票のみ**は対象外
- **アニメ版のみが対象の賞**は対象外(この作品はコミック自体の受賞歴を記録するサイトのため)
- 賞の名称が時代とともに変わっている場合は既存idを再利用し、`sourceNote`に当時の名称を明記する

## テーマタグの方針(ranobe-dbと同じ)

再利用可能な少数タグに絞る。新規作品を追加する際、既存タグで表現しきれない要素があれば`themes.json`にタグを追加してよい。scaffold時点(5作品)のタグ: サスペンス・心理戦/探偵・推理/バトル・アクション/コメディ/スパイ・アクション/ダークファンタジー/冒険。

## デザイン方針(ranobe-dbから完全流用)

- パステルカラー基調、グラデーションはなるべく使わない、水色がメインアクセント
- ページ背景は黒一色固定
- 装飾(影・グラデーション・点線ボーダー等)は基本つけない
- 見出しフォントは`M PLUS Rounded 1c`、チップ(テーマ・受賞)で情報を出す
- PC画面の余白を無駄にしない(`.work-grid`は2カラムグリッド、`.page`は`max-width: 1200px`)
- `src/theme/theme.css`・`src/ui/common/common.css`はranobe-dbからほぼ無変更でコピーしている

## コマンド

```sh
npm install
npm run dev       # http://localhost:5173/manga-db/
npm run build      # 型チェック + データ整合性チェック + ビルド + prerender
npm run preview
```

`main`へのpushで`.github/workflows/deploy.yml`が自動ビルド・GitHub Pagesデプロイを行う。

## SEO / SSG(ranobe-dbから移植)

`useSeo.ts`(document.title/meta/canonical/OGP/JSON-LD設定)、`scripts/prerender.mjs`(`postbuild`フックでPlaywrightが全ルートをクロールし`dist/<route>/index.html`を書き出す、最後に`dist/index.html`を`dist/404.html`にコピー)、`scripts/generate-manifest.mjs`内のsitemap.xml生成の仕組みはranobe-dbと同一パターン。**canonical/og:urlはwindow.location.originでなくSITE_ORIGIN定数から組み立てる**(prerenderがvite previewのlocalhostから叩くための対策、詳細はranobe-dbのCLAUDE.md参照)。

## データ規模(2026-08-02、2ラウンドの大量追加後)

計184作品(scaffold5作品+第1ラウンド8バッチ104作品+第2ラウンド6バッチ75作品)。原作者43・作画家170・出版社16・テーマ21(第2ラウンドでgambling=賭博・ギャンブル、arts=芸術・創作を追加)・アワード8(manga-taisho=マンガ大賞を追加)。第2ラウンドはユーザーの「デスゲーム作品を多めに」という要望を受け、デスゲーム編2バッチ(今際の国のアリス、バトル・ロワイアル、ダーウィンズゲーム、王様ゲーム等22作品)を中心に音楽・アート/歴史・時代劇/ホラー・オカルト拡張/グルメ・日常・ゲーム系も追加。各バッチはgeneral-purposeサブエージェントに日本語版Wikipedia調査を並行依頼し、完了順に`apply_batch.py`で逐次反映・ビルド確認・コミット/pushした(ranobe-dbの大量追加フローと同じ)。80候補中75採用(学糾法廷・六道の悪女たち・デスパレードはジャンル不一致/実在未確認で却下)。

## 既知の未着手事項

- **GA4トラッキングタグ未導入**: ranobe-db専用IDを流用すると計測データが混ざるため、`index.html`にGoogleタグを入れていない。新規プロパティ発行が必要
- **表紙画像は159/184作品で解決済み(2026-08-02)**: manga-db用の楽天ウェブサービスのアプリID/アクセスキーで`npm run fetch-covers`を実行。ONE PIECE・ドラゴンボール・HUNTER×HUNTER・NANA・GANTZ・BTOOOM!・BECK・累-かさね-・リング等25作品は楽天ブックス・Koboともに該当書誌なしでプレースホルダーのまま。**Kobo検索フォールバック(`pickBestKoboMatch`)はジャンル絞り込みがなく前方一致のみのため、「H2」→「H20 and the Waters of Forgetfulness」、「MAJOR」→「Major Bible Themes」、「ブラック・ジャック」→無関係な同名タイトル本、「センゴク」→乙女ゲーム系「センゴク男子」のような誤マッチが実際に複数回発生した(計5件検出・手動でプレースホルダーに戻した)。短い/一般的すぎるタイトルの結果は`matchedTitle`を必ず目視確認すること**。以後新規作品を追加したら同コマンドを再実行し、実行後は必ず`matchedTitle`一覧を確認すること(`RAKUTEN_APP_ID`/`RAKUTEN_ACCESS_KEY`環境変数が必要、値はユーザーが管理)
- **Web漫画プラットフォームは2種類のみ実装**(少年ジャンプ+・となりのヤングジャンプ)。他プラットフォームは`WebComicPlatform`型に未追加(検証してから追加すること)
- **favicon/apple-touch-icon は専用デザインに差し替え済み(2026-08-02)**: `public/favicon.svg`をranobe-dbと同じ黒背景・`M PLUS Rounded 1c`・`#7cd0ff`のデザインのまま文字だけ「ま」に変更。Playwright(Google Fontsを読み込んだHTMLに埋め込んでスクリーンショット)で512pxのPNGを生成し、ImageMagickで`favicon.ico`(16/32/48pxマルチサイズ)・`apple-touch-icon.png`(180px)を書き出した。**`og-image.png`はranobe-db由来のまま未差し替え**(`scripts/generate-ogp.mjs`はテキストのみmanga-db向けに書き換え済みだが未実行)
- **`relatedNovelUrl`(ranobe-db相互リンク)は型のみ存在し未実装**
- **雑誌連載媒体データなし**: 出版社は単行本レーベルの粒度のみで、雑誌(週刊少年ジャンプ等)は別途追跡していない
