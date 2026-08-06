#!/usr/bin/env python3
"""候補タイトルを日本語版Wikipedia APIで一括下調べする。

使い方: python3 scripts/probe.py <candidates.txt> <out.json> [--sleep 0.5] [--workers 4]

candidates.txt は1行1タイトル(空行・# 始まりは無視)。各行について

1. 既存の works.json と正規化タイトルで照合し、登録済みなら DUP として即スキップ
   (詳しく調べる前に弾くことでトークンと時間を節約する)
2. Wikipedia API で記事を検索 → wikitext を取得し、{{Infobox animanga/…}} から
   作者・作画・原作・出版社・掲載誌・レーベル・巻数・連載期間・ジャンル・アニメ化の有無を取り出す
3. 結果を out.json に保存し、標準出力には1行1件のコンパクトなサマリを出す

Wikipedia API は連続アクセスに寛容だが、User-Agent を付けて 0.5 秒程度は空けること。
"""
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "data" / "source"
API = "https://ja.wikipedia.org/w/api.php"
UA = "manga-db-probe/1.0 (https://izenmi.github.io/manga-db/)"


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[(（].*?[)）]", "", s)
    s = re.sub(r"[\s　・･,，.。!！?？'\"“”‘’\[\]「」『』【】/／~〜\-—–_+:：]", "", s)
    return s.lower()


def kata_to_hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def api(params, tries=3):
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt < tries - 1:
                time.sleep(1 + attempt)
                continue
            return None
    return None


def strip_markup(v: str) -> str:
    """wikitext の値から装飾を落として読みやすい文字列にする。"""
    v = re.sub(r"<ref[^>]*?/>", "", v)
    v = re.sub(r"<ref.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"<br\s*/?>", " / ", v, flags=re.I)
    v = re.sub(r"<!--.*?-->", "", v, flags=re.S)
    v = re.sub(r"\{\{(?:仮リンク|Anchors?|要出典|small|Small)\|([^|}]*)[^}]*\}\}", r"\1", v)
    v = re.sub(r"\{\{[^{}]*\}\}", "", v)
    v = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]", r"\1", v)
    v = re.sub(r"</?[a-zA-Z][^>]*>", "", v)
    v = v.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", v).strip(" 　-–—,、")


def split_names(v: str):
    parts = re.split(r"[/、,，・]| / ", v)
    out = []
    for p in parts:
        p = p.strip()
        p = re.sub(r"^(原作|作画|漫画|構成|脚本)[:：]?\s*", "", p)
        if p and len(p) < 30:
            out.append(p)
    return out


def parse_templates(text: str):
    """{{Infobox animanga/... }} を雑にパースして {テンプレ名: {キー: 値}} を返す。"""
    result = {}
    for m in re.finditer(r"\{\{\s*(Infobox animanga/[A-Za-z]+)\s*", text, re.I):
        name = m.group(1).split("/")[-1]
        i = m.end()
        depth = 2
        buf = []
        while i < len(text) and depth > 0:
            if text.startswith("{{", i):
                depth += 2
                buf.append("{{")
                i += 2
                continue
            if text.startswith("}}", i):
                depth -= 2
                if depth <= 0:
                    break
                buf.append("}}")
                i += 2
                continue
            buf.append(text[i])
            i += 1
        body = "".join(buf)
        fields = {}
        depth2 = 0
        cur = ""
        for ch in body:
            if ch == "{" or ch == "[":
                depth2 += 1
            elif ch == "}" or ch == "]":
                depth2 -= 1
            if ch == "|" and depth2 <= 0:
                if "=" in cur:
                    k, _, v = cur.partition("=")
                    fields[k.strip()] = v.strip()
                cur = ""
            else:
                cur += ch
        if "=" in cur:
            k, _, v = cur.partition("=")
            fields[k.strip()] = v.strip()
        result.setdefault(name, []).append(fields)
    return result


