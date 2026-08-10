#!/usr/bin/env python3
"""日本語版Wikipediaの「Category:漫画作品 (五十音別)」から未登録作品を一括収穫する。

数百〜数千件を追加するための逐次パイプライン。1件ずつ調べる probe.py と違い、
50件まとめて記事本文を取り、作者・掲載誌・出版社・巻数・連載期間・読みまで機械で埋める。
**人(モデル)が書くのは あらすじ と テーマタグ だけ** に絞ってある。

  python3 scripts/bulk.py index                 # カテゴリを舐めて記事一覧+記事長をキャッシュ
  python3 scripts/bulk.py harvest --min-bytes 20000   # 未登録記事の本文を取り pool.json を作る
  python3 scripts/bulk.py next 40               # 次のバッチの要約(digest)を出す
  python3 scripts/bulk.py build annot.json out.json   # digestへの注記を batch.json に変換
  python3 scripts/bulk.py stat                  # 残数

**記事長 >= 20000バイト を品質の下限にしている**。2026-08-09の実測で、20KB未満の層は
掲載誌・作者がInfoboxに揃っている率が下がり、表紙の取れない作品が増える。
"""
import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe import (api, drop_templates, kata_to_hira, normalize,
                   parse_templates, split_names, strip_markup, years_of)
from prep import romaji

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "data" / "source"
STATE = ROOT / "scripts" / ".bulk"
INDEX = STATE / "index.json"
POOL = STATE / "pool.json"
SKIP = STATE / "skip.json"
UA = "manga-db-bulk/1.0 (https://izenmi.github.io/manga-db/)"
import datetime
TODAY = datetime.date.today().isoformat()   # 日付をまたいでも updatedAt がずれないようにする
ROOT_CAT = "Category:漫画作品 (五十音別)"

# あらすじに使う節。上から順に探す。「概要」は制作経緯やメディア展開の話になりがちで
# あらすじの材料にならないことが多いため、導入部よりも後ろに置いている
STORY_SECTIONS = ("あらすじ", "ストーリー", "物語", "作品世界", "設定")
LATE_SECTIONS = ("概要", "作品概要", "内容")


def load(name):
    return json.loads((SRC / f"{name}.json").read_text(encoding="utf-8"))


def norm_name(s):
    return re.sub(r"[\s　・･]", "", unicodedata.normalize("NFKC", s or "")).lower()


def loose_pub(s):
    s = norm_name(s)
    s = re.sub(r"[(（].*?[)）]", "", s)
    return re.sub(r"(株式会社|出版社|社)$", "", s)


# ---------------------------------------------------------------- index

def cmd_index(args):
    STATE.mkdir(exist_ok=True)
    d = api({"action": "query", "list": "categorymembers",
             "cmtitle": ROOT_CAT, "cmlimit": "500", "cmtype": "subcat"})
    subs = [m["title"] for m in d["query"]["categorymembers"]]
    titles = []
    for s in subs:
        cont = None
        while True:
            p = {"action": "query", "list": "categorymembers", "cmtitle": s,
                 "cmlimit": "500", "cmtype": "page"}
            if cont:
                p["cmcontinue"] = cont
            d = api(p) or {}
            titles += [m["title"] for m in d.get("query", {}).get("categorymembers", [])]
            cont = d.get("continue", {}).get("cmcontinue")
            if not cont:
                break
        print(f"  {s}: {len(titles)}", file=sys.stderr)
    titles = list(dict.fromkeys(titles))

    lens = {}
    for i in range(0, len(titles), 50):
        d = api({"action": "query", "prop": "info", "titles": "|".join(titles[i:i + 50])}) or {}
        for p in d.get("query", {}).get("pages", []):
            lens[p["title"]] = p.get("length", 0)
    INDEX.write_text(json.dumps(lens, ensure_ascii=False), encoding="utf-8")
    print(f"subcats={len(subs)} articles={len(titles)} lengths={len(lens)} -> {INDEX}")


# ---------------------------------------------------------------- harvest

