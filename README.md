# まんがDB

日本語コミック(漫画)作品を原作者・作画家・出版社(レーベル)・受賞歴・テーマから検索できるファンデータベースです。姉妹サイト[らのべDB](https://izenmi.github.io/ranobe-db/)のコミック版として作成しました。

https://izenmi.github.io/manga-db/

## データについて

`public/data/source/*.json` が一次データです。Wikipedia日本語版などの公開情報を参考に、あらすじ等は独自の文章で要約して作成しています。各ページから参照元のWikipedia記事へリンクしているので、詳細はそちらをご確認ください。データの誤りに気づいた場合はIssueでお知らせください。

`public/data/generated/*.json` はビルド時に `scripts/generate-manifest.mjs` が `source/*.json` から自動生成する非正規化データです(`.gitignore`対象、手で編集しないでください)。

## 開発

```sh
npm install
npm run dev       # http://localhost:5173/manga-db/
npm run build      # 型チェック + データ整合性チェック + ビルド
npm run preview
```

`npm run dev` / `npm run build` の前に `scripts/generate-manifest.mjs` が自動実行され、`source/*.json` 内のid参照(原作者・作画家・出版社・テーマ・アワード)に誤りがあるとビルドが失敗します。

## デプロイ

`main` ブランチへのpushで GitHub Actions (`.github/workflows/deploy.yml`) が自動的にビルドしてGitHub Pagesへ公開します。リポジトリ名を変更する場合は `vite.config.ts` の `base` も合わせて変更してください。