YEAR_RE = re.compile(r"(19|20)\d{2}")


START_KEYS = ("発表期間", "開始", "開始号", "開始日", "発表号", "連載期間")
END_KEYS = ("終了", "終了号", "終了日")


def years_of(fields):
    """開始/終了系のフィールドから (開始年, 終了年, 連載中か) を返す。"""
    def years(keys):
        raw = " ".join(strip_markup(fields.get(k, "")) for k in keys)
        return [int(y.group(0)) for y in YEAR_RE.finditer(raw)], raw

    ys, raw_s = years(START_KEYS)
    ye, raw_e = years(END_KEYS)
    volumes = strip_markup(fields.get("巻数", ""))
    ongoing = bool(re.search(r"連載中|継続中|現在", raw_s + raw_e)) or (
        not ye and not volumes.startswith("全"))
    start = min(ys + ye) if (ys or ye) else None
    end = max(ye) if ye else (max(ys) if len(ys) > 1 else None)
    return start, end, ongoing


BOLD = "'" * 3
LEAD_KANA_RE = re.compile(BOLD + r"\s*[^']{1,60}?\s*" + BOLD + r"[』」]?\s*[（(]([ぁ-んァ-ヶー・\s]{2,60})[）)]")


YOMI_RE = re.compile(r"\{\{読み仮名[^|]*\|[^|]*\|([ぁ-んァ-ヶー・\s]{2,60})[|}]")


def drop_templates(text: str) -> str:
    """入れ子の {{ }} をまとめて取り除く。冒頭のInfoboxを飛ばして本文の先頭を見るために使う。"""
    out = []
    depth = 0
    i = 0
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1
            i += 2
            continue
        if text.startswith("}}", i):
            depth = max(0, depth - 1)
            i += 2
            continue
        if depth == 0:
            out.append(text[i])
        i += 1
    return "".join(out)


def kana_from_lead(text):
    """記事冒頭の『タイトル』（よみ）から読みを取り出す。

    DEFAULTSORT は清音・大書き(「むけんのしゆうにん」)なので titleKana には使えない。
    Infobox 内にも '''…'''（かな） の並びがあるため、テンプレートを落としてから探す。
    """
    body = drop_templates(text[:12000])
    m = LEAD_KANA_RE.search(body) or YOMI_RE.search(text[:3000])
    if not m:
        return ""
    return re.sub(r"[\s　・]", "", kata_to_hira(m.group(1)))