def _clean_body(body):
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)      # 編集者向けコメント
    body = re.sub(r"^\{\|.*?^\|\}", "", body, flags=re.S | re.M)  # wikitable(話数一覧など)
    body = drop_templates(body)
    body = re.sub(r"<ref.*?</ref>", "", body, flags=re.S)
    body = re.sub(r"<ref[^>]*/>", "", body)
    body = re.sub(r"^=+.*?=+\s*$", "", body, flags=re.M)   # 小見出しは落とす
    body = re.sub(r"^[*:;#].*$", "", body, flags=re.M)      # 箇条書き(登場人物・話数一覧)も落とす
    # [[ファイル:…|thumb|説明]] は入れ子パイプがあり下のリンク除去では落ちない
    body = re.sub(r"\[\[\s*(?:ファイル|File|画像|Image)\s*:[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]",
                  "", body, flags=re.I)
    body = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]", r"\1", body)
    body = re.sub(r"</?[a-zA-Z][^>]*>", "", body)
    body = body.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", "", body)


def _section(text, name):
    m = re.search(r"^==+\s*" + re.escape(name) + r"\s*==+\s*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    nxt = re.search(r"^==[^=]", rest, re.M)
    return _clean_body(rest[:nxt.start()] if nxt else rest[:5000])


def story_excerpt(text, limit=340):
    """あらすじ節の本文を抜き出す。あらすじを書くための材料であって、そのまま載せない。"""
    for name in STORY_SECTIONS:
        body = _section(text, name)
        if len(body) >= 40:
            return body[:limit]
    # 節が無い記事は導入部を使う。導入部も薄ければ最後に「概要」を見る
    head = re.split(r"^==[^=]", text, maxsplit=1, flags=re.M)[0]
    lead = _clean_body(head)
    if len(lead) >= 150:
        return lead[:limit]
    for name in LATE_SECTIONS:
        body = _section(text, name)
        if len(body) >= 40:
            return (lead + body)[:limit]
    return lead[:limit]


def kana_of(title, text, keep_space=False):
    """記事冒頭の『タイトル』（よみ）から読みを取る。**太字が記事名と一致する場合だけ**採用する。

    probe.py の kana_from_lead は最初に現れた '''…'''（かな） を無条件で拾うため、
    冒頭に読みが無い記事では登場人物の読みを掴んでしまう(『テツぼん』→「せんろてつお」、
    『エリアの騎士』→「さらぶれっど」を実際に踏んだ)。タイトル一致を必須にして防ぐ。
    読みが取れなかった行は NDL(cmd_kana)で補完する。
    """
    want = normalize(title)
    body = drop_templates(text[:12000])
    for m in re.finditer(r"'''\s*([^']{1,60}?)\s*'''[』」]?\s*[（(]([ぁ-ゖァ-ヶー・\s]{2,60})[）)、,]", body):
        if normalize(m.group(1)) != want:
            continue
        kana = kata_to_hira(m.group(2))
        kana = re.sub(r"[、,，].*$", "", kana)          # 「よみ、英題」の並記
        kana = re.sub(r"[・\s　]+", " " if keep_space else "", kana)  # 人物は姓名の区切りを残す
        kana = re.sub(r"[^ぁ-ゖー ]", "", kana).strip()
        if len(kana) >= 2:
            return kana
    m = re.search(r"\{\{読み仮名\|'''([^']*)'''\|([ぁ-ゖァ-ヶー・\s]{2,60})[|}]", text[:6000])
    if m and normalize(m.group(1)) == want:
        k = re.sub(r"[・\s　]+", " " if keep_space else "", kata_to_hira(m.group(2)))
        return re.sub(r"[^ぁ-ゖー ]", "", k).strip()
    # カタカナ・ひらがなだけの題名は、そのまま平仮名にすれば読みになる
    plain = re.sub(r"[\s　・!！?？〜~\-—–、。,.（）()『』「」/【】\[\]]", "", title)
    if plain and re.fullmatch(r"[ぁ-ゖァ-ヴー]+", plain):
        return kata_to_hira(plain)
    return ""


def extract(page_title, text, length):
    t = parse_templates(text)
    manga = (t.get("Manga") or [{}])[0]
    header = (t.get("Header") or [{}])[0]
    if not manga:
        return None
    f = {**header, **manga}

    magazine = strip_markup(f.get("掲載誌", "") or f.get("other_magazine", ""))
    # 「レベルファイブ（原作・監修）」のような役割注記を落としてから分割する
    def names(v):
        v = re.sub(r"[(（][^)）]*[)）]", "", strip_markup(v))
        return [n for n in split_names(v) if n and not re.fullmatch(r"[原作画監修構成脚本協力ほか他・]+", n)]
    authors = names(f.get("作者", "") or f.get("原作", ""))
    artists = names(f.get("作画", ""))
    if not magazine or not (authors or artists):
        return None
    # コミカライズは「作者」が原作者・「作画」が漫画家。作画が無ければ作者が漫画家。
    if artists:
        oa, ar = authors, artists
    else:
        oa, ar = [], authors
    if not ar:
        return None

    start, end, ongoing = years_of(f)
    if not start:
        return None
    vol = strip_markup(f.get("巻数", ""))
    m = re.search(r"(\d+)", vol)
    anime = bool(t.get("TVAnime") or t.get("Anime") or t.get("OVA") or t.get("Movie"))
    novel = bool(t.get("Novel") or t.get("Novel/Header"))

    return {
        "page": page_title,
        "len": length,
        "title": re.sub(r"\s*\([^)]*\)\s*$", "", page_title),
        "kana": kana_of(re.sub(r"\s*\([^)]*\)\s*$", "", page_title), text),
        "oa_names": oa,
        "ar_names": ar,
        "magazine": magazine.split(" / ")[0].strip(),
        "publisher": strip_markup(f.get("出版社", "")).split(" / ")[0].strip(),
        "label": strip_markup(f.get("レーベル", "")).split(" / ")[0].strip(),
        "genre": strip_markup(f.get("ジャンル", "")),
        "start": start, "end": end, "ongoing": ongoing,
        "volumes": int(m.group(1)) if m else None,
        "anime": anime, "novel": novel,
        "url": "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(page_title.replace(" ", "_")),
        "story": story_excerpt(text),
    }


def cmd_harvest(args):
    lens = json.loads(INDEX.read_text(encoding="utf-8"))
    works = load("works")
    have = {normalize(w["title"]) for w in works}
    todo = [t for t, l in sorted(lens.items(), key=lambda x: -x[1])
            if l >= args.min_bytes and normalize(re.sub(r"\s*\([^)]*\)\s*$", "", t)) not in have]
    print(f"対象記事 {len(todo)}件(>= {args.min_bytes}バイト・未登録)", file=sys.stderr)

    pool = json.loads(POOL.read_text(encoding="utf-8")) if POOL.exists() else []
    done_pages = {r["page"] for r in pool}
    todo = [t for t in todo if t not in done_pages]
    if args.limit:
        todo = todo[:args.limit]

    kept = 0
    for i in range(0, len(todo), 50):
        chunk = todo[i:i + 50]
        d = api({"action": "query", "prop": "revisions", "rvprop": "content",
                 "rvslots": "main", "titles": "|".join(chunk)}) or {}
        for pg in d.get("query", {}).get("pages", []):
            try:
                text = pg["revisions"][0]["slots"]["main"]["content"]
            except Exception:
                continue
            r = extract(pg["title"], text, lens.get(pg["title"], 0))
            if r:
                pool.append(r)
                kept += 1
        POOL.write_text(json.dumps(pool, ensure_ascii=False), encoding="utf-8")
        print(f"  {i + len(chunk)}/{len(todo)} 採用累計 {len(pool)}", file=sys.stderr)
        time.sleep(0.2)
    rank(pool)
    POOL.write_text(json.dumps(pool, ensure_ascii=False), encoding="utf-8")
    print(f"pool={len(pool)} (今回 +{kept}) -> {POOL}")


def rank(pool):
    """巻数を第一キーに並べ替える。

    記事のバイト数だけで並べると『魔法科高校の劣等生』『カンピオーネ!』のような
    ラノベ/アニメ主体のフランチャイズ記事(漫画版は全3巻のコミカライズ)が先頭に来てしまう。
    このサイトの主役は連載漫画なので、巻数の多い作品を先に処理する。
    """
    pool.sort(key=lambda r: (-min(r.get("volumes") or 0, 60), -r["len"]))
    for n, r in enumerate(pool, 1):
        r["n"] = n
    return pool


# ---------------------------------------------------------------- resolve

KANA_CACHE = STATE / "kana.json"
PKANA_CACHE = STATE / "person-kana.json"
PKANA = json.loads(PKANA_CACHE.read_text(encoding="utf-8")) if PKANA_CACHE.exists() else {}
NDL_API = "https://ndlsearch.ndl.go.jp/api/opensearch"


def ndl_kana(title):
    """NDLサーチの dcndl:titleTranscription から読みを引く。

    Wikipedia記事の冒頭に『タイトル』（よみ）が無い作品(カタカナ題・欧文題・
    ラノベ主体のフランチャイズ記事)向けの補完。**書誌のdc:titleが一致した項目だけ**採用する。
    検索結果は関連度が低いものも混ざるので(「カンピオーネ!」→サッカーのCD)、
    タイトル一致を必須にしないと無関係な読みを拾う。
    """
    q = urllib.parse.urlencode({"title": title, "cnt": "20"})
    try:
        req = urllib.request.Request(f"{NDL_API}?{q}", headers={"User-Agent": UA})
        xml = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "ignore")
    except Exception:
        return ""
    want = normalize(title)
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        m = re.search(r"<dc:title>(.*?)</dc:title>", item, re.S)
        tr = re.search(r"<dcndl:titleTranscription>(.*?)</dcndl:titleTranscription>", item, re.S)
        if not m or not tr:
            continue
        # 「巨蟲列島 3」のような巻数付き書誌もタイトル一致とみなす
        got = normalize(re.sub(r"[\s　]*\d+$", "", m.group(1)))
        if got != want:
            continue
        kana = kata_to_hira(re.sub(r"[\s　・]", "", tr.group(1)))
        kana = re.sub(r"[^ぁ-ゖー]", "", kana)
        if len(kana) >= 2:
            return kana
    return ""


