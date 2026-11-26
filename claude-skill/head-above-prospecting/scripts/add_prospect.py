"""Add ONE researched prospect to the pack file as soon as it's done (keeps the conversation small).
Usage:  python3 scripts/add_prospect.py PACK.json "<criteria>" <<'JSON'
        { ...one prospect, in the pack format... }
        JSON
Creates PACK.json if needed. Prints one line: ADDED (with how many are waiting to send) or FIX lines."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from packlib import check_prospect  # noqa: E402


def main(path, criteria):
    raw = sys.stdin.read().strip()
    try:
        p = json.loads(raw)
    except ValueError as e:
        print("FIX: that prospect isn't valid JSON:", e)
        return 1
    label = (p.get("name") if isinstance(p, dict) else None) or "(no name)"
    problems, warnings = check_prospect(p, label)
    if problems:
        for pr in problems:
            print("FIX:", pr)
        print("Not added. Fix and run again.")
        return 1
    pack = {"format": "headabove.prospects.v1", "criteria": criteria, "prospects": []}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            pack = json.load(f)
    names = {(x.get("name") or "").strip().lower() for x in pack.get("prospects", [])}
    if label.strip().lower() in names:
        print(f"SKIPPED: {label} is already in the pack.")
        return 0
    pack.setdefault("prospects", []).append(p)
    if criteria and not pack.get("criteria"):
        pack["criteria"] = criteria
    with open(path, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=1)
    for w in warnings:
        print("WARNING:", w)
    n = len(pack["prospects"])
    print(f"ADDED: {label}. {n} waiting to send." + (" Send now (5 ready)." if n >= 5 else ""))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