def probe_one(i, cand, existing, sleep):
    key = normalize(cand)
    hit = existing.get(key)
    if hit is None:
        for k, wid in existing.items():
            if k and (k in key or key in k) and abs(len(k) - len(key)) <= 2:
                hit = wid
                break
    if hit:
        return {"n": i, "query": cand, "status": "DUP", "existingId": hit}

    search = api({"action": "query", "list": "search", "srsearch": cand,
                  "srlimit": "3", "srnamespace": "0"})
    time.sleep(sleep)
    hits = ((search or {}).get("query") or {}).get("search") or []
    if not hits:
        return {"n": i, "query": cand, "status": "MISS"}

    page_title = None
    for h in hits:
        if normalize(h["title"]) == key or key in normalize(h["title"]):
            page_title = h["title"]
            break
    page_title = page_title or hits[0]["title"]

    if normalize(page_title) in existing:
        return {"n": i, "query": cand, "status": "DUP", "existingId": existing[normalize(page_title)]}

    rev = api({"action": "query", "prop": "revisions", "rvprop": "content",
               "rvslots": "main", "titles": page_title})
    time.sleep(sleep)
    try:
        text = rev["query"]["pages"][0]["revisions"][0]["slots"]["main"]["content"]
    except Exception:
        return {"n": i, "query": cand, "status": "MISS"}

    if re.match(r"^\s*#(REDIRECT|転送)", text, re.I):
        m = re.search(r"\[\[([^\]|]+)", text)
        if m:
            rev = api({"action": "query", "prop": "revisions", "rvprop": "content",
                       "rvslots": "main", "titles": m.group(1)})
            time.sleep(sleep)
            try:
                page_title = m.group(1)
                text = rev["query"]["pages"][0]["revisions"][0]["slots"]["main"]["content"]
            except Exception:
                return {"n": i, "query": cand, "status": "MISS"}

    tpl = parse_templates(text)
    manga = (tpl.get("Manga") or [{}])[0]
    header = (tpl.get("Header") or [{}])[0]

    kana = kana_from_lead(text)
    if not kana:
        m = re.search(r"\{\{DEFAULTSORT:([^}]*)\}\}", text)
        if m:
            kana = re.sub(r"[\s　]", "", kata_to_hira(unicodedata.normalize("NFKC", m.group(1)))).lower()

    start, end, ongoing = years_of(manga)
    volumes = strip_markup(manga.get("巻数", ""))
    vm = re.search(r"(\d+)", volumes)
    label = strip_markup(manga.get("レーベル", ""))

    return {
        "n": i, "query": cand, "status": "OK",
        "page": page_title,
        "kana": kana,
        "genre": strip_markup(header.get("ジャンル", "")),
        "author": strip_markup(manga.get("作者", "")),
        "gengaku": strip_markup(manga.get("原作", "") or manga.get("原作・原案など", "")),
        "sakuga": strip_markup(manga.get("作画", "")),
        "publisher": strip_markup(manga.get("出版社", "")),
        "magazine": strip_markup(manga.get("掲載誌", "")),
        "label": label,
        "volumes": int(vm.group(1)) if vm else None,
        "start": start, "end": end, "ongoing": ongoing,
        "anime": bool(tpl.get("TVAnime") or tpl.get("Anime") or tpl.get("OVA")),
        "novel": bool(tpl.get("Novel") or tpl.get("Novelette")),
        "url": "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(page_title.replace(" ", "_")),
    }


def render(r):
    if r["status"] == "DUP":
        return f"{r['n']}\tDUP\t{r['query']}\t-> {r['existingId']}"
    if r["status"] == "MISS":
        return f"{r['n']}\tMISS\t{r['query']}"
    who = r["author"] or f"原:{r['gengaku']} 画:{r['sakuga']}"
    return (f"{r['n']}\tOK\t{r['page']}\t{r['kana']}\t{who}\t{r['magazine']}\t{r['publisher']}\t"
            f"{r['start']}-{r['end'] or ('連載中' if r['ongoing'] else '')}\t{r['volumes']}巻\t"
            f"{'ｱﾆﾒ' if r['anime'] else ''}\t{r['genre'][:24]}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cand_path, out_path = sys.argv[1], sys.argv[2]
    sleep = float(sys.argv[sys.argv.index("--sleep") + 1]) if "--sleep" in sys.argv else 0.5
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 4

    works = json.load(open(SRC / "works.json", encoding="utf-8"))
    existing = {}
    for w in works:
        existing.setdefault(normalize(w["title"]), w["id"])

    lines = [ln.strip() for ln in open(cand_path, encoding="utf-8")]
    cands = [ln for ln in lines if ln and not ln.startswith("#")]

    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(probe_one, i, c, existing, sleep) for i, c in enumerate(cands, 1)]
        for f in as_completed(futures):
            r = f.result()
            results.append(r)
            print(render(r), flush=True)
    results.sort(key=lambda r: r["n"])

    Path(out_path).write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n",
                              encoding="utf-8")
    n_ok = sum(1 for r in results if r["status"] == "OK")
    n_dup = sum(1 for r in results if r["status"] == "DUP")
    print(f"\n-- OK={n_ok} DUP={n_dup} MISS={len(results)-n_ok-n_dup} -> {out_path}")


if __name__ == "__main__":
    main()
