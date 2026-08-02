#!/usr/bin/env python3
"""汎用バッチ反映スクリプト。
使い方: python3 scripts/apply_batch.py <batch.json>

batch.json の形式:
{
  "newOriginalAuthors": [...],
  "newArtists": [...],
  "newPublishers": [...],
  "newThemes": [...],
  "newAwards": [...],
  "works": [...]
}

- 新規id(originalAuthor/artist/publisher/theme/award)は既存と重複していればスキップ
- work は originalAuthorIds/artistIds/publisherId/themeIds/awardResults[].awardId が
  (既存 + このバッチで追加される新規id) の中に存在するか検証し、
  存在しない参照があればその work 自体を反映せずレポートする(artistIdsが空の場合も却下)
- 既存work idと重複するworkはスキップ
"""
import json
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "public" / "data" / "source"

def load(name):
    with open(SRC / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)

def save(name, data):
    with open(SRC / f"{name}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

def main():
    if len(sys.argv) != 2:
        print("usage: apply_batch.py <batch.json>")
        sys.exit(1)

    with open(sys.argv[1], encoding="utf-8") as f:
        batch = json.load(f)

    original_authors = load("original-authors")
    artists = load("artists")
    publishers = load("publishers")
    themes = load("themes")
    awards = load("awards")
    works = load("works")

    original_author_ids = {a["id"] for a in original_authors}
    artist_ids = {a["id"] for a in artists}
    publisher_ids = {p["id"] for p in publishers}
    theme_ids = {t["id"] for t in themes}
    award_ids = {a["id"] for a in awards}
    work_ids = {w["id"] for w in works}

    report = {"added": {}, "skipped_duplicates": {}, "rejected_works": []}

    def add_new(pool, id_set, key_name, kind):
        added, skipped = [], []
        for item in batch.get(key_name, []):
            if item["id"] in id_set:
                skipped.append(item["id"])
            else:
                pool.append(item)
                id_set.add(item["id"])
                added.append(item["id"])
        report["added"][kind] = added
        report["skipped_duplicates"][kind] = skipped

    add_new(original_authors, original_author_ids, "newOriginalAuthors", "original_authors")
    add_new(artists, artist_ids, "newArtists", "artists")
    add_new(publishers, publisher_ids, "newPublishers", "publishers")
    add_new(themes, theme_ids, "newThemes", "themes")
    add_new(awards, award_ids, "newAwards", "awards")

    added_works = []
    for w in batch.get("works", []):
        if w["id"] in work_ids:
            report["rejected_works"].append({"id": w["id"], "reason": "duplicate work id"})
            continue

        missing = []
        if not w.get("artistIds"):
            missing.append("artistIds:empty")
        for oaid in w.get("originalAuthorIds", []):
            if oaid not in original_author_ids:
                missing.append(f"originalAuthorId:{oaid}")
        for aid in w.get("artistIds", []):
            if aid not in artist_ids:
                missing.append(f"artistId:{aid}")
        pid = w.get("publisherId")
        if pid and pid not in publisher_ids:
            missing.append(f"publisherId:{pid}")
        for tid in w.get("themeIds", []):
            if tid not in theme_ids:
                missing.append(f"themeId:{tid}")
        for ar in w.get("awardResults", []):
            if ar.get("awardId") not in award_ids:
                missing.append(f"awardId:{ar.get('awardId')}")

        if missing:
            report["rejected_works"].append({"id": w["id"], "reason": f"missing refs: {missing}"})
            continue

        works.append(w)
        work_ids.add(w["id"])
        added_works.append(w["id"])

    report["added"]["works"] = added_works

    save("original-authors", original_authors)
    save("artists", artists)
    save("publishers", publishers)
    save("themes", themes)
    save("awards", awards)
    save("works", works)

    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
