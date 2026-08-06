#!/usr/bin/env python3
"""probe.json に出てくる人名・掲載誌・出版社が既存エンティティにあるかを一覧する。

使い方: python3 scripts/find_people.py <probe.json>
        python3 scripts/find_people.py --names 沙村広明 中島三千恒

作画家422人・原作者94人の一覧をコンテキストに載せずに既存IDを引くための補助。
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "public" / "data" / "source"


def norm(s: str) -> str:
    return re.sub(r"[\s　・･,，.。]", "", unicodedata.normalize("NFKC", s or "")).lower()


def load(name):
    d = json.loads((SRC / f"{name}.json").read_text(encoding="utf-8"))
    return {norm(x["name"]): x["id"] for x in d}


def split_names(v: str):
    out = []
    for chunk in re.split(r"[/、,，]| / ", v or ""):
        chunk = re.sub(r"^(原作|作画|漫画|構成|脚本|原案)[:：]?\s*", "", chunk.strip())
        chunk = re.sub(r"[(（].*?[)）]", "", chunk).strip()
        if chunk and len(chunk) < 30:
            out.append(chunk)
    return out


def main():
    artists = load("artists")
    authors = load("original-authors")
    labels = load("labels")
    publishers = load("publishers")

    if sys.argv[1:2] == ["--names"]:
        for nm in sys.argv[2:]:
            k = norm(nm)
            print(f"{nm}\tar={artists.get(k, '?')}\toa={authors.get(k, '?')}")
        return

    probe = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for r in probe:
        if r.get("status") != "OK":
            continue
        parts = []
        for nm in split_names(r.get("author", "")):
            parts.append(f"{nm}=ar:{artists.get(norm(nm), '?')}")
        for nm in split_names(r.get("gengaku", "")):
            parts.append(f"原{nm}=oa:{authors.get(norm(nm), '?')}")
        for nm in split_names(r.get("sakuga", "")):
            parts.append(f"画{nm}=ar:{artists.get(norm(nm), '?')}")
        mag = (r.get("magazine") or "").split(" / ")[0].strip()
        lid = labels.get(norm(mag), "?")
        pid = publishers.get(norm(r.get("publisher", "")), "?")
        print(f"{r['n']}\t" + " ".join(parts) + f"\t誌:{mag}={lid}\t社:{r.get('publisher')}={pid}")


if __name__ == "__main__":
    main()