def cmd_kana(args):
    """pool の kana 欠けを NDL で埋める。work id の生成元なので harvest 後に一度回す。"""
    pool = json.loads(POOL.read_text(encoding="utf-8"))
    cache = json.loads(KANA_CACHE.read_text(encoding="utf-8")) if KANA_CACHE.exists() else {}
    todo = [r for r in pool if not r["kana"] and r["title"] not in cache]
    print(f"kana欠け {len([r for r in pool if not r['kana']])}件 / 未照会 {len(todo)}件", file=sys.stderr)
    for i, r in enumerate(todo, 1):
        cache[r["title"]] = ndl_kana(r["title"])
        if i % 25 == 0:
            KANA_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            print(f"  {i}/{len(todo)}", file=sys.stderr)
        time.sleep(0.3)
    KANA_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    filled = 0
    for r in pool:
        if not r["kana"] and cache.get(r["title"]):
            r["kana"] = cache[r["title"]]
            filled += 1
    POOL.write_text(json.dumps(pool, ensure_ascii=False), encoding="utf-8")
    print(f"補完 {filled}件。残る kana欠け {sum(1 for r in pool if not r['kana'])}件")


def person_index():
    oa = {norm_name(p["name"]): p["id"] for p in load("original-authors")}
    ar = {norm_name(p["name"]): p["id"] for p in load("artists")}
    return oa, ar


