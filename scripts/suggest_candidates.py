#!/usr/bin/env python3
"""楽天ブックスのカタログから「実在していて、まだ works.json に無い」候補を列挙する。

  RAKUTEN_APP_ID=xxx RAKUTEN_ACCESS_KEY=yyy \
    python3 scripts/suggest_candidates.py out.json [--pages 5] [--sort sales] [--keyword ネットワーク]

**候補を自分で思いつくのをやめるための道具。** 思いついた書名を並べて調べる方式だと、
実在しないタイトルばかりになり(2026-08-08にtech-dbで93件中59件がMISS)、しかも部分一致で
無関係な本を拾う(『ルーティングの教科書』→『オウンドメディアリクルーティングの教科書』)。
カタログ側に列挙させれば、出てくるものは全て実在し、重複も事前に除ける。

game-db の scripts/suggest-candidates.mjs(IGDBに未登録タイトルを列挙させる)と同じ発想で、
書籍サイトは楽天ブックスがその役目を果たす。

**booksGenreId による絞り込みは当てにならない**(実測)。「パソコン・システム開発」を
指定しても『るるぶ』『うんこドリル』が混ざる。ジャンルは足がかりにとどめ、
最終的な選別は必ず人間がタイトルを見て行うこと。
"""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "public" / "data" / "source"
API = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404"
REFERER = "https://izenmi.github.io/manga-db/"
GENRES = ["001001"]          # このサイトが対象とする楽天ブックスのジャンル
WORKS_KEY = "works.json"

APP = os.environ.get("RAKUTEN_APP_ID")
KEY = os.environ.get("RAKUTEN_ACCESS_KEY")
if not APP or not KEY:
    sys.exit("RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が必要です。")


def norm(x: str) -> str:
    return re.sub(r"[\s　・:：!！?？〜~\-—–ー、。,.（）()『』「」/【】\[\]]", "", x or "").lower()


def fetch(params):
    p = {"applicationId": APP, "accessKey": KEY, "format": "json", "hits": "30"}
    p.update(params)
    req = urllib.request.Request(
        API + "?" + urllib.parse.urlencode(p),
        headers={"Referer": REFERER, "Origin": "https://izenmi.github.io"},
    )
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=45))
        except Exception:
            time.sleep(3 * (attempt + 1))
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--pages", type=int, default=5)
    ap.add_argument("--sort", default="sales")
    ap.add_argument("--keyword", action="append", default=[],
                    help="タイトルに含む語。省略するとジャンル全体を人気順に舐める")
    args = ap.parse_args()

    works = json.load(open(SRC / WORKS_KEY))
    have = {norm(w["title"]) for w in works}

    specs = []
    for g in GENRES:
        if args.keyword:
            specs += [{"booksGenreId": g, "title": k} for k in args.keyword]
        else:
            specs.append({"booksGenreId": g})

    seen, out = set(), []
    for spec in specs:
        for page in range(1, args.pages + 1):
            d = fetch({**spec, "sort": args.sort, "page": str(page)})
            items = d.get("Items", [])
            if not items:
                break
            for it in items:
                i = it["Item"]
                title = re.sub(r"【.*?】", "", i["title"]).strip()
                k = norm(title)
                if not k or k in have or k in seen:
                    continue
                seen.add(k)
                out.append({
                    "title": title,
                    "author": i.get("author", ""),
                    "publisher": i.get("publisherName", ""),
                    "salesDate": i.get("salesDate", ""),
                    "isbn": i.get("isbn", ""),
                    "caption": (i.get("itemCaption") or "")[:400],
                    "genre": i.get("booksGenreId", ""),
                })
            time.sleep(1.2)
    json.dump(out, open(args.out, "w"), ensure_ascii=False, indent=1)
    print(f"未登録候補 {len(out)}件 -> {args.out}")
    print("※ ジャンル指定は当てにならないので、必ずタイトルを目視して選別すること。")


if __name__ == "__main__":
    main()
