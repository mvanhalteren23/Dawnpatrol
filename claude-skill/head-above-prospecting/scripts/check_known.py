"""Which candidates are already in the CRM? Usage: python3 scripts/check_known.py candidates.json
candidates.json is a list of {"name", "website", "phone", "city"}. Prints one line per candidate."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crm import post  # noqa: E402

def main(path):
    with open(path, encoding="utf-8") as f:
        items = json.load(f)
    status, body = post("/api/prospects/check", {"businesses": items})
    if status != 200:
        print(f"CHECK FAILED ({status}): {body.get('error', 'unknown error')}. Carry on; the import skips duplicates.")
        return 1
    known = 0
    for r in body.get("results", []):
        if r.get("known"):
            known += 1
            print(f"IN CRM: {r.get('name')} (as {r.get('accountName')})")
        else:
            print(f"NEW: {r.get('name')}")
    print(f"{known} already in the CRM.")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else print(__doc__) or 2)