def uniq_id(base, taken):
    base = base or "work"
    if base not in taken:
        return base
    for i in range(2, 40):
        c = f"{base}-{i}"
        if c not in taken:
            return c
    return base + "-x"


def ndl_person_kana(name):
    """NDLサーチの dcndl:creatorTranscription から作家の読みを引く。

    Wikipedia に人物記事が無い漫画家(『江戸前の旬』原案の九十九森など)向けの補完。
    書誌の dc:creator は「九十九, 森」形式なので、区切りを落として一致を見る。
    """
    q = urllib.parse.urlencode({"creator": name, "cnt": "20"})
    try:
        req = urllib.request.Request(f"{NDL_API}?{q}", headers={"User-Agent": UA})
        xml = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "ignore")
    except Exception:
        return ""
    want = norm_name(re.sub(r"[,，]", "", name))
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        cr = re.search(r"<dc:creator>(.*?)</dc:creator>", item, re.S)
        tr = re.search(r"<dcndl:creatorTranscription>(.*?)</dcndl:creatorTranscription>", item, re.S)
        if not cr or not tr:
            continue
        if norm_name(re.sub(r"[,，]|\s*\d{4}-\d*", "", cr.group(1))) != want:
            continue
        kana = kata_to_hira(re.sub(r"\s*\d{4}-\d*", "", tr.group(1)))
        kana = re.sub(r"[,，・]+", " ", kana)
        kana = re.sub(r"[^ぁ-ゖー ]", "", kana)
        kana = re.sub(r"\s+", " ", kana).strip()
        if len(kana.replace(" ", "")) >= 2:
            return kana
    return ""


