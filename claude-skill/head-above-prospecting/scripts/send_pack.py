"""Send a checked prospect pack to the Head Above CRM. Usage: python3 scripts/send_pack.py prospects.json"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crm import post  # noqa: E402

def main(path):
    with open(path, encoding="utf-8") as f:
        pack = json.load(f)
    status, body = post("/api/prospects/import", pack)
    if status != 200:
        print(f"IMPORT FAILED ({status}): {body.get('error', 'unknown error')}")
        return 1
    print(f"Added {body.get('added', 0)}; already in the CRM {body.get('alreadyInCrm', 0)}.")
    for r in body.get("results", []):
        state = {"added": "added" + (" + research" if r.get("researched") else ""), "exists": "already in CRM", "error": "not added"}.get(r.get("status"), r.get("status"))
        print(f"- {r.get('name')}: {state}" + (f" {r['url']}" if r.get("url") else "") + (f" ({r['message']})" if r.get("message") else ""))
    for p in body.get("problems", []):
        print("NOTE:", p)
    if body.get("review"):
        print("Review in the CRM:", body["review"])
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else print(__doc__) or 2)
