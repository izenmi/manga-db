#!/usr/bin/env python3
"""Wikipedia日本語版の新人賞ページから受賞作の表を機械的に取り出し、works.json 未登録のものだけを出す。

「受賞作を思いつく」方式は works.json が育つほど DUP ばかりになるので、賞のページの
受賞作一覧テーブルを丸ごと機械展開して既登録を引く。rowspan を展開するので、
「第N回」「大賞/金賞/銀賞」のようにセルが結合された列も各行に補完される。

  python3 scripts/award_wiki.py 電撃小説大賞 --cols 0,2,3,4,5

出力(タブ区切り、未登録のみ): <行番号> <指定列の中身…>
--cols を省略すると全列を出す(列番号を確認したいとき用)。
--all を付けると登録済みも DUP 付きで出す。
"""
import argparse
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "public" / "data" / "source"
API = "https://ja.wikipedia.org/wiki/{}?action=raw"

DROP = re.compile(r"[\s　ー～〜~\-−–—・,、.。!！?？:：;；'\"’”“‘()（）\[\]【】<>〈〉《》「」『』/／\\|]")
TRIM_SUFFIX = re.compile(r"(シリーズ)$")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = DROP.sub("", s)
    return TRIM_SUFFIX.sub("", s)


def fetch(page: str) -> str:
    url = API.format(urllib.parse.quote(page))
    req = urllib.request.Request(url, headers={"User-Agent": "ranobe-db-award/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def clean_cell(s: str) -> str:
    s = re.sub(r"<ref[^>/]*/>", "", s)
    s = re.sub(r"<ref.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\{\{(?:PDFlink|R|Efn|efn|Cite[^}]*)\|[^{}]*\}\}", "", s)
    s = re.sub(r"\{\{nobr\|([^{}]*)\}\}", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " / ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    return re.sub(r"\s{2,}", " ", s).strip()


def split_cells(line: str):
    """1行から (content, rowspan) のリストを取り出す。"""
    line = line.lstrip()
    head = line[:1]
    line = line[1:] if head in "|!" else line
    # 「!!」でのセル分割はヘッダ行だけ。本文行で分けると『青春ラリアット!!』のような
    # タイトルが途中で切れる(実際に踏んだ)
    parts = re.split(r"\|\||!!", line) if head == "!" else line.split("||")
    out = []
    for p in parts:
        rowspan = 1
        # 属性部分(style=... rowspan=...)があれば単一の | で本体と分かれている
        m = re.match(r"^([^|\[\]{}]*=[^|]*)\|(?!\|)(.*)$", p, flags=re.S)
        if m:
            attrs, p = m.group(1), m.group(2)
            r = re.search(r"rowspan\s*=\s*\"?(\d+)", attrs)
            if r:
                rowspan = int(r.group(1))
        out.append((p, rowspan))
    return out


def parse_tables(wikitext: str):
    """wikitable ごとに、rowspan を展開した行(セル文字列のリスト)を返す。"""
    tables = []
    depth = 0
    cur = []
    for line in wikitext.splitlines():
        st = line.strip()
        if st.startswith("{|"):
            depth += 1
            if depth == 1:
                cur = []
                continue
        if depth == 0:
            continue
        if st.startswith("|}"):
            depth -= 1
            if depth == 0:
                tables.append(cur)
            continue
        cur.append(line)

    out = []
    for raw in tables:
        rows, buf = [], []
        for line in raw:
            st = line.strip()
            if st.startswith("|-"):
                if buf:
                    rows.append(buf)
                buf = []
            elif st.startswith("|") or st.startswith("!"):
                buf.append(line)
            elif buf:  # 折り返しの続き行
                buf[-1] += " " + st
        if buf:
            rows.append(buf)

        grid, pending = [], {}
        for buf in rows:
            cells = []
            for line in buf:
                cells.extend(split_cells(line))
            row, col, i = [], 0, 0
            while i < len(cells) or any(v[0] > 0 for v in pending.values()):
                if col in pending and pending[col][0] > 0:
                    n, content = pending[col]
                    row.append(content)
                    pending[col] = (n - 1, content)
                elif i < len(cells):
                    content, rowspan = cells[i]
                    i += 1
                    content = clean_cell(content)
                    row.append(content)
                    if rowspan > 1:
                        pending[col] = (rowspan - 1, content)
                else:
                    break
                col += 1
            if row:
                grid.append(row)
        out.append(grid)
    return out


def parse_lists(wikitext):
    """箇条書き形式(「* [[作品名]]（著者）」)の受賞作一覧を拾う。

    賞のページはテーブルとは限らず、年ごとの見出し+箇条書きで書かれていることも多い
    (日本推理作家協会賞・マンガ大賞・手塚治虫文化賞など)。直近の見出しから年を引き継ぐ。
    """
    rows = []
    year = ""
    section = ""
    for line in wikitext.splitlines():
        st = line.strip()
        m = re.match(r"^=+\s*(.+?)\s*=+$", st)
        if m:
            section = clean_cell(m.group(1))
            y = re.search(r"(18|19|20)\d{2}", section)
            if y:
                year = y.group(0)
            continue
        if not re.match(r"^[*#:;]+\s*", st):
            continue
        body = re.sub(r"^[*#:;]+\s*", "", st)
        y2 = re.match(r"^第?\s*\d+\s*回?[（(]?((18|19|20)\d{2})年", body)
        if y2:
            year = y2.group(1)
        links = re.findall(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", body)
        if not links:
            continue
        title = clean_cell(links[0])
        rest = clean_cell(body)
        # 「作品名』(著者名)」「作品名 - 著者名」など、タイトルの後ろにある人名を拾う
        author = ""
        m2 = re.search(r"[（(]([^）)]{2,20})[）)]", rest)
        if m2 and m2.group(1) != title:
            author = m2.group(1).split("、")[0].split("・作")[0].strip()
        if not author and len(links) > 1:
            author = clean_cell(links[1])
        author = re.sub(r"(作|著|画|漫画|原作)$", "", author).strip()
        rows.append([year, section, title, author, rest[:60]])
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--cols", default="")
    ap.add_argument("--table", type=int, default=None, help="対象テーブルの番号(0始まり)")
    ap.add_argument("--title-col", type=int, default=None, help="重複判定に使う列")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--list", action="store_true", help="表ではなく箇条書き形式のページを解析する")
    args = ap.parse_args()

    works = json.load(open(SRC / "works.json", encoding="utf-8"))
    index = [(norm(w["title"]), w["id"]) for w in works]

    def dup_of(title):
        n = norm(title)
        if not n:
            return None
        for wn, wid in index:
            if wn == n or (len(n) >= 5 and (n in wn or wn in n)):
                return wid
        return None

    wikitext = fetch(args.page)
    tables = [parse_lists(wikitext)] if args.list else parse_tables(wikitext)
    cols = [int(c) for c in args.cols.split(",") if c.strip() != ""]
    auto = not cols

    def detect(header):
        """ヘッダ行から (出力列, タイトル列) を推定する。ページごとに列順が違うため。"""
        pats = [
            ("year", r"回|年度|年"),
            ("prize", r"^賞|賞名|部門"),
            ("title", r"タイトル|作品名|受賞作|書名|題名|^作品|受賞作品"),
            ("author", r"著者|作者|受賞者|ペンネーム|筆名|漫画家|受賞者名"),
            ("pub", r"刊行|出版|備考|発売"),
        ]
        found = {}
        for i, h in enumerate(header):
            h = h.replace(" ", "")
            for key, pat in pats:
                if key not in found and re.search(pat, h):
                    found[key] = i
                    break
        if "title" not in found:
            return None, None
        order = [found[k] for k in ("year", "prize", "title", "author", "pub") if k in found]
        return order, found["title"]

    n_new = n_dup = 0
    for ti, grid in enumerate(tables):
        if args.table is not None and ti != args.table:
            continue
        tcol_auto = 2 if args.list else None
        if args.list:
            cols_t = [0, 1, 2, 3]
        elif auto:
            if not grid:
                continue
            cols_t, tcol_auto = detect(grid[0])
            if cols_t is None:
                continue
        else:
            cols_t = cols
        print(f"### table {ti}  rows={len(grid)}")
        for ri, row in enumerate(grid):
            vals = [row[c] if c < len(row) else "" for c in cols_t] if cols_t else row
            tcol = args.title_col if args.title_col is not None else (
                tcol_auto if tcol_auto is not None else (cols_t[1] if len(cols_t) > 1 else 0))
            title = row[tcol] if tcol < len(row) else ""
            # 「応募時タイトル」「刊行時表題」が併記されるページがあるので、どちらでも重複判定する
            hit = None
            for part in title.split(" / "):
                part = part.strip().strip("（）()")
                if part:
                    hit = hit or dup_of(part)
            if hit:
                n_dup += 1
                if args.all:
                    print(f"{ri}\tDUP\t{title}\t-> {hit}")
            else:
                n_new += 1
                print(f"{ri}\t" + "\t".join(vals))
    print(f"-- new={n_new} dup={n_dup}", file=sys.stderr)


if __name__ == "__main__":
    main()