def fetch_person_kana(names):
    """人物記事の冒頭から読みを取る。新規登録する作家のnameKana/id生成に使う。"""
    out = {}
    names = [n for n in names if n]
    for i in range(0, len(names), 20):
        chunk = names[i:i + 20]
        d = api({"action": "query", "prop": "revisions", "rvprop": "content",
                 "rvslots": "main", "redirects": "1", "titles": "|".join(chunk)}) or {}
        norm_map = {x["from"]: x["to"] for x in d.get("query", {}).get("normalized", [])}
        redir = {x["from"]: x["to"] for x in d.get("query", {}).get("redirects", [])}
        pages = {}
        for pg in d.get("query", {}).get("pages", []):
            try:
                pages[pg["title"]] = pg["revisions"][0]["slots"]["main"]["content"]
            except Exception:
                pass
        for n in chunk:
            t = redir.get(norm_map.get(n, n), norm_map.get(n, n))
            text = pages.get(t)
            if text:
                out[n] = kana_of(n, text, keep_space=True)
        time.sleep(0.2)
    # 人物記事が無い/冒頭に読みが無い作家は NDL の書誌から引く
    for n in names:
        if not out.get(n):
            out[n] = PKANA.get(n) if n in PKANA else ndl_person_kana(n)
            PKANA[n] = out[n]
            time.sleep(0.2)
    PKANA_CACHE.write_text(json.dumps(PKANA, ensure_ascii=False), encoding="utf-8")
    return out


def resolve(rows):
    """pool の行に既存エンティティのidを付ける。解決できないものは None のまま。"""
    oa_idx, ar_idx = person_index()
    lbl = {norm_name(x["name"]): x["id"] for x in load("labels")}
    pub = {norm_name(x["name"]): x["id"] for x in load("publishers")}
    pub_loose = {loose_pub(x["name"]): x["id"] for x in load("publishers")}
    taken = {w["id"] for w in load("works")}
    used_person = {**{v: v for v in ar_idx.values()}}

    # 作画家として登録済みの人が別作品では原作者になることがある(『ちるらん』の梅村真也)。
    # original-authors.json と artists.json は別ファイルなので、同じidで両方に登録する
    artists_by_id = {p["id"]: p for p in load("artists")}
    cross = []

    unknown_people = []
    for r in rows:
        r["oa_ids"] = []
        for n in r["oa_names"]:
            key = norm_name(n)
            hit = oa_idx.get(key)
            if hit is None and ar_idx.get(key):
                hit = ar_idx[key]
                cross.append((r, hit, n))
            r["oa_ids"].append(hit)
        r["ar_ids"] = [ar_idx.get(norm_name(n)) for n in r["ar_names"]]
        r["label_id"] = lbl.get(norm_name(r["magazine"]))
        r["pub_id"] = pub.get(norm_name(r["publisher"])) or pub_loose.get(loose_pub(r["publisher"]))
        r["work_id"] = uniq_id(romaji(r["kana"])[:40], taken)
        taken.add(r["work_id"])
        for n, i in zip(r["oa_names"], r["oa_ids"]):
            if i is None:
                unknown_people.append(n)
        for n, i in zip(r["ar_names"], r["ar_ids"]):
            if i is None:
                unknown_people.append(n)

    kana = fetch_person_kana(sorted(set(unknown_people)))
    new_ids = {}          # 同名を同じidにまとめる(『KIPPO』と『女神の鬼』の田中宏)
    for r in rows:
        r["new_people"] = []
        for key in ("oa", "ar"):
            for j, (n, i) in enumerate(zip(r[key + "_names"], r[key + "_ids"])):
                if i is not None:
                    continue
                if n in new_ids:      # 同じバッチに同一人物が2作品で出てくる
                    r[key + "_ids"][j] = new_ids[n]
                    r["new_people"].append({"kind": key, "id": new_ids[n], "name": n,
                                            "kana": kana.get(n, "").replace(" ", "")})
                    continue
                k = kana.get(n, "")
                if k:
                    pid = romaji(k)[:40]          # 「さむら ひろあき」→ samura-hiroaki
                elif re.fullmatch(r"[A-Za-z0-9 .&'\-]+", n):
                    pid = re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")[:40]
                else:
                    # 読み不明。空文字にすると、同じ作品に読み不明が2人いたとき
                    # annot の people 補正がどちらにも当たってしまう(『悪役令嬢は隣国の
                    # 王太子に溺愛される』で原作者のidが作画欄に入った)。一意な仮idを振る
                    pid = uniq_id("needkana", used_person)
                if pid:
                    pid = uniq_id(pid, used_person)
                    used_person[pid] = pid
                    new_ids[n] = pid
                r[key + "_ids"][j] = pid
                r["new_people"].append({"kind": key, "id": pid, "name": n,
                                        "kana": k.replace(" ", "")})
    for r, pid, n in cross:
        p = artists_by_id[pid]
        r["new_people"].append({"kind": "oa", "id": pid, "name": p["name"],
                                "kana": p["nameKana"]})
    return rows


