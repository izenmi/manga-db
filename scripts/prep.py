#!/usr/bin/env python3
"""受賞作候補の書誌をNDL+楽天からまとめて引き、works.json用のドラフトJSONを組み立てる。

  RAKUTEN_APP_ID=... RAKUTEN_ACCESS_KEY=... \
    python3 scripts/prep.py cand.tsv out.json [--workers 4] [--sleep 2]

cand.tsv は1行1候補のタブ区切り: <タイトル> <著者> <賞ラベル> <受賞年> <awardId>

NDLサーチ(opensearch)から書名・書名読み・著者/イラストレーターとその読み・シリーズ名(レーベル)・
最古刊行年・巻数・ISBNを、楽天ブックスAPIから著者/イラストレーター表記と紹介文(あらすじの下敷き)を取る。
読みが取れるので work id / author id / illustrator id をローマ字で自動採番できる。
紹介文は**要約の下敷きにするだけで転記は禁止**。
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "public" / "data" / "source"
NDL = "https://ndlsearch.ndl.go.jp/api/opensearch"
RAKUTEN = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404"
# 紙の書誌が絶版で拾えない作品でも、電子書籍(Kobo)側には紹介文が残っていることが多い
KOBO = "https://openapi.rakuten.co.jp/services/api/Kobo/EbookSearch/20170426"
NS = {"dc": "http://purl.org/dc/elements/1.1/", "dcndl": "http://ndl.go.jp/dcndl/terms/",
      "dcterms": "http://purl.org/dc/terms/"}

DROP = re.compile(r"[\s　ー～〜~\-−–—・,、.。!！?？:：;；'\"’”“‘()（）\[\]【】<>〈〉《》「」『』/／\\|]")

# ローマ字化(work id / person id の採番用。ヘボン式ベース)
ROMA = {
    "キャ": "kya", "キュ": "kyu", "キョ": "kyo", "シャ": "sha", "シュ": "shu", "ショ": "sho",
    "チャ": "cha", "チュ": "chu", "チョ": "cho", "ニャ": "nya", "ニュ": "nyu", "ニョ": "nyo",
    "ヒャ": "hya", "ヒュ": "hyu", "ヒョ": "hyo", "ミャ": "mya", "ミュ": "myu", "ミョ": "myo",
    "リャ": "rya", "リュ": "ryu", "リョ": "ryo", "ギャ": "gya", "ギュ": "gyu", "ギョ": "gyo",
    "ジャ": "ja", "ジュ": "ju", "ジョ": "jo", "ヂャ": "ja", "ヂュ": "ju", "ヂョ": "jo",
    "ビャ": "bya", "ビュ": "byu", "ビョ": "byo", "ピャ": "pya", "ピュ": "pyu", "ピョ": "pyo",
    "ファ": "fa", "フィ": "fi", "フェ": "fe", "フォ": "fo", "ヴァ": "va", "ヴィ": "vi",
    "ヴェ": "ve", "ヴォ": "vo", "ウィ": "wi", "ウェ": "we", "ウォ": "wo", "ティ": "ti",
    "ディ": "di", "デュ": "dyu", "トゥ": "tu", "ドゥ": "du", "シェ": "she", "ジェ": "je",
    "チェ": "che", "ツァ": "tsa", "ツェ": "tse", "ツォ": "tso",
    "ア": "a", "イ": "i", "ウ": "u", "エ": "e", "オ": "o",
    "カ": "ka", "キ": "ki", "ク": "ku", "ケ": "ke", "コ": "ko",
    "サ": "sa", "シ": "shi", "ス": "su", "セ": "se", "ソ": "so",
    "タ": "ta", "チ": "chi", "ツ": "tsu", "テ": "te", "ト": "to",
    "ナ": "na", "ニ": "ni", "ヌ": "nu", "ネ": "ne", "ノ": "no",
    "ハ": "ha", "ヒ": "hi", "フ": "fu", "ヘ": "he", "ホ": "ho",
    "マ": "ma", "ミ": "mi", "ム": "mu", "メ": "me", "モ": "mo",
    "ヤ": "ya", "ユ": "yu", "ヨ": "yo",
    "ラ": "ra", "リ": "ri", "ル": "ru", "レ": "re", "ロ": "ro",
    "ワ": "wa", "ヲ": "o", "ン": "n",
    "ガ": "ga", "ギ": "gi", "グ": "gu", "ゲ": "ge", "ゴ": "go",
    "ザ": "za", "ジ": "ji", "ズ": "zu", "ゼ": "ze", "ゾ": "zo",
    "ダ": "da", "ヂ": "ji", "ヅ": "zu", "デ": "de", "ド": "do",
    "バ": "ba", "ビ": "bi", "ブ": "bu", "ベ": "be", "ボ": "bo",
    "パ": "pa", "ピ": "pi", "プ": "pu", "ペ": "pe", "ポ": "po",
    "ヴ": "bu", "ァ": "a", "ィ": "i", "ゥ": "u", "ェ": "e", "ォ": "o",
    "ャ": "ya", "ュ": "yu", "ョ": "yo",
}


def kata(s):
    """ひらがな→カタカナ。"""
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)


def romaji(kana_str):
    s = kata(unicodedata.normalize("NFKC", kana_str or ""))
    out, i = [], 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ROMA:
            out.append(ROMA[two]); i += 2; continue
        c = s[i]
        if c == "ッ":
            nxt = s[i + 1:i + 3]
            r = ROMA.get(nxt) or ROMA.get(s[i + 1:i + 2]) or ""
            if r:
                out.append(r[0])
            i += 1; continue
        if c == "ー":
            i += 1; continue
        if c in ROMA:
            out.append(ROMA[c]); i += 1; continue
        if re.match(r"[a-zA-Z0-9]", c):
            out.append(c.lower()); i += 1; continue
        if c in " 　・=＝":
            out.append("-"); i += 1; continue
        i += 1
    r = "".join(out)
    r = re.sub(r"-{2,}", "-", r).strip("-")
    return r


def hiragana(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in unicodedata.normalize("NFKC", s or ""))


def norm(s):
    return DROP.sub("", unicodedata.normalize("NFKC", s or "").lower())


def get(url, tries=4, sleep=2.0):
    wait = sleep
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "ranobe-db-prep/1.0",
                "Referer": "https://izenmi.github.io/ranobe-db/",
                # 楽天APIは Referer だけでなく Origin も一致していないと403を返す(実際に踏んだ)
                "Origin": "https://izenmi.github.io",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                wait *= 2
                time.sleep(wait)
                continue
            return None
        except Exception:
            if attempt < tries - 1:
                time.sleep(wait)
                continue
            return None
    return None


def text(el, path):
    n = el.find(path, namespaces=NS)
    return (n.text or "").strip() if n is not None and n.text else ""


def clean_person(s):
    """「川崎, 美羽, 1982-」→「川崎美羽」。"""
    s = re.sub(r",\s*\d{4}-?\d{0,4}", "", s or "")
    return s.replace(",", "").replace(" ", "").strip()


def ndl_lookup(title, author, sleep):
    q = {"title": title, "cnt": "50"}
    if author:
        q["creator"] = author
    xml = get(NDL + "?" + urllib.parse.urlencode(q), sleep=sleep)
    if not xml:
        return None
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    key = norm(title)
    hits = []
    for item in root.iter("item"):
        cats = [(c.text or "") for c in item.findall("category")]
        if "図書" not in cats:
            continue
        t = text(item, "dc:title")
        nt = norm(t)
        if not nt or (key not in nt and nt not in key):
            continue
        creators = [clean_person(n.text) for n in item.findall("dc:creator", namespaces=NS)]
        trans = [clean_person(n.text) for n in item.findall("dcndl:creatorTranscription", namespaces=NS)]
        vol = text(item, "dcndl:volume")
        year = None
        for p in ("dcterms:issued", "dc:date"):
            m = re.search(r"(19|20)\d{2}", text(item, p))
            if m:
                year = int(m.group(0)); break
        isbn = ""
        for n in item.findall("dc:identifier", namespaces=NS):
            if n.get("{http://www.w3.org/2001/XMLSchema-instance}type") == "dcndl:ISBN":
                d = re.sub(r"[^0-9Xx]", "", n.text or "")
                if re.fullmatch(r"97[89]\d{10}", d):
                    isbn = d
        desc = " ".join((n.text or "") for n in item.findall("description")) + \
               " ".join((n.text or "") for n in item.findall("dc:description", namespaces=NS))
        resp = ""
        m = re.search(r"責任表示：([^<]+)", desc)
        if m:
            resp = m.group(1).strip()
        hits.append({
            "title": t, "kana": text(item, "dcndl:titleTranscription"),
            "creators": creators, "trans": trans, "resp": resp,
            "series": text(item, "dcndl:seriesTitle"),
            "publisher": text(item, "dc:publisher"),
            "vol": vol, "year": year, "isbn": isbn,
        })
    if not hits:
        return None
    years = [h["year"] for h in hits if h["year"]]
    vols = []
    for h in hits:
        d = re.sub(r"[^0-9]", "", unicodedata.normalize("NFKC", h["vol"] or ""))
        if d:
            vols.append(int(d[:3]))
    base = min(hits, key=lambda h: (h["year"] or 9999, len(h["title"])))
    series = [h["series"] for h in hits if h["series"]]
    return {
        "ndlTitle": base["title"], "kana": base["kana"], "creators": base["creators"],
        "trans": base["trans"], "resp": base["resp"],
        "series": max(set(series), key=series.count) if series else "",
        "publisher": base["publisher"],
        "firstYear": min(years) if years else None,
        "lastYear": max(years) if years else None,
        "volumes": max(vols) if vols else len(hits),
        "editions": len(hits), "isbn": base["isbn"],
    }


def kobo_lookup(title, author, app_id, key, sleep):
    if not app_id:
        return None
    # Kobo APIは title ではなく keyword で引く(title を渡すと wrong_parameter になる)
    p = {"applicationId": app_id, "accessKey": key, "format": "json", "keyword": title, "hits": 20}
    body = get(KOBO + "?" + urllib.parse.urlencode(p), sleep=sleep)
    if not body:
        return None
    try:
        items = [i["Item"] for i in json.loads(body).get("Items", [])]
    except Exception:
        return None
    key_n = norm(title)
    best = None
    for it in items:
        nt = norm(it.get("title", ""))
        if not nt:
            continue
        if not (nt == key_n or (len(key_n) >= 6 and key_n in nt) or (len(nt) >= 6 and nt in key_n)):
            continue
        if author and author not in (it.get("author") or "").replace("　", "").replace(" ", ""):
            continue
        cap = re.sub(r"<[^>]+>", "", it.get("itemCaption") or "")
        cap = re.sub(r"\s+", " ", cap).strip()
        if best is None or len(cap) > len(best[1]):
            best = (it, cap)
    if not best:
        return None
    it, cap = best
    return {"rakutenTitle": it.get("title", ""), "author": it.get("author", ""),
            "publisher": it.get("publisherName", ""), "size": "kobo",
            "sales": it.get("salesDate", ""), "caption": cap}


def rakuten_lookup(title, author, app_id, key, sleep):
    if not app_id:
        return None
    p = {"applicationId": app_id, "accessKey": key, "format": "json",
         "title": title, "hits": 5, "sort": "+releaseDate"}
    if author:
        p["author"] = author
    body = get(RAKUTEN + "?" + urllib.parse.urlencode(p), sleep=sleep)
    if not body:
        return None
    try:
        data = json.loads(body)
    except Exception:
        return None
    items = [i["Item"] for i in data.get("Items", [])]
    # タイトルが一致しない商品(『空の彼方』に対する『大空の彼方へ』など)を拾わないよう照合する
    key = norm(title)
    cands = []
    for it in items:
        nt = norm(it.get("title", ""))
        if not nt:
            continue
        # 短いタイトルの部分一致は別作品を拾いやすい(『空の彼方』→『大空の彼方へ』)ので
        # 完全一致か、6文字以上での包含に限る
        ok = nt == key or (len(key) >= 6 and key in nt) or (len(nt) >= 6 and nt in key)
        if not ok:
            continue
        if author and author not in (it.get("author") or "").replace("　", "").replace(" ", ""):
            continue
        cands.append(it)
    if not cands:
        return None
    # 紹介文が入っている巻を優先する(1巻は空でも続巻に入っていることがある)
    it = max(cands, key=lambda x: len(x.get("itemCaption") or ""))
    cap = re.sub(r"<[^>]+>", "", it.get("itemCaption") or "")
    cap = re.sub(r"\s+", " ", cap).strip()
    return {"rakutenTitle": it.get("title", ""), "author": it.get("author", ""),
            "publisher": it.get("publisherName", ""), "size": it.get("size", ""),
            "sales": it.get("salesDate", ""), "caption": cap}


WIKI_API = "https://ja.wikipedia.org/w/api.php"


def wiki_lookup(title, sleep):
    """Wikipedia記事の導入部(節0)の wikitext を取り、Infobox の項目と冒頭文を返す。

    冒頭文は**あらすじを自分の言葉で要約するための下敷き**であって、転記は禁止。
    """
    p = {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
         "rvsection": "0", "format": "json", "formatversion": "2", "redirects": "1",
         "titles": title}
    body = get(WIKI_API + "?" + urllib.parse.urlencode(p), sleep=sleep)
    if not body:
        return None
    try:
        pages = json.loads(body)["query"]["pages"]
    except Exception:
        return None
    if not pages or pages[0].get("missing"):
        # 記事名の全角/半角括弧などのゆれで直接引けないことがあるので検索で拾い直す
        sp = {"action": "query", "list": "search", "srsearch": title, "srlimit": "3",
              "format": "json", "formatversion": "2"}
        sb = get(WIKI_API + "?" + urllib.parse.urlencode(sp), sleep=sleep)
        hit = ""
        if sb:
            try:
                for s in json.loads(sb)["query"]["search"]:
                    if norm(s["title"]) == norm(title):
                        hit = s["title"]
                        break
            except Exception:
                hit = ""
        if not hit:
            return None
        p["titles"] = hit
        body = get(WIKI_API + "?" + urllib.parse.urlencode(p), sleep=sleep)
        try:
            pages = json.loads(body)["query"]["pages"]
        except Exception:
            return None
        if not pages or pages[0].get("missing"):
            return None
    try:
        wt = pages[0]["revisions"][0]["slots"]["main"]["content"]
    except Exception:
        return None
    fields = {}
    for m in re.finditer(r"^\s*\|\s*([^=|\n]+?)\s*=\s*([^\n]*)$", wt, flags=re.M):
        fields[m.group(1).strip()] = m.group(2).strip()

    def f(*keys):
        for k in keys:
            for name, v in fields.items():
                if k in name and v:
                    return strip_wiki(v)
        return ""

    body_txt = re.sub(r"\{\{[^{}]*\}\}", "", re.sub(r"\{\{[^{}]*\{\{[^{}]*\}\}[^{}]*\}\}", "", wt))
    body_txt = re.sub(r"^\s*\{\|.*?^\s*\|\}", "", body_txt, flags=re.S | re.M)
    body_txt = strip_wiki(body_txt)
    body_txt = re.sub(r"^[\s|!].*$", "", body_txt, flags=re.M)
    body_txt = re.sub(r"\s{2,}", " ", body_txt).strip()
    # あらすじは導入部ではなく本文の節にあることが多いので、平文抽出でその節だけ拾う
    story = ""
    ep = {"action": "query", "prop": "extracts", "explaintext": "1", "format": "json",
          "formatversion": "2", "redirects": "1", "titles": pages[0].get("title", title)}
    eb = get(WIKI_API + "?" + urllib.parse.urlencode(ep), sleep=sleep)
    if eb:
        try:
            ex = json.loads(eb)["query"]["pages"][0].get("extract", "")
        except Exception:
            ex = ""
        m = re.search(r"\n=+ *(あらすじ|ストーリー|概要|物語|作品概要)[^\n=]* *=+\n+(.+?)(?=\n=+ |\Z)", ex, flags=re.S)
        if m:
            story = re.sub(r"\s+", " ", m.group(2)).strip()

    return {
        "pageTitle": pages[0].get("title", ""),
        "story": story[:500],
        "illust": f("イラスト", "挿絵", "画"),
        "label": f("レーベル", "掲載誌"),
        "volumes": f("巻数", "冊数"),
        "genre": f("ジャンル"),
        "author": f("著者", "作者"),
        "intro": body_txt[:400],
    }


def strip_wiki(s):
    s = re.sub(r"<ref[^>/]*/>", "", s)
    s = re.sub(r"<ref.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    return re.sub(r"\s{2,}", " ", s).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cand")
    ap.add_argument("out")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--sleep", type=float, default=2.0)
    ap.add_argument("--chars", type=int, default=200)
    ap.add_argument("--force-rakuten", action="store_true", help="refill時に楽天を引き直す")
    ap.add_argument("--force-wiki", action="store_true", help="refill時にWikipediaを引き直す")
    ap.add_argument("--refill", action="store_true", help="既存のout.jsonの欠損だけを逐次で引き直す")
    args = ap.parse_args()

    app_id = os.environ.get("RAKUTEN_APP_ID", "")
    key = os.environ.get("RAKUTEN_ACCESS_KEY", "")

    rows = []
    for ln in open(args.cand, encoding="utf-8"):
        ln = ln.rstrip("\n")
        if not ln.strip() or ln.startswith("#"):
            continue
        f = ln.split("\t")
        rows.append({"title": f[0].strip(), "author": f[1].strip() if len(f) > 1 else "",
                     "prize": f[2].strip() if len(f) > 2 else "",
                     "year": f[3].strip() if len(f) > 3 else "",
                     "awardId": f[4].strip() if len(f) > 4 else ""})

    def one(i, r):
        surname = re.split(r"[ 　]", r["author"])[0] if r["author"] else ""
        nd = ndl_lookup(r["title"], surname, args.sleep)
        time.sleep(args.sleep)
        rk = rakuten_lookup(r["title"], surname, app_id, key, args.sleep)
        time.sleep(args.sleep)
        wk = wiki_lookup(r["title"], args.sleep)
        out = {"n": i, **r, "ndl": nd, "rakuten": rk, "wiki": wk}
        if nd:
            out["workId"] = romaji(nd["kana"])[:60].strip("-")
            out["titleKana"] = hiragana(nd["kana"]).replace(" ", "")
            persons = []
            for name, tr in zip(nd["creators"], nd["trans"]):
                persons.append({"name": name, "kana": hiragana(tr).replace(" ", ""), "id": romaji(tr)})
            out["persons"] = persons
        return out

    if args.refill and Path(args.out).exists():
        # 並行実行でWikipedia/NDLが弾かれた分だけを、逐次でゆっくり引き直す
        results = json.load(open(args.out, encoding="utf-8"))
        for r in results:
            if args.force_wiki or not r.get("wiki"):
                r["wiki"] = wiki_lookup(r["title"], args.sleep)
                time.sleep(args.sleep)
                if not r["wiki"]:
                    # 副題込みだと記事名と一致しないことが多いので、主題だけでも引いてみる
                    short = re.split(r"[ 　:：\-–—~〜～]", r["title"])[0].strip()
                    if len(short) >= 4 and short != r["title"]:
                        r["wiki"] = wiki_lookup(short, args.sleep)
                        time.sleep(args.sleep)
            if not r.get("ndl"):
                short = re.split(r"[ 　:：\-–—~〜～]", r["title"])[0]
                if len(short) >= 4:
                    nd = ndl_lookup(short, re.split(r"[ 　]", r["author"])[0], args.sleep)
                    time.sleep(args.sleep)
                    if nd:
                        r["ndl"] = nd
                        r["workId"] = romaji(nd["kana"])[:60].strip("-")
                        r["titleKana"] = hiragana(nd["kana"]).replace(" ", "")
                        r["persons"] = [{"name": nm, "kana": hiragana(tr).replace(" ", ""), "id": romaji(tr)}
                                        for nm, tr in zip(nd["creators"], nd["trans"])]
            if args.force_rakuten or not (r.get("rakuten") or {}).get("caption"):
                short = re.split(r"[:：\-–—~〜～]", r["title"])[0].strip()
                rk = rakuten_lookup(short, re.split(r"[ 　]", r["author"])[0], app_id, key, args.sleep)
                time.sleep(args.sleep)
                if not (rk or {}).get("caption"):
                    rk = rakuten_lookup(short, "", app_id, key, args.sleep) or rk
                    time.sleep(args.sleep)
                if not (rk or {}).get("caption"):
                    surname = re.split(r"[ 　]", r["author"])[0]
                    rk = (kobo_lookup(short, surname, app_id, key, args.sleep)
                          or kobo_lookup(short, "", app_id, key, args.sleep) or rk)
                    time.sleep(args.sleep)
                if rk and rk.get("caption"):
                    r["rakuten"] = rk
        emit(results, args)
        return

    results = [None] * len(rows)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(one, i, r): i for i, r in enumerate(rows)}
        for f in futs:
            pass
        for f, i in futs.items():
            results[i] = f.result()

    emit(results, args)


def emit(results, args):
    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    for r in results:
        nd, rk, wk = r.get("ndl"), r.get("rakuten"), r.get("wiki")
        if not nd:
            print(f"{r['n']}\tMISS\t{r['title']}\t{r['author']}")
            continue
        cap = (wk or {}).get("story", "") or (rk or {}).get("caption", "") or (wk or {}).get("intro", "")
        if wk and norm(wk.get("pageTitle", "")) != norm(r["title"]):
            cap = f"[記事:{wk.get('pageTitle','')}] " + cap
        print("\t".join([
            str(r["n"]), r.get("workId", ""), nd["ndlTitle"], out_kana(r),
            "/".join(p["name"] + ":" + p["id"] for p in r.get("persons", [])),
            ((rk or {}).get("author", "") or (wk or {}).get("illust", "")),
            nd["series"] or nd["publisher"],
            str(nd["firstYear"]), f"v{nd['volumes']}", cap[:args.chars],
        ]))
    n_ok = sum(1 for r in results if r.get("ndl"))
    print(f"-- OK={n_ok} MISS={len(results)-n_ok} -> {args.out}", file=sys.stderr)


def out_kana(r):
    return r.get("titleKana", "")


if __name__ == "__main__":
    main()
