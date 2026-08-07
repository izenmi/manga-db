#!/usr/bin/env python3
"""prep.py の結果 + 手書きの注釈TSV から apply_batch.py 用の batch.json を組み立てる(manga-db版)。

  python3 scripts/gen_batch.py prep.json anno.tsv batch.json 手塚治虫文化賞

anno.tsv(1行1作品、タブ区切り):
  <n> <themeIds(カンマ区切り)> <あらすじ(自分の言葉で要約)> [<flags>] [<overrides>]
    flags     … a=アニメ化, v=小説化(novelization), o=連載中, x=採用しない,
                n=あらすじの典拠が無く内容未確認
    overrides … title / kana / pub(=publisherId) / label(=labelId) / artist(名前、カンマ区切り) /
                original(=原作者名、カンマ区切り) / vol / year / latest / id / award / result / ayear

ranobe-db版との違い: originalAuthorIds(原作)とartistIds(作画)に分かれ、publisherId(版元)と
labelId(掲載誌)を両方持つ。イラストレーターの概念はない。
"""
import json
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prep import NDL, NS, clean_person, get, hiragana, norm, romaji  # noqa: E402

SRC = Path(__file__).resolve().parent.parent / "public" / "data" / "source"
TODAY = "2026-08-07"
KANA_CACHE = Path(__file__).resolve().parent.parent / ".kana-cache.json"

SOURCE_NOTE = ("作品名・作者・出版社・巻数は国立国会図書館サーチAPI(opensearch)の書誌で、受賞歴は"
               "Wikipedia日本語版「{award}」の受賞作一覧で確認({date}照会)。あらすじは版元の紹介文および"
               "Wikipedia記事を参考にした独自要約(コピペなし)。巻数はNDL収録分に基づく概数。")


def load(name):
    return json.load(open(SRC / f"{name}.json", encoding="utf-8"))


def kana_lookup(name, cache):
    if name in cache:
        return cache[name]
    xml = get(NDL + "?" + urllib.parse.urlencode({"creator": name, "cnt": "10"}), sleep=2)
    time.sleep(1.2)
    got = ""
    if xml:
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            root = None
        if root is not None:
            for item in root.iter("item"):
                cs = [clean_person(n.text) for n in item.findall("dc:creator", namespaces=NS)]
                ts = [clean_person(n.text) for n in item.findall("dcndl:creatorTranscription", namespaces=NS)]
                for c, t in zip(cs, ts):
                    if norm(c) == norm(name) and t:
                        got = hiragana(t).replace(" ", "")
                        break
                if got:
                    break
    cache[name] = got
    return got