# ---------------------------------------------------------------- next / build

def pending(pool):
    """まだ works.json に入っていない行。タイトル正規化でも突合して重複を防ぐ。"""
    works = load("works")
    have_id = {w["id"] for w in works}
    have_title = {normalize(w["title"]) for w in works}
    skip = set(json.loads(SKIP.read_text(encoding="utf-8"))) if SKIP.exists() else set()
    return [r for r in pool
            if r["page"] not in skip
            and normalize(r["title"]) not in have_title
            and r.get("work_id") not in have_id]


def cmd_next(args):
    pool = json.loads(POOL.read_text(encoding="utf-8"))
    rows = pending(pool)[:args.count]
    rows = resolve(rows)
    for r in rows:
        who = []
        for n, i, kind in ([(n, i, "原") for n, i in zip(r["oa_names"], r["oa_ids"])] +
                           [(n, i, "画") for n, i in zip(r["ar_names"], r["ar_ids"])]):
            new = any(p["id"] == i for p in r["new_people"])
            who.append(f"{kind}{n}={i}{'*' if new else ''}")
        vol = f"{r['volumes']}巻" if r["volumes"] else "巻数不明"
        yr = f"{r['start']}-{r['end'] or ('連載中' if r['ongoing'] else '')}"
        lab = r["label_id"] or f"?{r['magazine']}"
        pb = r["pub_id"] or f"?{r['publisher']}"
        print(f"[{r['n']}] {r['title']} / {r['work_id']} / {r['kana']}")
        print(f"  {' '.join(who)} | 誌:{lab} 版:{pb} | {yr} {vol} | {r['genre'][:30]}")
        print(f"  {r['story'][:260]}")
    miss = [r["n"] for r in rows if not r["label_id"] or not r["pub_id"]]
    print(f"\n-- {len(rows)}件。* は新規人物(kana欠けは要補完)。誌/版が ? の行: {miss}")


