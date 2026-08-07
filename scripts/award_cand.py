#!/usr/bin/env python3
"""award_wiki.py の出力(TSV)を prep.py 用の候補ファイルに変換する。

  python3 scripts/award_cand.py aw.tsv dengeki-novel-taisho --title-part 1 \
      [--require-pub] [--start 0] [--limit 50] > cand.tsv

--title-part 1 … タイトル欄が「A / （B）」形式のとき A を採用(応募時タイトル併記ページ)
--title-part 2 … B を採用(刊行時表題が併記されているページ)。B が無ければ A
--require-pub  … 刊行列に西暦が入っている行だけ(=書籍化された作品だけ)を残す
"""
import argparse
import re
import sys


def pick(cell, part):
    xs = []
    for x in cell.split(" / "):
        x = x.strip().strip("/").strip()
        # 「（刊行時表題）」のように全体が括弧で囲まれている場合だけ外す(末尾だけ落とすと
        # 『隙間女（幅広）』のような括弧付きタイトルが壊れる)
        if len(x) > 1 and x[0] in "（(" and x[-1] in "）)":
            x = x[1:-1].strip()
        x = x.strip("『』「」〈〉")
        if x:
            xs.append(x)
    if not xs:
        return ""
    if part == 2 and len(xs) > 1:
        return xs[1]
    return xs[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tsv")
    ap.add_argument("award_id")
    ap.add_argument("--title-part", type=int, default=1)
    ap.add_argument("--require-pub", action="store_true")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=10000)
    ap.add_argument("--base-year", type=int, default=0,
                    help="年の列が『第N回』しか持たないページ用。年 = base-year + (N-1) で補う")
    args = ap.parse_args()

    out = []
    for ln in open(args.tsv, encoding="utf-8"):
        ln = ln.rstrip("\n")
        if ln.startswith("###") or ln.startswith("--") or not ln.strip():
            continue
        f = ln.split("\t")
        if len(f) < 4:
            continue
        if len(f) == 4:
            # 賞の区分列が無いページ(GA文庫大賞など)
            _, ycell, title, author = f
            prize, pub = "", ""
        else:
            _, ycell, prize, title, author = f[0], f[1], f[2], f[3], f[4]
            pub = f[5] if len(f) > 5 else ""
        if "タイトル" in title or "回" in ycell and "第" not in ycell:
            continue
        if args.require_pub and not re.search(r"(19|20)\d{2}年", pub):
            continue
        m = re.search(r"(19|20)\d{2}", ycell)
        year = m.group(0) if m else ""
        if not year and args.base_year:
            mn = re.search(r"\d+", ycell)
            if mn:
                year = str(args.base_year + int(mn.group(0)) - 1)
        t = pick(title, args.title_part)
        a = pick(author, 1)
        if not t or not a or not year:
            continue
        out.append((t, a, prize.replace(" / ", "").strip(), year, args.award_id, pub.strip()))

    for row in out[args.start:args.start + args.limit]:
        print("\t".join(row))
    print(f"-- {len(out)}件中 {args.start}〜{min(args.start+args.limit, len(out))} を出力", file=sys.stderr)


if __name__ == "__main__":
    main()
