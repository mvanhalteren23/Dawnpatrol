"""Which candidates are already in the CRM? Prints only the NEW ones, plus a count of known ones.
Usage: python3 scripts/check_known.py <<'JSON'
       [{"name": "...", "website": "...", "phone": "...", "city": "..."}, ...]
       JSON
(or pass a file path instead of stdin)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crm import post  # noqa: E402


def main(argv):
    raw = open(argv[1], encoding="utf-8").read() if len(argv) > 1 else sys.stdin.read()
    items = json.loads(raw)
    status, body = post("/api/prospects/check", {"businesses": items})
    if status != 200:
        print(f"CHECK FAILED ({status}): {body.get('error', 'unknown error')}. Carry on; the import skips duplicates.")
        return 1
    res = body.get("results", [])
    known = [r for r in res if r.get("known")]
    for r in res:
        if not r.get("known"):
            print(f"NEW: {r.get('name')}")
    print(f"{len(known)} already in the CRM (skip them)" + (": " + ", ".join(r.get("name") or "" for r in known[:20]) if known else "") + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