def cmd_build(args):
    annot = json.loads(Path(args.annot).read_text(encoding="utf-8"))
    # annot に出てくる行だけ解決する(全件解決すると人物読みの照会が数千件走る)
    want = {a["n"] for a in annot["works"]}
    rows = [r for r in pending(json.loads(POOL.read_text(encoding="utf-8"))) if r["n"] in want]
    pool = {r["n"]: r for r in resolve(rows)}
    existing_ids = {w["id"] for w in load("works")}
    known = {"oa": {p["id"] for p in load("original-authors")},
             "ar": {p["id"] for p in load("artists")}}

    batch = {"newOriginalAuthors": [], "newArtists": [], "newPublishers": [],
             "newLabels": [], "newThemes": [], "newAwards": [], "works": []}
    for x in annot.get("newLabels", []):
        batch["newLabels"].append({
            "id": x["id"], "name": x["name"], "nameKana": x["kana"], "publisherId": x["pub"],
            "description": x["desc"], "externalLinks": {},
            "sourceNote": f"日本語版Wikipediaの当該作品記事および雑誌記事で確認({TODAY}閲覧)。",
            "updatedAt": TODAY})
    # Infoboxが2人を1つの名前として持っている場合(『SHIORI EXPERIENCE』の「長田悠幸 町田一八」)、
    # 片方は new_people に現れないので annot 側で直接足せるようにしておく
    for key, out in (("newArtists", "newArtists"), ("newOriginalAuthors", "newOriginalAuthors")):
        for x in annot.get(key, []):
            batch[out].append({
                "id": x["id"], "name": x["name"], "nameKana": x["kana"],
                "description": x.get("desc", "漫画を手がける漫画家。" if key == "newArtists"
                                      else "漫画の原作を手がける。"),
                "externalLinks": {},
                "sourceNote": f"日本語版Wikipediaの当該作品記事で確認({TODAY}閲覧)。",
                "updatedAt": TODAY})
            known["ar" if key == "newArtists" else "oa"].add(x["id"])
    for x in annot.get("newPublishers", []):
        batch["newPublishers"].append({
            "id": x["id"], "name": x["name"], "nameKana": x["kana"],
            "description": x["desc"], "externalLinks": {},
            "sourceNote": f"日本語版Wikipediaの当該記事で確認({TODAY}閲覧)。",
            "updatedAt": TODAY})

    seen_person, problems = set(), []
    for a in annot["works"]:
        r = pool.get(a["n"])
        if r is None:
            problems.append(f"n={a['n']}: poolに無い(既に登録済みか対象外)")
            continue
        lid = a.get("l") or r["label_id"]
        pid = a.get("p") or r["pub_id"]
        if not lid:
            problems.append(f"n={a['n']} {r['title']}: 掲載誌 {r['magazine']!r} 未解決")
            continue
        if not pid:
            problems.append(f"n={a['n']} {r['title']}: 出版社 {r['publisher']!r} 未解決")
            continue
        syn = a["syn"]
        if not (120 <= len(syn) <= 260):
            problems.append(f"n={a['n']} {r['title']}: あらすじ {len(syn)}字(120-260字にする)")
            continue
        # 私が書く日本語には他言語が紛れ込む(実際に「자ら」「прプロ」を出した)。
        # ハングル・キリル・タイ等は1文字でも即アウト、ラテン文字は作品名で使うので3字以上を見る
        bad = re.findall(r"[가-힣Ѐ-ӿ฀-๿؀-ۿ]", syn)
        if bad or re.search(r"[A-Za-z]{3,}", re.sub(r"[A-Z0-9]{2,}", "", syn)):
            problems.append(f"n={a['n']} {r['title']}: あらすじに他言語混入 {''.join(bad[:5]) or '(欧文)'}")
            continue
        wkana = a.get("kana") or r["kana"]
        if not wkana:
            problems.append(f"n={a['n']} {r['title']}: 読みが取れない(annotの kana で指定)")
            continue
        wid = a.get("id") or r["work_id"]
        if wid in existing_ids:
            problems.append(f"n={a['n']} {r['title']}: work id {wid} が既存と衝突")
            continue
        existing_ids.add(wid)

        # annot の people で読み・idを補正してから、作品側のidリストにも反映する
        fixes = a.get("people") or {}
        for p in r["new_people"]:
            f = fixes.get(p["name"]) or {}
            if f.get("id") and f["id"] != p["id"]:
                for key in ("oa_ids", "ar_ids"):
                    r[key] = [f["id"] if x == p["id"] else x for x in r[key]]
                p["id"] = f["id"]
            if f.get("kana"):
                p["kana"] = f["kana"].replace(" ", "")
            if f.get("name"):
                p["name"] = f["name"]      # Infoboxが実体参照のまま('&#xFA44;澤春人')の場合の直し

        # annot が oa/ar を明示した作品は、Infoboxから拾った人名のうち採用したものだけ登録する
        # (『鬼平犯科帳』の「さいとう・たかを」が「さいとう」「たかを」に割れる等の取り違え対策)
        final_people = set(a.get("oa", r["oa_ids"])) | set(a.get("ar", r["ar_ids"]))
        for p in r["new_people"]:
            if p["id"] not in final_people:
                continue
            # 同一人物が原作者と作画家の両方を兼ねることがある(『Destiny Unchain
            # Online』のヤチモト)。kind ごとに登録済みを数える
            if (p["kind"], p["id"]) in seen_person or p["id"] in known[p["kind"]]:
                continue
            if not p["id"] or p["id"].startswith("needkana") or not p["kana"]:
                problems.append(f"n={a['n']} {r['title']}: 新規人物 {p['name']} の読みが取れない"
                                f'(annotに "people":{{"{p["name"]}":{{"kana":"…","id":"…"}}}} を足す)')
                break
            seen_person.add((p["kind"], p["id"]))
            rec = {"id": p["id"], "name": p["name"], "nameKana": p["kana"],
                   "description": "漫画を手がける漫画家。" if p["kind"] == "ar" else "漫画の原作を手がける。",
                   "externalLinks": {},
                   "sourceNote": f"日本語版Wikipedia『{r['page']}』記事および人物記事で確認({TODAY}閲覧)。",
                   "updatedAt": TODAY}
            batch["newArtists" if p["kind"] == "ar" else "newOriginalAuthors"].append(rec)
        else:
            note = (f"日本語版Wikipedia『{r['page']}』記事({TODAY}閲覧)で"
                    "作者・掲載誌・連載期間・巻数")
            note += "・アニメ化" if r["anime"] else ""
            note += "を確認。あらすじは独自要約(コピペなし)。"
            w = {"id": wid, "title": a.get("title") or r["title"],
                 "titleKana": wkana,
                 "originalAuthorIds": a.get("oa", r["oa_ids"]),
                 "artistIds": a.get("ar", r["ar_ids"]),
                 "publisherId": pid, "labelId": lid, "themeIds": a["th"],
                 "firstPublishedYear": a.get("fy") or r["start"],
                 "status": a.get("status") or ("ongoing" if r["ongoing"] else "completed"),
                 "synopsis": syn,
                 "externalLinks": {"wikipediaUrl": r["url"]},
                 "mediaMix": {"anime": bool(r["anime"]), "novelization": bool(r["novel"])},
                 "sourceNote": note, "updatedAt": TODAY}
            ly = r["end"] if a.get("ly") is None else a["ly"]
            if ly:                       # annot で "ly": 0 と書くと連載終了年を落とせる
                w["latestPublishedYear"] = ly
            if r["volumes"]:
                w["volumeCount"] = r["volumes"]
            batch["works"].append(w)
            continue
        # break した場合(読み欠け)はこの作品を落とす
    # 掲載誌の発行元と作品の出版社が食い違う行を報告する。Infoboxの「出版社」は原作小説の
    # 版元を指していることがある(『鬼平犯科帳』→文藝春秋。漫画はリイド社『コミック乱』)
    lab_pub = {x["id"]: x["publisherId"] for x in load("labels")}
    lab_pub.update({x["id"]: x["publisherId"] for x in batch["newLabels"]})
    mismatch = [f'{w["id"]}: 誌{w["labelId"]}の版元は{lab_pub.get(w["labelId"])} / 作品は{w["publisherId"]}'
                for w in batch["works"] if lab_pub.get(w["labelId"]) != w["publisherId"]]
    # Infoboxの「開始号/終了号」は片方しか埋まっていないことがあり、10巻超の作品が
    # 連載1年で終わったことになる(『ジャジャ』2000-2000で全39巻)。annot の ly で直す
    mismatch += [f'{w["id"]}: {w.get("volumeCount")}巻なのに連載'
                 f'{w["firstPublishedYear"]}-{w.get("latestPublishedYear")}(ly を指定)'
                 for w in batch["works"]
                 if (w.get("volumeCount") or 0) >= 10
                 and w.get("latestPublishedYear", 9999) - w["firstPublishedYear"] < 2]

    Path(args.out).write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"works={len(batch['works'])} artists={len(batch['newArtists'])} "
          f"originalAuthors={len(batch['newOriginalAuthors'])} labels={len(batch['newLabels'])} "
          f"publishers={len(batch['newPublishers'])} -> {args.out}")
    if mismatch:
        print("-- 要確認: 掲載誌の版元と出版社が不一致 --")
        for x in mismatch:
            print(" ", x)
    if problems:
        print("-- 未反映 --")
        for x in problems:
            print(" ", x)


