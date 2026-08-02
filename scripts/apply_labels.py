#!/usr/bin/env python3
"""出版社→レーベル移行用の一時反映スクリプト。既存workのlabelIdを一括更新する。
使い方: python3 scripts/apply_labels.py <batch.json>

batch.json の形式:
{
  "newLabels": [...],           # labels.jsonに追加する新規レーベル(既存id重複はスキップ)
  "workLabels": {"<workId>": "<labelId>", ...}  # 既存workへのlabelId割り当て
}

- workLabels の labelId は (既存labels + newLabels) の中に存在するか検証する
- 存在しないworkId・存在しないlabelIdはreportに記録して反映しない
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
        print("usage: apply_labels.py <batch.json>")
        sys.exit(1)

    with open(sys.argv[1], encoding="utf-8") as f:
        batch = json.load(f)

    labels = load("labels")
    works = load("works")

    label_ids = {l["id"] for l in labels}
    works_by_id = {w["id"]: w for w in works}

    report = {"added_labels": [], "skipped_duplicate_labels": [], "updated_works": [], "rejected": []}

    for item in batch.get("newLabels", []):
        if item["id"] in label_ids:
            report["skipped_duplicate_labels"].append(item["id"])
        else:
            labels.append(item)
            label_ids.add(item["id"])
            report["added_labels"].append(item["id"])

    for work_id, label_id in batch.get("workLabels", {}).items():
        if work_id not in works_by_id:
            report["rejected"].append({"workId": work_id, "reason": "unknown work id"})
            continue
        if label_id not in label_ids:
            report["rejected"].append({"workId": work_id, "reason": f"unknown labelId {label_id}"})
            continue
        works_by_id[work_id]["labelId"] = label_id
        report["updated_works"].append(work_id)

    save("labels", labels)
    save("works", works)

    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
