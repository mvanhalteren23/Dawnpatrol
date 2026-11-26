"""Check a whole prospect pack. Usage: python3 scripts/check_pack.py prospects.json"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from packlib import check_prospect  # noqa: E402


def main(path):
    with open(path, encoding="utf-8") as f:
        try:
            pack = json.load(f)
        except ValueError as e:
            print("INVALID JSON:", e)
            return 1
    prospects = pack.get("prospects")
    if not isinstance(prospects, list) or not prospects:
        print('INVALID: the pack needs a non-empty "prospects" list.')
        return 1
    problems, warnings, seen = [], [], set()
    if len(prospects) > 50:
        problems.append("More than 50 prospects: split into batches.")
    for i, p in enumerate(prospects, 1):
        label = f"#{i} {(p.get('name') or '(no name)') if isinstance(p, dict) else '(not an object)'}"
        key = (p.get("name") or "").strip().lower() if isinstance(p, dict) else ""
        if key and key in seen:
            problems.append(f"{label}: listed twice.")
        seen.add(key)
        pr, wr = check_prospect(p, label)
        problems += pr
        warnings += wr
    for w in warnings:
        print("WARNING:", w)
    for pr in problems:
        print("FIX:", pr)
    print(f"{len(prospects)} prospects checked: {len(problems)} to fix, {len(warnings)} warnings.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else print(__doc__) or 2)