def cmd_skip(args):
    cur = set(json.loads(SKIP.read_text(encoding="utf-8"))) if SKIP.exists() else set()
    pool = {r["n"]: r for r in json.loads(POOL.read_text(encoding="utf-8"))}
    for n in args.n:
        if n in pool:
            cur.add(pool[n]["page"])
    SKIP.write_text(json.dumps(sorted(cur), ensure_ascii=False), encoding="utf-8")
    print(f"skip={len(cur)}")


def cmd_stat(args):
    pool = json.loads(POOL.read_text(encoding="utf-8"))
    rest = pending(pool)
    print(f"works.json={len(load('works'))}  pool={len(pool)}  残り={len(rest)}")
    if rest:
        print(f"次: [{rest[0]['n']}] {rest[0]['title']} ({rest[0]['len']}バイト)")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("index").set_defaults(fn=cmd_index)
    sub.add_parser("kana").set_defaults(fn=cmd_kana)
    h = sub.add_parser("harvest"); h.add_argument("--min-bytes", type=int, default=20000)
    h.add_argument("--limit", type=int, default=0); h.set_defaults(fn=cmd_harvest)
    n = sub.add_parser("next"); n.add_argument("count", type=int, nargs="?", default=40)
    n.set_defaults(fn=cmd_next)
    b = sub.add_parser("build"); b.add_argument("annot"); b.add_argument("out")
    b.set_defaults(fn=cmd_build)
    s = sub.add_parser("skip"); s.add_argument("n", type=int, nargs="+"); s.set_defaults(fn=cmd_skip)
    sub.add_parser("stat").set_defaults(fn=cmd_stat)
    args = ap.parse_args()
    STATE.mkdir(exist_ok=True)
    args.fn(args)


if __name__ == "__main__":
    main()