def main():
    prep_path, anno_path, out_path = sys.argv[1:4]
    award_name = sys.argv[4] if len(sys.argv) > 4 else "各賞"
    default_pub = sys.argv[5] if len(sys.argv) > 5 else ""
    prep = {r["n"]: r for r in json.load(open(prep_path, encoding="utf-8"))}

    # manga-db は原作者(original-authors.json)と作画(artists.json)が別ファイル
    artists_src, originals_src = load("artists"), load("original-authors")
    publishers, labels = load("publishers"), load("labels")
    themes, works = load("themes"), load("works")
    artist_by_name = {norm(c["name"]): c["id"] for c in artists_src}
    original_by_name = {norm(c["name"]): c["id"] for c in originals_src}
    pub_by_name = {}
    for p in publishers:
        pub_by_name[norm(p["name"])] = p["id"]
        m = re.match(r"^([^（(]+)[（(]([^）)]+)[）)]", p["name"])
        if m:
            pub_by_name.setdefault(norm(m.group(1)), p["id"])
            pub_by_name.setdefault(norm(m.group(2)), p["id"])
    label_by_name = {norm(x["name"]): x["id"] for x in labels}
    theme_ids = {t["id"] for t in themes}
    work_ids = {w["id"] for w in works}
    artist_ids_taken = {c["id"] for c in artists_src}
    original_ids_taken = {c["id"] for c in originals_src}
    cache = json.loads(KANA_CACHE.read_text(encoding="utf-8")) if KANA_CACHE.exists() else {}

    new_artists, new_originals, out_works, problems = [], [], [], []

    def uniq_id(base, taken):
        base = base or "work"
        cand, i = base, 2
        while cand in taken:
            cand = f"{base}-{i}"
            i += 1
        taken.add(cand)
        return cand

    def person_ids_for(names, persons, kind):
        by_name = artist_by_name if kind == "artist" else original_by_name
        taken = artist_ids_taken if kind == "artist" else original_ids_taken
        pool = new_artists if kind == "artist" else new_originals
        desc = "漫画を手がける漫画家。" if kind == "artist" else "漫画の原作を手がける作家。"
        ids = []
        for nm in names:
            nm = re.sub(r"[\s　]+", "", nm)
            key = norm(nm)
            if not key:
                continue
            if key in by_name:
                ids.append(by_name[key])
                continue
            k = (persons.get(nm) or {}).get("kana", "") or kana_lookup(nm, cache)
            base = romaji(k) if k else ""
            if not re.fullmatch(r"[a-z0-9\-]+", base or ""):
                base = "person-" + str(abs(hash(nm)) % 10 ** 6)
            pid = uniq_id(base, taken)
            pool.append({"id": pid, "name": nm, "nameKana": k or nm,
                                 "description": desc,
                                 "externalLinks": {},
                                 "sourceNote": f"国立国会図書館サーチの書誌で確認({TODAY})。",
                                 "updatedAt": TODAY})
            by_name[key] = pid
            ids.append(pid)
        return ids

    for ln in open(anno_path, encoding="utf-8"):
        ln = ln.rstrip("\n")
        if not ln.strip() or ln.startswith("#"):
            continue
        f = ln.split("\t")
        n = int(f[0])
        theme_str = f[1] if len(f) > 1 else ""
        synopsis = f[2] if len(f) > 2 else ""
        flags = f[3] if len(f) > 3 else ""
        ov = {}
        if len(f) > 4 and f[4].strip():
            for kv in f[4].split(";"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    ov[k.strip()] = v.strip()
        if "x" in flags:
            continue
        r = prep.get(n)
        if r is None or not r.get("ndl"):
            problems.append(f"n={n} prep結果なし")
            continue
        nd = r["ndl"]

        title = ov.get("title") or r["title"]
        kana = re.sub(r"[:：].*$", "", ov.get("kana") or r.get("titleKana", ""))
        wid = ov.get("id") or uniq_id(r.get("workId", "").split(":")[0][:48].strip("-"), work_ids)

        persons = {p["name"]: p for p in r.get("persons", [])}
        artists = [x.strip() for x in ov["artist"].split(",")] if ov.get("artist") else [r["author"]]
        originals = [x.strip() for x in ov["original"].split(",")] if ov.get("original") else []
        artist_ids = person_ids_for(artists, persons, "artist")
        original_ids = person_ids_for(originals, persons, "original")

        pub_id = ov.get("pub", "") or pub_by_name.get(
            norm(re.sub(r"\s*[（(].*$", "", nd.get("publisher", "") or "")), "") or default_pub
        if not pub_id:
            problems.append(f"n={n} {title}: 出版社未解決 (NDL='{nd.get('publisher')}')")
            continue
        label_id = ov.get("label", "")
        if label_id and label_id not in {x["id"] for x in labels}:
            # 注釈には雑誌名でも書けるようにする(labelId は230件あって覚えていられないため)
            label_id = label_by_name.get(norm(label_id), "")
        if not label_id:
            label_id = label_by_name.get(norm(nd.get("series", "")), "")
        if not label_id:
            problems.append(f"n={n} {title}: 掲載誌未解決 (NDL series='{nd.get('series')}')")
            continue

        themes_l = [t.strip() for t in theme_str.split(",") if t.strip()]
        bad = [t for t in themes_l if t not in theme_ids]
        if bad:
            problems.append(f"n={n} {title}: 未知のテーマid {bad}")
            continue

        year = int(ov.get("year") or nd.get("firstYear") or r.get("year") or 0) or None
        latest = int(ov.get("latest") or nd.get("lastYear") or 0) or None
        vol = int(ov.get("vol") or nd.get("volumes") or 1)
        award_id = ov.get("award") or r.get("awardId", "")
        ayear = int(ov.get("ayear") or r.get("year") or year or 0)
        result = ov.get("result") or r.get("prize") or "受賞"

        w = {
            "id": wid, "title": title, "titleKana": kana,
            "originalAuthorIds": original_ids, "artistIds": artist_ids,
            "publisherId": pub_id, "labelId": label_id, "themeIds": themes_l,
            "firstPublishedYear": year,
            "latestPublishedYear": latest,
            "status": "ongoing" if "o" in flags else "completed",
            "volumeCount": vol,
            "synopsis": synopsis,
            "awardResults": ([{"awardId": award_id, "year": ayear, "result": result}]
                             if award_id and ayear else []),
            "mediaMix": {"anime": "a" in flags, "novelization": "v" in flags},
            "externalLinks": {},
            "sourceNote": SOURCE_NOTE.format(award=award_name, date=TODAY)
            + ("あらすじの典拠が見つからなかったため、内容の記述は書誌事項から確認できる範囲にとどめている。"
               if "n" in flags else ""),
            "updatedAt": TODAY,
        }
        out_works.append(w)

    KANA_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    batch = {"newOriginalAuthors": new_originals, "newArtists": new_artists,
             "newPublishers": [], "newLabels": [],
             "newThemes": [], "newAwards": [], "works": out_works}
    Path(out_path).write_text(json.dumps(batch, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"works={len(out_works)} newArtists={len(new_artists)} newOriginals={len(new_originals)}")
    for p in problems:
        print("! " + p)


if __name__ == "__main__":
    main()
