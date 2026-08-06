#!/usr/bin/env python3
"""probe.py の下調べ結果と手書きの注釈を合成して apply_batch.py 用の batch.json を作る。

使い方: python3 scripts/merge_batch.py <probe.json> <annot.json> <batch.json>

annot.json(キーを短くしてあるのは手書き量を減らすため):
{
  "newOriginalAuthors": [{"id":..,"name":..,"kana":..,"desc":..}],
  "newArtists":         [同上],
  "newPublishers":      [{"id":..,"name":..,"kana":..,"desc":..}],
  "newLabels":          [{"id":..,"name":..,"kana":..,"pub":"publisherId","desc":..}],
  "newThemes":          [{"id":..,"name":..,"desc":..}],
  "newAwards":          [{"id":..,"name":..,"desc":..}],
  "works": [
    {"n": 3,                    # probe.json の候補番号
     "id": "mugen-no-junin",
     "oa": [],                  # originalAuthorIds(原作つき作品のみ)
     "ar": ["samura-hiroaki"],  # artistIds(必須)
     "p":  "kodansha",          # publisherId。省略時は probe の出版社名から自動解決
     "l":  "monthly-afternoon", # labelId。省略時は probe の掲載誌名から自動解決
     "th": ["jidaigeki"],       # themeIds
     "syn": "…",                # 150〜250字のあらすじ(自分の言葉で)
     "title": "…", "kana": "…", # probe の値を上書きしたいときだけ
     "vol": 30, "status": "completed", "fy": 1993, "ly": 2012,
     "novel": true,             # ノベライズの有無(既定は probe の判定)
     "awards": [{"awardId":..,"year":..,"result":..}]}
  ]
}

タイトル・読み・連載年・巻数・アニメ化・Wikipedia URL・sourceNote は probe.json から機械的に埋める。
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "data" / "source"
TODAY = "2026-08-06"


def norm_name(s: str) -> str:
    return re.sub(r"[\s　・･]", "", unicodedata.normalize("NFKC", s or "")).lower()


def loose(s: str) -> str:
    s = norm_name(s)
    s = re.sub(r"[(（].*?[)）]", "", s)
    return re.sub(r"(株式会社|出版社|社)$", "", s)


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    probe = {r["n"]: r for r in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))}
    annot = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    out_path = Path(sys.argv[3])

    publishers = json.loads((SRC / "publishers.json").read_text(encoding="utf-8"))
    labels = json.loads((SRC / "labels.json").read_text(encoding="utf-8"))

    pub_by = {norm_name(p["name"]): p["id"] for p in publishers}
    pub_loose = {loose(p["name"]): p["id"] for p in publishers}
    label_by = {norm_name(l["name"]): l["id"] for l in labels}

    batch = {"newOriginalAuthors": [], "newArtists": [], "newPublishers": [],
             "newLabels": [], "newThemes": [], "newAwards": [], "works": []}

    def person(x):
        return {"id": x["id"], "name": x["name"], "nameKana": x["kana"],
                "description": x["desc"], "externalLinks": {},
                "sourceNote": x.get("note", "日本語版Wikipediaの当該作品記事および人物記事で確認。"),
                "updatedAt": TODAY}

    for x in annot.get("newOriginalAuthors", []):
        batch["newOriginalAuthors"].append(person(x))
    for x in annot.get("newArtists", []):
        batch["newArtists"].append(person(x))
    for x in annot.get("newPublishers", []):
        d = person(x)
        batch["newPublishers"].append(d)
        pub_by[norm_name(x["name"])] = x["id"]
        pub_loose.setdefault(loose(x["name"]), x["id"])
    for x in annot.get("newLabels", []):
        d = person(x)
        d["publisherId"] = x["pub"]
        batch["newLabels"].append(d)
        label_by[norm_name(x["name"])] = x["id"]
    for x in annot.get("newThemes", []):
        batch["newThemes"].append({"id": x["id"], "name": x["name"],
                                   "description": x.get("desc", ""), "updatedAt": TODAY})
    for x in annot.get("newAwards", []):
        batch["newAwards"].append(x)

    problems = []
    for a in annot.get("works", []):
        p = probe.get(a["n"])
        if p is None or p.get("status") != "OK":
            problems.append(f"n={a['n']} ({a.get('id')}): probeにOKの結果がない")
            continue

        pid = a.get("p") or pub_by.get(norm_name(p.get("publisher", ""))) \
            or pub_loose.get(loose(p.get("publisher", "")))
        if not pid:
            problems.append(f"n={a['n']} ({a['id']}): 出版社 {p.get('publisher')!r} を解決できない")
            continue

        magazine = (p.get("magazine") or "").split(" / ")[0].strip()
        lid = a.get("l") or label_by.get(norm_name(magazine))
        if not lid:
            problems.append(f"n={a['n']} ({a['id']}): 掲載誌 {magazine!r} を解決できない")
            continue

        if not a.get("ar"):
            problems.append(f"n={a['n']} ({a['id']}): artistIds が空")
            continue

        fy = a.get("fy") or p.get("start")
        if not fy:
            problems.append(f"n={a['n']} ({a['id']}): 連載開始年が取れない(fy を指定)")
            continue

        status = a.get("status") or ("ongoing" if p.get("ongoing") else "completed")
        w = {
            "id": a["id"],
            "title": a.get("title") or p["page"],
            "titleKana": a.get("kana") or p.get("kana") or "",
            "originalAuthorIds": a.get("oa", []),
            "artistIds": a["ar"],
            "publisherId": pid,
            "labelId": lid,
            "themeIds": a.get("th", []),
            "firstPublishedYear": fy,
            "status": status,
            "synopsis": a.get("syn", ""),
            "externalLinks": {"wikipediaUrl": p["url"]},
            "updatedAt": TODAY,
        }
        ly = a.get("ly") or p.get("end")
        if ly:
            w["latestPublishedYear"] = ly
        vol = a.get("vol") or p.get("volumes")
        if vol:
            w["volumeCount"] = vol
        w["mediaMix"] = {"anime": bool(a.get("anime", p.get("anime"))),
                         "novelization": bool(a.get("novel", p.get("novel")))}
        if a.get("awards"):
            w["awardResults"] = a["awards"]
        if a.get("web"):
            w["webComicSource"] = a["web"]

        note = (f"日本語版Wikipedia『{p['page']}』記事(2026-08-06閲覧)で"
                "作者・掲載誌・連載期間・巻数")
        note += "・アニメ化" if w["mediaMix"]["anime"] else ""
        note += "を確認。あらすじは独自要約(コピペなし)。"
        w["sourceNote"] = a.get("note") or note

        batch["works"].append(w)

    out_path.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"works={len(batch['works'])} originalAuthors={len(batch['newOriginalAuthors'])} "
          f"artists={len(batch['newArtists'])} labels={len(batch['newLabels'])} "
          f"publishers={len(batch['newPublishers'])} -> {out_path}")
    if problems:
        print("-- 未反映 --")
        for x in problems:
            print(" ", x)


if __name__ == "__main__":
    main()
